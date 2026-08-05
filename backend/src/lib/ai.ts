import Sandbox from "@e2b/code-interpreter";
import { tool } from "ai";
import z from "zod";

const truncate = (value: string, max = 30_000) =>
  value.length > max ? `${value.slice(0, max)}\n…(output truncated)` : value;

export function sandboxTools(sandbox: Sandbox, cwd: string) {
  return {
    run_command: tool({
      description:
        "Run a shell command inside the attached E2B sandbox. Use this for inspecting, testing, and modifying the checked-out repository.",
      inputSchema: z.object({
        command: z.string().min(1).describe("The shell command to execute"),
      }),
      execute: async ({ command }) => {
        const result = await sandbox.commands.run(command, {
          cwd: cwd,
          timeoutMs: 120_000,
        });
        return {
          exitCode: result.exitCode,
          stdout: truncate(result.stdout),
          stderr: truncate(result.stderr),
          error: result.error,
        };
      },
    }),
    read_file: tool({
      description: "Read a text file from the attached sandbox.",
      inputSchema: z.object({
        path: z.string().min(1),
      }),
      execute: async ({ path }) => ({
        path,
        content: truncate(await sandbox.files.read(path)),
      }),
    }),
    edit_file: tool({
      description:
        "Make an exact text replacement in a file in the attached sandbox. The oldText must occur exactly once; use read_file first.",
      inputSchema: z.object({
        path: z.string().min(1),
        oldText: z.string().min(1),
        newText: z.string(),
      }),
      execute: async ({ path, oldText, newText }) => {
        const current = await sandbox.files.read(path);
        const occurrences = current.split(oldText).length - 1;
        if (occurrences !== 1) {
          throw new Error(
            `Expected oldText once in ${path}, but found it ${occurrences} times. Read the file and provide a more specific snippet.`,
          );
        }
        await sandbox.files.write(path, current.replace(oldText, newText));
        return { path, ok: true };
      },
    }),
    write_file: tool({
      description: "Write or replace a text file in the attached sandbox.",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
      }),
      execute: async ({ path, content }) => {
        await sandbox.files.write(path, content);
        return { path, bytes: Buffer.byteLength(content), ok: true };
      },
    }),
  };
}
