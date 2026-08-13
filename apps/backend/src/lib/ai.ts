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

const shellArg = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function browserCommand(sandbox: Sandbox, args: string[]) {
  // agent-browser keeps a named daemon alive in the sandbox, so the agent and
  // the browser panel share the same tabs and cookies.
  const command = `npx --yes agent-browser --session opendevin ${args.map(shellArg).join(" ")}`;
  const result = await sandbox.commands.run(command, { timeoutMs: 120_000 });
  return {
    exitCode: result.exitCode,
    stdout: bounded(result.stdout),
    stderr: bounded(result.stderr),
    error: result.error,
  };
}

async function webSearch(query: string) {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; OpenDevin)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Web search failed with status ${response.status}.`);
  const html = await response.text();
  const results: { title: string; url: string; snippet: string }[] = [];
  const blocks = html.split('<div class="result ');
  for (const block of blocks.slice(1)) {
    const title = block.match(/class="result__a"[^>]*>([^<]+)</)?.[1]?.trim();
    const url = decodeURIComponent(block.match(/class="result__a"[^>]*href="([^"]+)"/)?.[1] ?? "");
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1]?.replace(/<[^>]+>/g, "").trim();
    if (title && url) results.push({ title, url, snippet: snippet ?? "" });
    if (results.length >= 5) break;
  }
  return { query, results };
}

export function sandboxTools(sandbox: Sandbox, cwd: string) {
  const command = async (value: string) => {
    safeCommand(value);
    const result = await sandbox.commands.run(value, { cwd, timeoutMs: 120_000 });
    return { exitCode: result.exitCode, stdout: bounded(result.stdout), stderr: bounded(result.stderr), error: result.error };
  };
  return {
    run_command: tool({ description: "Run a command in the repository.", inputSchema: z.object({ command: z.string().min(1) }), execute: ({ command: value }) => command(value) }),
    read_file: tool({ description: "Read a repository-relative text file.", inputSchema: z.object({ path: z.string().min(1) }), execute: async ({ path }) => {
      const relative = safePath(cwd, path); const value = await sandbox.files.read(relative); return { path, ...bounded(value) };
    }}),
    edit_file: tool({ description: "Replace one exact string in a repository-relative file.", inputSchema: z.object({ path: z.string().min(1), oldText: z.string().min(1), newText: z.string() }), execute: async ({ path, oldText, newText }) => {
      const fullPath = safePath(cwd, path); const current = await sandbox.files.read(fullPath); const occurrences = current.split(oldText).length - 1;
      if (occurrences !== 1) throw new Error(`Expected oldText once in ${path}, found ${occurrences}.`);
      await sandbox.files.write(fullPath, current.replace(oldText, newText)); return { path, ok: true };
    }}),
    write_file: tool({ description: "Write a repository-relative text file.", inputSchema: z.object({ path: z.string().min(1), content: z.string() }), execute: async ({ path, content }) => {
      const fullPath = safePath(cwd, path); await sandbox.files.write(fullPath, content); return { path, ok: true, bytes: Buffer.byteLength(content) };
    }}),
    web_search: tool({ description: "Search the web for up-to-date information and return the top result titles, URLs, and snippets.", inputSchema: z.object({ query: z.string().min(1) }), execute: ({ query }) => webSearch(query) }),
    browser: tool({
      description: "Control the session's visible agent-browser. Use open first, then snapshot before interacting. Actions: open (url), snapshot, click (ref), fill (ref and value), type (ref and value), screenshot, get_url.",
      inputSchema: z.object({
        action: z.enum(["open", "snapshot", "click", "fill", "type", "screenshot", "get_url"]),
        url: z.string().optional(),
        ref: z.string().optional(),
        value: z.string().optional(),
      }),
      execute: async ({ action, url, ref, value }) => {
        const args: string[] = [action];
        if (action === "open") {
          if (!url) throw new Error("browser open requires url");
          args.push(url);
        } else if (["click", "fill", "type"].includes(action)) {
          if (!ref) throw new Error(`browser ${action} requires ref`);
          args.push(ref);
          if (action !== "click") {
            if (value === undefined) throw new Error(`browser ${action} requires value`);
            args.push(value);
          }
        } else if (action === "snapshot") {
          args.push("-i");
        } else if (action === "screenshot") {
          args.push("/tmp/opendevin-browser.png");
        }
        return browserCommand(sandbox, args);
      },
    }),
  };
}