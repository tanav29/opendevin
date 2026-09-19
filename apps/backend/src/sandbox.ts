import { tool, stepCountIs } from "ai";
import { CommandExitError, Sandbox } from "e2b";
import { z } from "zod";
import { prisma } from "./db/prisma.js";

export const WORKSPACE_PATH = "/home/user/workspace";
export const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000;

// Single place that maps env keys to the model id the chat route passes to
// OpenRouter. OPENROUTER_API_KEY is the key, MODEL is the model id.
// OpenRouter requires a `provider/model` id, so bare ids like `gpt-4o-mini`
// are prefixed with `openai/`.
export function resolveChatModel(): {
  modelId: string;
  apiKey: string | undefined;
} {
  const raw = process.env.MODEL?.trim() || "openai/gpt-4o-mini";
  const modelId = raw.includes("/") ? raw : `openai/${raw}`;
  return { modelId, apiKey: process.env.OPENROUTER_API_KEY };
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
  if (!/^[\w.\-/]+$/.test(name)) return "";
  if (name.includes("..") || name.startsWith("/") || name.startsWith("-")) return "";
  return name;
}

export function projectEnvVars(value: unknown): Record<string, string> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([key, entry]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof entry === "string")
        .slice(0, 50),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

// Workspace-relative path guard for tools and file routes. Rejects absolute
// paths, traversal (`..` segments), and backslashes. Returns the clean path,
// "" for the workspace root, or null when invalid.
export function sanitizeRel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.replace(/^\//, "").trim();
  if (!raw || raw === ".") return "";
  if (raw.includes("\\")) return null;
  const parts = raw.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0) return "";
  if (parts.some((p) => p === "..")) return null;
  return parts.join("/");
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
  const isGitHub = /^https:\/\/github\.com\//i.test(url);
  const cleanWorkspace = () =>
    sandbox.commands.run(
      `rm -rf ${shellQuote(workspacePath)} && mkdir -p ${shellQuote(workspacePath)}`,
    );
  const authedUrl =
    token && isGitHub
      ? url.replace(/^https:\/\/github\.com\//i, `https://oauth2:${token}@github.com/`)
      : null;

  async function tryClone(targetUrl: string, targetBranch: string) {
    const branchArg = targetBranch ? ` --branch ${shellQuote(targetBranch)}` : "";
    // Use runSandbox (unwraps CommandExitError) — E2B throws on non-zero exit,
    // and git signals clone failure that way. 120s for large repos.
    return runSandbox(
      sandbox,
      `git clone --depth 1${branchArg} ${shellQuote(targetUrl)} ${shellQuote(workspacePath)}`,
      "/tmp",
      120_000,
    );
  }

  async function scrubOrigin() {
    await sandbox.commands
      .run(`git -C ${shellQuote(workspacePath)} remote set-url origin ${shellQuote(url)}`)
      .catch(() => undefined);
  }

  // Fresh workspace, then clone.
  await cleanWorkspace();
  // First try unauthenticated clone (works for public repos, avoids leaking token or 401 for invalid token)
  let result = await tryClone(url, branch);
  if (result.exitCode !== 0 && authedUrl) {
    // Retry with token embedded via oauth2 URL (works for private repos, token is valid via API)
    await cleanWorkspace();
    result = await tryClone(authedUrl, branch);
    if (result.exitCode === 0) await scrubOrigin();
  }
  if (result.exitCode === 0) return;

  // Branch may be new (not on remote): clone default then checkout -B.
  // Also covers transient --branch failures for existing branches.
  if (branch) {
    await cleanWorkspace();
    result = await tryClone(url, "");
    if (result.exitCode !== 0 && authedUrl) {
      await cleanWorkspace();
      result = await tryClone(authedUrl, "");
    }
    if (result.exitCode === 0) {
      await scrubOrigin();
      const cwd = workspacePath;
      // If the branch exists on remote, track it; otherwise create it.
      const fetchOut = await runSandbox(
        sandbox,
        `git fetch origin ${shellQuote(branch)} --depth 1`,
        cwd,
      ).catch(() => ({ exitCode: 128, stdout: "", stderr: "" }));
      if (fetchOut.exitCode === 0) {
        const co = await runSandbox(sandbox, `git checkout ${shellQuote(branch)}`, cwd).catch(
          () => ({ exitCode: 128, stdout: "", stderr: "" }),
        );
        if (co.exitCode === 0) return;
      }
      const create = await runSandbox(sandbox, `git checkout -B ${shellQuote(branch)}`, cwd).catch(
        () => ({ exitCode: 128, stdout: "", stderr: "" }),
      );
      if (create.exitCode === 0) return;
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

    // Project setup script (env install, e.g. `pnpm install`). Runs once after
    // clone so preview/dev and agent tools work without manual terminal steps.
    const setup = (existing.project as { setupScript?: string }).setupScript?.trim();
    const envs = projectEnvVars((existing.project as { envVars?: string }).envVars);
    if (setup) {
      try {
        const out = await runSandbox(
          sandbox,
          setup.slice(0, 2000),
          existing.workspacePath || WORKSPACE_PATH,
          300_000,
          envs,
        );
        if (out.exitCode !== 0) {
          await prisma.projectSession.update({
            where: { id: sessionId },
            data: {
              sandboxStatus: "ready",
              status: "idle",
              lastError: `Setup script exited ${out.exitCode}: ${(out.stderr || out.stdout).slice(0, 500)}`,
            },
          });
          return;
        }
      } catch (error) {
        await prisma.projectSession.update({
          where: { id: sessionId },
          data: {
            sandboxStatus: "ready",
            status: "idle",
            lastError:
              error instanceof Error
                ? `Setup failed: ${error.message}`.slice(0, 500)
                : "Setup failed",
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

// Preview readiness: E2B's getHost() yields a URL for any port, even when
// nothing listens there — the iframe then shows a dead page. Probe from inside
// the sandbox so /preview and /devserver only hand out URLs that serve.
export async function probePort(
  sandbox: Sandbox,
  port: number,
  timeoutMs = 10_000,
): Promise<{ listening: boolean; httpCode: number }> {
  const out = await runSandbox(
    sandbox,
    `curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:${port}/ || true`,
    "/tmp",
    timeoutMs,
  ).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
  const code = Number((out.stdout || "").trim().slice(-3));
  // curl prints 000 when TCP connect fails. Any real HTTP status (even 404/500
  // rendered by the app itself) means something is serving the port.
  if (Number.isInteger(code) && code > 0) return { listening: true, httpCode: code };
  return { listening: false, httpCode: 0 };
}

export async function waitForPort(
  sandbox: Sandbox,
  port: number,
  timeoutMs = 25_000,
): Promise<{ listening: boolean; httpCode: number }> {
  const start = Date.now();
  let last = { listening: false, httpCode: 0 };
  for (;;) {
    last = await probePort(sandbox, port);
    if (last.listening || Date.now() - start > timeoutMs) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// Attach sandbox tools when the workspace sandbox is reachable, otherwise
// return a note so the agent answers from general knowledge.
export async function connectSandboxTools(
  sandboxId: string,
  workspacePath: string,
): Promise<{ tools: ReturnType<typeof sandboxTools> | undefined; sandboxNote: string }> {
  if (!sandboxId) {
    return {
      tools: undefined,
      sandboxNote:
        "The cloud sandbox is still provisioning (repo clone pending). Answer from general knowledge and ask the user to retry once it is ready.",
    };
  }
  try {
    const sandbox = await Sandbox.connect(sandboxId);
    return { tools: sandboxTools(sandbox, workspacePath || WORKSPACE_PATH), sandboxNote: "" };
  } catch {
    return {
      tools: undefined,
      sandboxNote:
        "The cloud sandbox is currently unreachable. Answer from general knowledge and suggest reconnecting the sandbox.",
    };
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
        const rel = sanitizeRel(path);
        if (rel === null) return "Invalid path: must be workspace-relative, without '..'.";
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
        const rel = sanitizeRel(path);
        if (rel === null || rel === "")
          return "Invalid path: must be a workspace-relative file, without '..'.";
        const content = await sandbox.files.read(`${cwd}/${rel}`);
        return typeof content === "string" ? content.slice(0, 20000) : content;
      },
    }),
    run_command: tool({
      description:
        "Run a shell command inside the workspace to inspect, test, build, or edit. No sudo. Use timeoutMs for long builds (max 300s). Prefix long servers with nohup ... & to background them.",
      inputSchema: z.object({
        command: z.string().describe("Shell command, e.g. 'ls -la && cat package.json'"),
        timeoutMs: z.number().default(60_000).describe("Timeout 1000-300000ms"),
      }),
      execute: async ({ command, timeoutMs }: { command: string; timeoutMs?: number }) => {
        const timeout = Math.max(
          1000,
          Math.min(300_000, Math.floor(timeoutMs ?? 60_000) || 60_000),
        );
        const result = await sandbox.commands.run(command, { cwd, timeoutMs: timeout });
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
        const rel = sanitizeRel(path);
        if (rel === null || rel === "")
          return "Invalid path: must be a workspace-relative file, without '..'.";
        if (content.length > 200_000) return "Content too large: max 200,000 chars per write.";
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
    edit_file: tool({
      description:
        "Patch a text file with an exact string replacement. Prefer over write_file for small changes. old_string must appear exactly once.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
        old_string: z.string().describe("Exact text to replace"),
        new_string: z.string().describe("Replacement text"),
      }),
      execute: async ({
        path,
        old_string,
        new_string,
      }: {
        path: string;
        old_string: string;
        new_string: string;
      }) => {
        const rel = sanitizeRel(path);
        if (rel === null || rel === "")
          return "Invalid path: must be a workspace-relative file, without '..'.";
        if (!old_string) return "old_string is required.";
        if (old_string.length > 50_000 || new_string.length > 200_000)
          return "Replacement too large.";
        const current = await sandbox.files.read(`${cwd}/${rel}`);
        const text = typeof current === "string" ? current : "";
        const first = text.indexOf(old_string);
        if (first === -1) return "old_string not found in file.";
        if (text.indexOf(old_string, first + 1) !== -1)
          return "old_string matches multiple locations: include more context to make it unique.";
        const next = text.slice(0, first) + new_string + text.slice(first + old_string.length);
        await sandbox.files.write(`${cwd}/${rel}`, next);
        return `Patched ${rel} (${old_string.length} -> ${new_string.length} chars)`;
      },
    }),
    delete_file: tool({
      description: "Delete a file or empty directory in the workspace.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
      }),
      execute: async ({ path }: { path: string }) => {
        const rel = sanitizeRel(path);
        if (rel === null || rel === "")
          return "Invalid path: must be a workspace-relative file, without '..'.";
        const out = await runSandbox(sandbox, `rm -rf ${shellQuote(rel)}`, cwd);
        return out.exitCode === 0
          ? `Deleted ${rel}`
          : `Delete failed: ${(out.stderr || out.stdout).slice(0, 500)}`;
      },
    }),
    search: tool({
      description:
        "Grep for text in the workspace (excludes .git/node_modules). Use to find symbols, imports, TODOs before reading files.",
      inputSchema: z.object({
        pattern: z.string().describe("Fixed string or regex, e.g. 'useState'"),
        dir: z.string().default(".").describe("Relative dir to search"),
      }),
      execute: async ({ pattern, dir }: { pattern: string; dir?: string }) => {
        const rel = sanitizeRel(dir ?? ".");
        if (rel === null) return "Invalid dir.";
        if (!pattern || pattern.length > 300) return "Invalid pattern.";
        const out = await runSandbox(
          sandbox,
          `grep -rn -I --exclude-dir=.git --exclude-dir=node_modules -- ${shellQuote(pattern)} ${shellQuote(rel === "" ? "." : rel)} | head -n 100`,
          cwd,
        );
        const text = (out.stdout || "").slice(0, 12000);
        return text ? `matches:\n${text}` : "No matches.";
      },
    }),
    update_plan: tool({
      description:
        "Publish the current task plan (2-8 steps) so the user sees progress. Call at start and after each step completes. Statuses: pending|in_progress|done.",
      inputSchema: z.object({
        tasks: z
          .array(
            z.object({
              title: z.string().describe("Short step title"),
              status: z.enum(["pending", "in_progress", "done"]).describe("Step status"),
            }),
          )
          .min(1)
          .max(12),
      }),
      execute: async ({ tasks }: { tasks: { title: string; status: string }[] }) => {
        const clean = tasks
          .slice(0, 12)
          .map((t) => ({
            title: String(t.title || "").slice(0, 200),
            status: t.status === "done" || t.status === "in_progress" ? t.status : "pending",
          }))
          .filter((t) => t.title);
        return `__PLAN__${JSON.stringify(clean)}`;
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
  timeoutMs = 30_000,
  envs?: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const result = await sandbox.commands.run(command, { cwd, timeoutMs, envs });
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

  // Non-git workspaces (e.g. empty project with no repo) have no diff, not an error.
  try {
    const rev = await run("git rev-parse --git-dir");
    if (rev.exitCode !== 0) return { diff: "", truncated: false };
  } catch {
    return { diff: "", truncated: false };
  }

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

// Best-effort diff snapshot so the Changes tab survives sandbox expiry, then
// reset the session status so it is never left "running".
export async function snapshotDiffAndIdle(sessionId: string): Promise<void> {
  const session = await prisma.projectSession.findUnique({ where: { id: sessionId } });
  if (session?.sandboxId) {
    try {
      const sandbox = await Sandbox.connect(session.sandboxId);
      const { diff } = await readWorkspaceDiff(sandbox, session.workspacePath || WORKSPACE_PATH);
      await prisma.projectSession.update({
        where: { id: sessionId },
        data: { lastDiff: diff, lastDiffAt: new Date(), status: "idle" },
      });
      return;
    } catch {
      // Unreachable sandbox: fall through and just reset the status.
    }
  }
  await prisma.projectSession.update({ where: { id: sessionId }, data: { status: "idle" } });
}

export const AGENT_STOP = stepCountIs(25);
