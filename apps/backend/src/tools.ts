import { tool } from "ai";
import { Sandbox } from "e2b";
import { z } from "zod";
import { LIMITS, WORKSPACE_PATH } from "./config.js";
import { sanitizeRel, shellQuote } from "./sanitize.js";
import { runSandbox } from "./sandbox.js";
import { webTools } from "./web-tools.js";
import { truncateOutput } from "./tool-output.js";

export type SandboxToolset = ReturnType<typeof sandboxTools>;

// Tool results prefixed with this sentinel become a download card in the chat
// stream instead of a plain tool marker.
export const SHARED_FILE_PREFIX = "__FILE__";
export const SHARED_FILE_URL_TTL_SECONDS = 3600;

export async function connectSandboxTools(
  sandboxId: string,
  workspacePath: string,
): Promise<{ tools: SandboxToolset; projectInstructions: string; sandbox: Sandbox } | null> {
  if (!sandboxId) return null;
  try {
    const sandbox = await Sandbox.connect(sandboxId);
    const cwd = workspacePath || WORKSPACE_PATH;
    let projectInstructions = "";
    try {
      const contents = await sandbox.files.read(`${cwd}/AGENTS.md`);
      projectInstructions = typeof contents === "string" ? contents.slice(0, 20_000) : "";
    } catch {
      // Repositories without a root AGENTS.md use the default agent instructions.
    }
    return {
      tools: sandboxTools(sandbox, cwd),
      projectInstructions,
      sandbox,
    };
  } catch {
    return null;
  }
}

