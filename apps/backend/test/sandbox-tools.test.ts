import assert from "node:assert/strict";
import test from "node:test";
import type { Tool } from "ai";
import { CommandExitError, type Sandbox } from "e2b";
import { z } from "zod";
import { sandboxTools } from "../src/tools.js";

function fixture(
  content = "",
  run = async (_command: string, _options: unknown) => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
  }),
) {
  const writes: string[] = [];
  const sandbox = {
    files: {
      read: async () => content,
      write: async (_path: string, text: string) => {
        writes.push(text);
      },
    },
    commands: { run },
  } as unknown as Sandbox;
  return { tools: sandboxTools(sandbox, "/workspace"), writes };
}

const callOptions = { toolCallId: "test", messages: [] };

async function execute<Input>(tool: Tool<Input, string>, input: unknown) {
  const parsed = (tool.inputSchema as z.ZodType<Input>).parse(input);
  const result = await tool.execute!(parsed, callOptions);
  assert.ok(typeof result === "string");
  return result;
}

test("reads targeted lines and supplies a continuation without silently losing later lines", async () => {
  const { tools } = fixture("first\r\nsecond\r\nthird\r\nfourth\r\n");
  const input = {
    path: "file.ts",
    start_line: 2,
    line_count: 2,
  };
  const result = await execute(tools.read_file, input);
  assert.equal(
    result,
    "file.ts (2-3 of 4 lines)\n2: second\n3: third\nContinue with start_line=4.",
  );
  assert.match(await execute(tools.read_file, { ...input, start_line: 5 }), /past EOF/);
});

test("bounds large reads on line boundaries and identifies truncated long lines", async () => {
  const { tools } = fixture(Array.from({ length: 300 }, () => "x".repeat(100)).join("\n"));
  const input = { path: "large.ts" };
  const result = await execute(tools.read_file, input);
  assert.ok(result.length < 12_200);
  const next = Number(/Continue with start_line=(\d+)/.exec(result)?.[1]);
  assert.ok(next > 1 && next < 200);
  const page = await execute(tools.read_file, { ...input, start_line: next });
  assert.match(page, new RegExp(`\\n${next}: `));
  const long = fixture("start" + "x".repeat(30_000) + "end");
  const line = await execute(long.tools.read_file, input);
  assert.match(line, /output truncated/);
  assert.match(line, /end$/);
});

test("returns nonzero command status and retains the end of long failure logs", async () => {
  const { tools } = fixture("", async () => {
    throw new CommandExitError({
      exitCode: 2,
      stdout: "begin\n" + "x".repeat(20_000) + "\nfinal summary",
      stderr: "test failed",
    });
  });
  const result = await execute(tools.run_command, { command: "pnpm test" });
  assert.match(result, /^exit=2/);
  assert.match(result, /begin/);
  assert.match(result, /output truncated/);
  assert.match(result, /final summary/);
  assert.match(result, /test failed/);
  assert.ok(result.length < 6200);
});

test("distinguishes no matches from invalid searches and reports capped discovery results", async () => {
  let command = "";
  let output = { exitCode: 0, stdout: "a.ts\nb.ts\nc.ts\n", stderr: "" };
  const { tools } = fixture("", async (value) => {
    command = value;
    return output;
  });
  const input = { limit: 2 };
  assert.equal(
    await execute(tools.list_files, input),
    "a.ts\nb.ts\nMore results; narrow the path/pattern or increase limit.",
  );
  assert.match(command, /pipefail/);
  assert.match(command, /head -n 3/);
  const query = { pattern: "[", mode: "files", glob: "*.ts" };
  output = { exitCode: 2, stdout: "", stderr: "regex parse error" };
  assert.match(await execute(tools.search, query), /Search failed.*regex parse error/);
  assert.match(command, /--files-with-matches/);
  output = { exitCode: 1, stdout: "", stderr: "" };
  assert.equal(await execute(tools.search, query), "No matches.");
});

test("rejects traversal and ambiguous edits without writing any content", async () => {
  const { tools, writes } = fixture("same\nsame\n");
  assert.match(await execute(tools.read_file, { path: "../secret" }), /Invalid path/);
  assert.match(
    await execute(tools.edit_file, {
      path: "file.ts",
      old_string: "same",
      new_string: "changed",
    }),
    /multiple locations/,
  );
  assert.deepEqual(writes, []);
});
