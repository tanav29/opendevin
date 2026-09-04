import { tool, stepCountIs } from "ai";
import { Sandbox } from "e2b";
import { z } from "zod";
import { prisma } from "./db/prisma.js";

export const WORKSPACE_PATH = "/home/user/workspace";
export const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000;

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
  // Pass the OAuth token via an auth header so it never lands in .git/config or logs.
  const headerArg = token
    ? ` -c ${shellQuote(`http.extraHeader=AUTHORIZATION: bearer ${token}`)}`
    : "";
  const branchArg = branch ? ` --branch ${shellQuote(branch)}` : "";
  const result = await sandbox.commands.run(
    `git${headerArg} clone --depth 1${branchArg} ${shellQuote(url)} ${shellQuote(workspacePath)}`,
    {
      timeoutMs: 120_000,
    },
  );
  if (result.exitCode !== 0) {
    const raw = (result.stderr || result.stdout || "git clone failed").slice(0, 2000);
    const hint =
      !token && /^https:\/\/github\.com\//i.test(url)
        ? " The repository may be private — sign in with GitHub and retry."
        : "";
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
  };
}

export const AGENT_STOP = stepCountIs(8);
