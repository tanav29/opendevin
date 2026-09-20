import { tool } from "ai";
import { Sandbox } from "e2b";
import { z } from "zod";
import { WORKSPACE_PATH } from "./config.js";
import { sanitizeRel, shellQuote } from "./sanitize.js";
import { runSandbox } from "./sandbox.js";

export type SandboxToolset = ReturnType<typeof sandboxTools>;

// Attach sandbox tools when the workspace sandbox is reachable, otherwise
// return a note so the agent answers from general knowledge.
export async function connectSandboxTools(
  sandboxId: string,
  workspacePath: string,
): Promise<{ tools: SandboxToolset | undefined; sandboxNote: string }> {
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
        "Search text in the workspace with ripgrep (excludes .git/node_modules). Use to find symbols, imports, TODOs before reading files.",
      inputSchema: z.object({
        pattern: z.string().describe("Fixed string or regex, e.g. 'useState'"),
        dir: z.string().default(".").describe("Relative dir to search"),
      }),
      execute: async ({ pattern, dir }: { pattern: string; dir?: string }) => {
        const rel = sanitizeRel(dir ?? ".");
        if (rel === null) return "Invalid dir.";
        if (!pattern || pattern.length > 300) return "Invalid pattern.";
        const target = shellQuote(rel === "" ? "." : rel);
        const query = shellQuote(pattern);
        const out = await runSandbox(
          sandbox,
          `if command -v rg >/dev/null 2>&1; then rg --no-heading --line-number --hidden --no-messages --glob '!.git/*' --glob '!node_modules/*' -M 500 -e ${query} ${target} | head -n 100; else grep -rn -I --exclude-dir=.git --exclude-dir=node_modules -- ${query} ${target} | head -n 100; fi`,
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
