import Sandbox from "@e2b/code-interpreter";
import { tool } from "ai";
import z from "zod";

export const OUTPUT_LIMIT = 30_000;
const redact = (value: string) => value.replace(/(?:ghp_|github_pat_|sk-[A-Za-z0-9_-]+)[A-Za-z0-9_-]+/g, "[REDACTED]");
export const bounded = (value: string, max = OUTPUT_LIMIT) => ({
  content: redact(value.slice(0, max)),
  truncated: value.length > max,
});

function safePath(cwd: string, path: string) {
  if (!path || path.includes("\\") || path.startsWith("/") || path.split("/").includes(".."))
    throw new Error("Only repository-relative paths are allowed.");
  if (/(^|\/)(\.env|.*\.pem|.*\.key)(\.|$)/i.test(path))
    throw new Error("Sensitive files cannot be read or written.");
  return `${cwd}/${path}`;
}

function safeCommand(command: string) {
  if (/\b(git\s+(reset|clean|checkout\s+--|push\s+--force)|rm\s+-rf|sudo)\b/i.test(command))
    throw new Error("This command is prohibited by workspace guardrails.");
}

export type EventWriter = (type: string, message: string, payload?: unknown, status?: string) => Promise<unknown>;

export function sandboxTools(sandbox: Sandbox, cwd: string, options?: { mutate?: boolean; event?: EventWriter; signal?: AbortSignal }) {
  const event = options?.event ?? (async () => undefined);
  const mutate = Boolean(options?.mutate);
  const command = async (value: string) => {
    safeCommand(value);
    await event("command_started", value);
    const result = await sandbox.commands.run(value, { cwd, timeoutMs: 120_000 });
    const output = { exitCode: result.exitCode, stdout: bounded(result.stdout), stderr: bounded(result.stderr), error: result.error };
    await event("command_completed", value, output, result.exitCode === 0 ? "passed" : "failed");
    return output;
  };
  return {
    run_command: tool({ description: "Run a safe command in the repository.", inputSchema: z.object({ command: z.string().min(1) }), execute: ({ command: value }) => command(value) }),
    read_file: tool({ description: "Read a repository-relative text file.", inputSchema: z.object({ path: z.string().min(1) }), execute: async ({ path }) => {
      const relative = safePath(cwd, path); const value = await sandbox.files.read(relative); const result = { path, ...bounded(value) };
      await event("file_read", path, result); return result;
    }}),
    git_status: tool({ description: "Inspect git status.", inputSchema: z.object({}), execute: () => command("git status --short --branch") }),
    git_diff: tool({ description: "Inspect the current git diff.", inputSchema: z.object({}), execute: () => command("git diff --no-ext-diff --unified=3") }),
    git_changed_files: tool({ description: "List changed files.", inputSchema: z.object({}), execute: () => command("git diff --name-status") }),
    ...(mutate ? {
      edit_file: tool({ description: "Replace one exact string in a repository-relative file.", inputSchema: z.object({ path: z.string().min(1), oldText: z.string().min(1), newText: z.string() }), execute: async ({ path, oldText, newText }) => {
        const fullPath = safePath(cwd, path); const current = await sandbox.files.read(fullPath); const occurrences = current.split(oldText).length - 1;
        if (occurrences !== 1) throw new Error(`Expected oldText once in ${path}, found ${occurrences}.`);
        await sandbox.files.write(fullPath, current.replace(oldText, newText)); await event("file_edited", path, { path }); return { path, ok: true };
      }}),
      write_file: tool({ description: "Write a repository-relative text file.", inputSchema: z.object({ path: z.string().min(1), content: z.string() }), execute: async ({ path, content }) => {
        const fullPath = safePath(cwd, path); await sandbox.files.write(fullPath, content); await event("file_written", path, { path, bytes: Buffer.byteLength(content) }); return { path, ok: true };
      }}),
      git_branch_create: tool({ description: "Create and switch to the approved task branch.", inputSchema: z.object({ branch: z.string().regex(/^opendevin\/[A-Za-z0-9_-]+\/[a-z0-9-]+$/) }), execute: ({ branch }) => command(`git switch -c ${branch}`) }),
    } : {}),
  };
}
