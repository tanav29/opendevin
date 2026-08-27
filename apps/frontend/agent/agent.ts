import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { tool, stepCountIs } from "ai";
import path from "node:path";
import { z } from "zod";
import { searchWeb } from "./tools/web-search";
import type { Sandbox } from "e2b";
import { WORKSPACE } from "@/lib/e2b";

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

export const model = openrouter.chat("nvidia/nemotron-3.5-lightning:free");
export const instructions = `You are OpenDevin, an autonomous coding agent. Work directly in /workspace.
Inspect before editing, make focused changes, and verify them with commands. Never expose secrets.
Use the available tools for repository work. Explain what you are doing briefly before tool calls.`;

function safePath(root: string, filePath: string) {
  const resolved = path.resolve(root, filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("Path is outside the workspace.");
  return resolved;
}

export function createTools(sandbox: Sandbox, env: Record<string, string> = {}) {
  const pathSchema = z.object({ filePath: z.string().min(1) });
  return {
    read_file: tool({
      description: "Read a text file from the repository.",
      inputSchema: pathSchema,
      execute: async ({ filePath }) => {
        const content = await sandbox.files.read(safePath(WORKSPACE, filePath));
        return { content, totalLines: content.split("\n").length };
      },
    }),
    write_file: tool({
      description: "Create or replace a text file in the repository.",
      inputSchema: pathSchema.extend({ content: z.string() }),
      execute: async ({ filePath, content }) => {
        const target = safePath(WORKSPACE, filePath);
        let existed = true;
        try { await sandbox.files.read(target); } catch { existed = false; }
        await sandbox.files.write(target, content);
        return { content, existed };
      },
    }),
    edit_file: tool({
      description: "Replace one exact string in a file. Use read_file first.",
      inputSchema: pathSchema.extend({ oldText: z.string(), newText: z.string() }),
      execute: async ({ filePath, oldText, newText }) => {
        const target = safePath(WORKSPACE, filePath);
        const content = await sandbox.files.read(target);
        if (!content.includes(oldText)) throw new Error("oldText was not found in the file.");
        if (content.indexOf(oldText) !== content.lastIndexOf(oldText)) throw new Error("oldText must match exactly once.");
        await sandbox.files.write(target, content.replace(oldText, newText));
        return { content: newText, existed: true };
      },
    }),
    bash: tool({
      description: "Run a shell command in the repository. Do not use destructive commands.",
      inputSchema: z.object({ command: z.string().min(1) }),
      execute: async ({ command }) => {
        try {
          const result = await sandbox.commands.run(command, { cwd: WORKSPACE, envs: env, timeoutMs: 120_000 });
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
        } catch (error) {
          const result = error as { stdout?: string; stderr?: string; exitCode?: number };
          return { stdout: result.stdout ?? "", stderr: result.stderr ?? String(error), exitCode: result.exitCode ?? 1 };
        }
      },
    }),
    glob: tool({
      description: "Find repository files matching a glob pattern.",
      inputSchema: z.object({ pattern: z.string().min(1) }),
      execute: async ({ pattern }) => {
        const result = await sandbox.commands.run(`find . -type f -name '${pattern.replaceAll("'", "'\\''")}'`, { cwd: WORKSPACE });
        const content = result.stdout.trim();
        return { content, count: content ? content.split(/\r?\n/).length : 0 };
      },
    }),
    grep: tool({
      description: "Search repository files for a text pattern.",
      inputSchema: z.object({ pattern: z.string().min(1) }),
      execute: async ({ pattern }) => {
        const result = await sandbox.commands.run(`rg -n --hidden --glob '!node_modules' '${pattern.replaceAll("'", "'\\''")}'`, { cwd: WORKSPACE });
        const content = result.stdout.trim();
        return { content, matchCount: content ? content.split(/\r?\n/).length : 0 };
      },
    }),
    web_search: tool({
      description: "Search the web for current information.",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: ({ query }) => searchWeb(query),
    }),
  };
}

export { stepCountIs };