export function sandboxTools(sandbox: Sandbox, workspacePath: string) {
  const cwd = workspacePath || WORKSPACE_PATH;

  // Bound discovery output in the sandbox, and preserve failures through head.
  async function discover(command: string, limit: number) {
    const result = await runSandbox(
      sandbox,
      `bash -o pipefail -c ${shellQuote(`${command} | head -n ${limit + 1}`)}`,
      cwd,
    );
    if (![0, 1, 141].includes(result.exitCode) || result.stderr.trim()) {
      return `Search failed (exit=${result.exitCode}): ${truncateOutput(result.stderr || result.stdout, 2000)}`;
    }
    const lines = result.stdout.trimEnd().split("\n").filter(Boolean);
    if (!lines.length) return "No matches.";
    return (
      truncateOutput(lines.slice(0, limit).join("\n"), LIMITS.toolStdoutChars) +
      (lines.length > limit ? "\nMore results; narrow the path/pattern or increase limit." : "")
    );
  }

  return {
    ...webTools(),
    list_files: tool({
      description:
        "Find workspace files by filename glob (e.g. '*.ts'). Excludes .git/node_modules. Narrow path/pattern before reading.",
      inputSchema: z.object({
        path: z.string().default("."),
        pattern: z.string().min(1).max(200).default("*"),
        limit: z.number().int().min(1).max(200).default(100),
      }),
      execute: async ({ path, pattern, limit }) => {
        const rel = sanitizeRel(path);
        if (rel === null) return "Invalid path.";
        const target = shellQuote(rel ? `./${rel}` : ".");
        const glob = shellQuote(pattern);
        const rgGlob = pattern === "*" ? "" : ` --glob ${glob}`;
        return discover(
          `if command -v rg >/dev/null 2>&1; then rg --files --hidden${rgGlob} --glob '!.git' --glob '!node_modules' -- ${target}; else find ${target} -type d \\( -name .git -o -name node_modules \\) -prune -o -type f -name ${glob} -print; fi`,
          limit,
        );
      },
    }),
    read_file: tool({
      description:
        "Read a workspace text file with line numbers. Use start_line/line_count for targeted reads; line numbers are not file content.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path, e.g. 'package.json'"),
        start_line: z.number().int().min(1).default(1),
        line_count: z.number().int().min(1).max(500).default(200),
      }),
      execute: async ({ path, start_line, line_count }) => {
        const rel = sanitizeRel(path);
        if (rel === null || rel === "")
          return "Invalid path: must be a workspace-relative file, without '..'.";
        const content = await sandbox.files.read(`${cwd}/${rel}`);
        const lines = content.split(/\r?\n/);
        if (lines.at(-1) === "") lines.pop();
        if (!lines.length) return `${rel}: empty file.`;
        if (start_line > lines.length)
          return `${rel}: ${lines.length} lines; start_line is past EOF.`;
        const selected: string[] = [];
        let chars = 0;
        for (let i = start_line - 1; i < Math.min(lines.length, start_line - 1 + line_count); i++) {
          const line = `${i + 1}: ${lines[i]}`;
          if (selected.length && chars + line.length + 1 > LIMITS.toolFileReadChars) break;
          selected.push(truncateOutput(line, LIMITS.toolFileReadChars));
          chars += line.length + 1;
        }
        const end = start_line + selected.length - 1;
        return (
          `${rel} (${start_line}-${end} of ${lines.length} lines)\n${selected.join("\n")}` +
          (end < lines.length ? `\nContinue with start_line=${end + 1}.` : "")
        );
      },
    }),
    run_command: tool({
      description:
        "Run a workspace shell command; returns exit code and bounded stdout/stderr, including failures. Batch independent inspections in one call. No sudo. Background servers with nohup ... &.",
      inputSchema: z.object({
        command: z.string().describe("Shell command, e.g. 'ls -la && cat package.json'"),
        timeoutMs: z.number().int().min(1000).max(300_000).default(60_000),
        max_output_chars: z.number().int().min(500).max(LIMITS.toolStdoutChars).default(6000),
      }),
      execute: async ({ command, timeoutMs, max_output_chars }) => {
        const result = await runSandbox(sandbox, command, cwd, timeoutMs);
        return (
          `exit=${result.exitCode}` +
          (result.stdout ? `\nstdout:\n${truncateOutput(result.stdout, max_output_chars)}` : "") +
          (result.stderr
            ? `\nstderr:\n${truncateOutput(result.stderr, LIMITS.toolStderrChars)}`
            : "")
        );
      },
    }),
    write_file: tool({
      description:
        "Write or overwrite a text file in the workspace. Path is relative to workspace root.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
        content: z.string().max(LIMITS.fileWriteChars).describe("Full new file content"),
      }),
      execute: async ({ path, content }) => {
        const rel = sanitizeRel(path);
        if (rel === null || rel === "")
          return "Invalid path: must be a workspace-relative file, without '..'.";
        await sandbox.files.write(`${cwd}/${rel}`, content);
        return `Wrote ${rel} (${content.length} chars)`;
      },
    }),
    ask_user: tool({
      description:
        "Ask a blocking clarification in a questionnaire with 2-6 options and a custom answer field. Wait for submission; the answer will be returned as this tool's result. Make reasonable assumptions for routine choices.",
      inputSchema: z.object({
        question: z.string().describe("The clarifying question"),
        options: z.array(z.string()).min(2).max(6).describe("2-6 short answer options"),
      }),
      execute: async () => "Questionnaire shown. Waiting for the user to submit an answer.",
    }),
    edit_file: tool({
      description:
        "Patch a text file with an exact string replacement. Prefer over write_file for small changes. old_string must appear exactly once.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
        old_string: z.string().min(1).max(50_000).describe("Exact text to replace"),
        new_string: z.string().max(LIMITS.fileWriteChars).describe("Replacement text"),
      }),
      execute: async ({ path, old_string, new_string }) => {
        const rel = sanitizeRel(path);
        if (rel === null || rel === "")
          return "Invalid path: must be a workspace-relative file, without '..'.";
        const text = await sandbox.files.read(`${cwd}/${rel}`);
        const first = text.indexOf(old_string);
        if (first === -1) return "old_string not found in file.";
        if (text.indexOf(old_string, first + 1) !== -1)
          return "old_string matches multiple locations: include more context to make it unique.";
        const next = text.slice(0, first) + new_string + text.slice(first + old_string.length);
        await sandbox.files.write(`${cwd}/${rel}`, next);
        return `Patched ${rel} (${old_string.length} -> ${new_string.length} chars)`;
      },
    }),
    search: tool({
      description:
        "Search workspace text with ripgrep. Use mode=files to locate files cheaply, or content for matching lines. Narrow dir/glob to reduce output. Excludes .git/node_modules.",
      inputSchema: z.object({
        pattern: z.string().min(1).max(300).describe("Regex, e.g. 'useState'"),
        dir: z.string().default(".").describe("Relative dir to search"),
        glob: z.string().min(1).max(200).optional().describe("Filename glob, e.g. '*.tsx'"),
        mode: z.enum(["content", "files"]).default("content"),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      execute: async ({ pattern, dir, glob, mode, limit }) => {
        const rel = sanitizeRel(dir);
        if (rel === null) return "Invalid dir.";
        const target = shellQuote(rel ? `./${rel}` : ".");
        const query = shellQuote(pattern);
        const rgGlob = glob ? ` --glob ${shellQuote(glob)}` : "";
        const grepGlob = glob ? ` --include=${shellQuote(glob)}` : "";
        return discover(
          `if command -v rg >/dev/null 2>&1; then rg ${mode === "files" ? "--files-with-matches" : "--no-heading --line-number"} --hidden${rgGlob} --glob '!.git' --glob '!node_modules' -M 500 -e ${query} -- ${target}; else grep -rIE${mode === "files" ? "l" : "n"} --exclude-dir=.git --exclude-dir=node_modules${grepGlob} -- ${query} ${target}; fi`,
          limit,
        );
      },
    }),
    share_file: tool({
      description:
        "Share a workspace file as a download card. Use when the user requests a file. The card appears automatically; do not repeat its link or name in your reply.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path, e.g. 'report.pdf'"),
      }),
      execute: async ({ path }) => {
        const rel = sanitizeRel(path);
        if (rel === null || rel === "")
          return "Invalid path: must be a workspace-relative file, without '..'.";
        try {
          const full = `${cwd}/${rel}`;
          const info = await sandbox.files.getInfo(full);
          if (info.type === "dir") return "Cannot share a directory; share a file instead.";
          const url = await sandbox.downloadUrl(full, {
            useSignatureExpiration: SHARED_FILE_URL_TTL_SECONDS,
          });
          return `${SHARED_FILE_PREFIX}${JSON.stringify({
            name: rel.split("/").pop() || rel,
            path: rel,
            url,
            size: info.size,
          })}`;
        } catch {
          return `Could not share ${rel}: the file was not found in the workspace.`;
        }
      },
    }),
    update_plan: tool({
      description:
        "Publish progress for multi-step work. Skip for simple tasks. Statuses: pending|in_progress|done.",
      inputSchema: z.object({
        tasks: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(200).describe("Short step title"),
              status: z.enum(["pending", "in_progress", "done"]).describe("Step status"),
            }),
          )
          .min(1)
          .max(12),
      }),
      execute: async ({ tasks }) => `__PLAN__${JSON.stringify(tasks)}`,
    }),
  };
}
