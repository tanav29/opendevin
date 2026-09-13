import { tool, stepCountIs } from "ai";
import { CommandExitError, Sandbox } from "e2b";
import { z } from "zod";
import { prisma } from "./db/prisma.js";

export const WORKSPACE_PATH = "/home/user/workspace";
export const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000;

// Single place that maps env keys to the model id the chat route passes to
// the provider. OpenRouter requires a `provider/model` id, so bare ids like
// `gpt-4o-mini` (the documented default) are prefixed with `openai/`.
export function resolveChatModel(): { modelId: string; usingOpenRouter: boolean } {
  const usingOpenRouter = Boolean(process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY);
  let modelId = process.env.OPENAI_MODEL || process.env.MODEL || "gpt-4o-mini";
  if (usingOpenRouter && !modelId.includes("/")) modelId = `openai/${modelId}`;
  return { modelId, usingOpenRouter };
}

export function isRepoUrl(repo: string | null | undefined): repo is string {
  if (!repo) return false;
  const url = repo.trim();
  return url.startsWith("https://") || url.startsWith("http://") || url.startsWith("git@");
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function sanitizeBranch(branch: unknown): string {
  if (typeof branch !== "string") return "";
  const name = branch.trim().slice(0, 200);
  // Allow typical git branch chars, reject shell metachars / traversal.
  if (!name) return "";
  if (!/^[\w.\-\/]+$/.test(name)) return "";
  if (name.includes("..") || name.startsWith("/") || name.startsWith("-")) return "";
  return name;
}

export async function githubTokenForUser(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({ where: { userId, providerId: "github" } });
  return account?.accessToken || null;
}

export async function cloneRepo(
  sandbox: Sandbox,
  repo: string,
  workspacePath: string,
  branch = "",
  token: string | null = null,
): Promise<void> {
  const url = repo.trim();
  // Fresh workspace, then clone. If workspace exists and is non-empty, skip.
  await sandbox.commands.run(
    `rm -rf ${shellQuote(workspacePath)} && mkdir -p ${shellQuote(workspacePath)}`,
  );
  const isGitHub = /^https:\/\/github\.com\//i.test(url);
  const branchArg = branch ? ` --branch ${shellQuote(branch)}` : "";
  // First try unauthenticated clone (works for public repos, avoids leaking token or 401 for invalid token)
  let result = await sandbox.commands.run(
    `git clone --depth 1${branchArg} ${shellQuote(url)} ${shellQuote(workspacePath)}`,
    { timeoutMs: 120_000 },
  );
  if (result.exitCode !== 0 && token && isGitHub) {
    // Retry with token embedded via oauth2 URL (works for private repos, token is valid via API)
    const authedUrl = url.replace(
      /^https:\/\/github\.com\//i,
      `https://oauth2:${token}@github.com/`,
    );
    // Clean workspace before retry
    await sandbox.commands.run(
      `rm -rf ${shellQuote(workspacePath)} && mkdir -p ${shellQuote(workspacePath)}`,
    );
    result = await sandbox.commands.run(
      `git clone --depth 1${branchArg} ${shellQuote(authedUrl)} ${shellQuote(workspacePath)}`,
      { timeoutMs: 120_000 },
    );
    // Remove token from remote URL immediately so it doesn't persist in .git/config
    if (result.exitCode === 0) {
      await sandbox.commands
        .run(`git -C ${shellQuote(workspacePath)} remote set-url origin ${shellQuote(url)}`)
        .catch(() => undefined);
    }
  }
  if (result.exitCode !== 0) {
    const raw = (result.stderr || result.stdout || "git clone failed").slice(0, 2000);
    const hint =
      !token && isGitHub ? " The repository may be private — sign in with GitHub and retry." : "";
    throw new Error(`${raw}${hint}`);
  }
}

export async function provisionSandbox(sessionId: string): Promise<void> {
  const existing = await prisma.projectSession.findUnique({
    where: { id: sessionId },
    include: { project: true },
  });
  if (!existing) return;

  await prisma.projectSession.update({
    where: { id: sessionId },
    data: { sandboxStatus: "creating", lastError: null },
  });

  try {
    if (!process.env.E2B_API_KEY) {
      throw new Error("E2B_API_KEY is not configured");
    }
    const sandbox = await Sandbox.create({ timeoutMs: SANDBOX_TIMEOUT_MS });
    await prisma.projectSession.update({
      where: { id: sessionId },
      data: {
        sandboxId: sandbox.sandboxId,
        sandboxStatus: existing.project.repo?.trim() ? "cloning" : "ready",
      },
    });

    const repo = existing.project.repo?.trim();
    if (isRepoUrl(repo)) {
      try {
        // Reuse the owner's GitHub OAuth token so private repos can clone.
        const token = await githubTokenForUser(existing.project.userId);
        await cloneRepo(
          sandbox,
          repo,
          existing.workspacePath || WORKSPACE_PATH,
          existing.branch || "",
          token,
        );
      } catch (error) {
        await prisma.projectSession.update({
          where: { id: sessionId },
          data: {
            sandboxStatus: "error",
            status: "failed",
            lastError: error instanceof Error ? error.message : "Repository clone failed",
          },
        });
        return;
      }
    }

    await prisma.projectSession.update({
      where: { id: sessionId },
      data: { sandboxStatus: "ready", status: "idle", lastError: null },
    });
  } catch (error) {
    await prisma.projectSession.update({
      where: { id: sessionId },
      data: {
        sandboxStatus: "error",
        status: "failed",
        lastError: error instanceof Error ? error.message : "Sandbox creation failed",
      },
    });
  }
}

export async function checkSandboxAvailable(sandboxId: string): Promise<boolean> {
  if (!sandboxId) return false;
  try {
    const sandbox = await Sandbox.connect(sandboxId);
    await sandbox.commands.run("pwd", { timeoutMs: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export function sandboxTools(sandbox: Sandbox, workspacePath: string) {
  const cwd = workspacePath || WORKSPACE_PATH;
  return {
    list_files: tool({
      description:
        "List files in the cloned repo workspace. Use path relative to workspace root, e.g. '.' or 'src'.",
      inputSchema: z.object({
        path: z.string().default(".").describe("Relative path inside workspace"),
      }),
      execute: async ({ path }: { path: string }) => {
        const rel = path.replace(/^\//, "").replace(/\.\./g, "");
        const entries = await sandbox.files.list(`${cwd}/${rel}`);
        return entries.map((e) => ({ name: e.name, type: e.type, path: e.path })).slice(0, 200);
      },
    }),
    read_file: tool({
      description: "Read a text file from the workspace. Path is relative to workspace root.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path, e.g. 'package.json'"),
      }),
      execute: async ({ path }: { path: string }) => {
        const rel = path.replace(/^\//, "").replace(/\.\./g, "");
        const content = await sandbox.files.read(`${cwd}/${rel}`);
        return typeof content === "string" ? content.slice(0, 20000) : content;
      },
    }),
    run_command: tool({
      description:
        "Run a shell command inside the workspace (read-only inspection, tests, builds). No sudo, 60s max.",
      inputSchema: z.object({
        command: z.string().describe("Shell command, e.g. 'ls -la && cat package.json'"),
      }),
      execute: async ({ command }: { command: string }) => {
        const result = await sandbox.commands.run(command, { cwd, timeoutMs: 60_000 });
        return `exit=${result.exitCode}\nstdout:\n${result.stdout.slice(0, 12000)}\nstderr:\n${result.stderr.slice(0, 4000)}`;
      },
    }),
    write_file: tool({
      description:
        "Write or overwrite a text file in the workspace. Path is relative to workspace root.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
        content: z.string().describe("Full new file content"),
      }),
      execute: async ({ path, content }: { path: string; content: string }) => {
        const rel = path.replace(/^\//, "").replace(/\.\./g, "");
        await sandbox.files.write(`${cwd}/${rel}`, content);
        return `Wrote ${rel} (${content.length} chars)`;
      },
    }),
    ask_user: tool({
      description:
        "Ask the user a clarifying question with fixed options. Use when requirements are ambiguous instead of guessing. The question renders as clickable buttons; the answer arrives as the user's next message.",
      inputSchema: z.object({
        question: z.string().describe("The clarifying question"),
        options: z.array(z.string()).min(2).max(6).describe("2-6 short answer options"),
      }),
      execute: async ({ question, options }: { question: string; options: string[] }) => {
        return `Question asked: ${question} Options: ${options.join(" | ")}. Wait for the user's answer in their next message before proceeding.`;
      },
    }),
  };
}
const MAX_DIFF_BYTES = 100_000;
const MAX_UNTRACKED_FILES = 100;

// E2B's `commands.run` throws CommandExitError on any non-zero exit, but git
// signals "differences found" via exit 1 — the normal case for a diff. The
// thrown error still carries stdout/stderr, so unwrap it instead of losing
// the output. Genuine transport failures still throw.
export async function runSandbox(
  sandbox: Sandbox,
  command: string,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const result = await sandbox.commands.run(command, { cwd, timeoutMs: 30_000 });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    if (error instanceof CommandExitError) {
      return {
        exitCode: error.exitCode,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      };
    }
    throw error;
  }
}

function truncateAtFileBoundary(diff: string): string {
  if (diff.length <= MAX_DIFF_BYTES) return diff;
  const cut = diff.lastIndexOf("\ndiff --git ", MAX_DIFF_BYTES);
  // Single huge file (no later boundary): hard slice, the UI falls back to raw view.
  return cut <= 0 ? diff.slice(0, MAX_DIFF_BYTES) : diff.slice(0, cut);
}

// Full workspace diff: tracked changes (`git diff HEAD`) plus untracked new
// files, which `git diff HEAD` silently omits. Each untracked file is diffed
// against /dev/null so the result stays a parseable unified patch.
export async function readWorkspaceDiff(
  sandbox: Sandbox,
  cwd: string,
): Promise<{ diff: string; truncated: boolean }> {
  const run = (command: string) => runSandbox(sandbox, command, cwd);

  let tracked = "";
  const head = await run("git diff HEAD --no-color");
  if (head.exitCode === 0 || head.exitCode === 1) {
    // git diff exits 1 when differences exist — that IS the output we want.
    tracked = head.stdout || "";
  } else {
    // Unborn HEAD (fresh repo with no commits): staged + unstaged separately.
    const [staged, unstaged] = await Promise.all([
      run("git diff --cached --no-color"),
      run("git diff --no-color"),
    ]);
    if (staged.exitCode <= 1 && unstaged.exitCode <= 1) {
      tracked = [staged.stdout || "", unstaged.stdout || ""].filter(Boolean).join("\n");
    } else {
      throw new Error((head.stderr || head.stdout || "git diff failed").slice(0, 500));
    }
  }

  let untrackedNames: string[] = [];
  const listed = await run("git ls-files --others --exclude-standard -z");
  if (listed.exitCode === 0) {
    untrackedNames = (listed.stdout || "").split("\0").filter((name) => name.length > 0);
  }
  let truncated = untrackedNames.length > MAX_UNTRACKED_FILES;
  untrackedNames = untrackedNames.slice(0, MAX_UNTRACKED_FILES);

  const patches: string[] = [];
  if (tracked) patches.push(tracked.endsWith("\n") ? tracked : `${tracked}\n`);
  for (const name of untrackedNames) {
    const out = await run(`git diff --no-index --no-color -- /dev/null ${shellQuote(name)}`);
    let patch = out.stdout || "";
    if (!patch) {
      // Empty file: no hunks, header only — still a change worth listing.
      patch = `new file mode 100644\n--- /dev/null\n+++ b/${name}\n`;
    }
    const lines = patch.split("\n");
    // Normalize to a conventional new-file patch: --no-index emits numeric
    // prefixes (`1/<name>`, `2/<name>`) that diff viewers may not strip.
    if (lines[0]?.startsWith("diff --git ")) lines[0] = `diff --git a/${name} b/${name}`;
    else lines.unshift(`diff --git a/${name} b/${name}`);
    // Header layout varies (`index …` may sit between mode and ---/+++).
    for (let i = 1; i < lines.length && i <= 6; i++) {
      if (lines[i]?.startsWith("--- ")) lines[i] = "--- /dev/null";
      else if (lines[i]?.startsWith("+++ ")) lines[i] = `+++ b/${name}`;
    }
    patches.push(`${lines.join("\n").trimEnd()}\n`);
    if (patches.join("").length > MAX_DIFF_BYTES) {
      truncated = true;
      break;
    }
  }

  const combined = patches.join("");
  if (combined.length <= MAX_DIFF_BYTES && !truncated) return { diff: combined, truncated: false };
  return { diff: truncateAtFileBoundary(combined), truncated: true };
}

export const AGENT_STOP = stepCountIs(8);
