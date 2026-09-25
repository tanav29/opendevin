import assert from "node:assert/strict";
import test from "node:test";
import { drainAgentStream } from "../src/chat.js";

function stream(parts: unknown[]) {
  return {
    fullStream: (async function* () {
      for (const part of parts) yield part;
    })(),
    response: Promise.resolve({ messages: [] }),
    text: Promise.resolve(""),
    usage: Promise.resolve(undefined),
  };
}

test("does not treat a generic tool-only stream as an assistant response", async () => {
  let visible = "";
  const result = await drainAgentStream(
    stream([
      { type: "tool-call", toolName: "read_file", input: { path: "README.md" } },
      { type: "tool-result", toolName: "read_file", output: "contents" },
    ]),
    (chunk) => {
      visible += chunk;
    },
  );
  assert.equal(result.visibleText, "");
  assert.match(visible, /data-tool="call"/);
});

test("keeps clarification questions as visible assistant output", async () => {
  const result = await drainAgentStream(
    stream([{ type: "tool-call", toolName: "ask_user", input: { question: "Which option?" } }]),
    () => undefined,
  );
  assert.match(result.visibleText, /data-question/);
});

test("keeps model text as visible assistant output", async () => {
  const result = await drainAgentStream(
    stream([{ type: "text-delta", text: "Done." }]),
    () => undefined,
  );
  assert.equal(result.visibleText, "Done.");
});
