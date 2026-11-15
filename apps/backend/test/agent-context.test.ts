import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "ai";
import { compactToolContext, trimToolLog } from "../src/agent.js";

function toolPair(id: string, text: string): ModelMessage[] {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: id,
          toolName: "write_file",
          input: { path: "file.ts", content: text },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: id,
          toolName: "write_file",
          output: { type: "text", value: text },
        },
      ],
    },
  ];
}

test("prunes old tool pairs without mutating history or removing user and progress text", () => {
  const large = "start" + "x".repeat(20_000) + "end";
  const history: ModelMessage[] = [
    { role: "user", content: "Keep the original task." },
    ...toolPair("old", large),
    { role: "assistant", content: "Keep progress text." },
    ...toolPair("recent-1", large),
    ...toolPair("recent-2", large),
    { role: "user", content: "Keep my latest request." },
    { role: "assistant", content: "Working." },
  ];
  const original = structuredClone(history);
  const compact = compactToolContext(history);
  assert.deepEqual(history, original);
  assert.equal(compact.length, history.length - 2);
  assert.deepEqual(compact.slice(-6), history.slice(-6));
  assert.deepEqual(compact[0], history[0]);
  assert.deepEqual(compact[1], history[3]);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(history).length - 30_000);
  assert.doesNotMatch(JSON.stringify(compact), /"toolCallId":"old"/);
});

test("SDK pruning keeps both sides of a tool pair across its recent-message boundary", () => {
  const pair = toolPair("boundary", "result");
  const history: ModelMessage[] = [
    ...pair,
    ...Array.from({ length: 5 }, (_, i): ModelMessage => ({
      role: "user",
      content: `message ${i}`,
    })),
  ];
  assert.deepEqual(compactToolContext(history), history);
});

test("trimming across a tool boundary retains its assistant call, including a trailing result", () => {
  const pair = toolPair("pair", "small");
  assert.deepEqual(trimToolLog([{ role: "user", content: "Task" }, ...pair], 1), pair);
  const latest: ModelMessage = { role: "user", content: "Continue" };
  assert.deepEqual(trimToolLog([...pair, latest], 2), [...pair, latest]);
  assert.deepEqual(trimToolLog([], 1), []);
});
