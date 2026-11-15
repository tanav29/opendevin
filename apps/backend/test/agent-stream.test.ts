import assert from "node:assert/strict";
import test from "node:test";
import { streamText, type TextStreamPart, type ToolSet } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV2 } from "ai/test";
import type { Sandbox } from "e2b";
import { AGENT_STOP } from "../src/agent.js";
import { drainAgentStream } from "../src/chat.js";
import { sandboxTools } from "../src/tools.js";

function stream(parts: TextStreamPart<ToolSet>[]) {
  return {
    fullStream: (async function* () {
      for (const part of parts) yield part;
    })(),
    response: Promise.resolve({ messages: [] }),
    text: Promise.resolve(""),
    totalUsage: Promise.resolve(undefined),
  };
}

test("does not treat a generic tool-only stream as an assistant response", async () => {
  let visible = "";
  const result = await drainAgentStream(
    stream([
      {
        type: "tool-call",
        toolCallId: "read",
        toolName: "read_file",
        input: { path: "README.md" },
      },
      {
        type: "tool-result",
        toolCallId: "read",
        toolName: "read_file",
        input: { path: "README.md" },
        output: "contents",
      },
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
    stream([
      {
        type: "tool-call",
        toolCallId: "ask",
        toolName: "ask_user",
        input: { question: "Which option?" },
      },
    ]),
    () => undefined,
  );
  assert.match(result.visibleText, /data-question/);
});

test("keeps model text as visible assistant output", async () => {
  const result = await drainAgentStream(
    stream([{ type: "text-delta", id: "text", text: "Done." }]),
    () => undefined,
  );
  assert.equal(result.visibleText, "Done.");
});

test("streams a download card for shared files without exposing tool markers", async () => {
  let streamed = "";
  const result = await drainAgentStream(
    stream([
      {
        type: "tool-call",
        toolCallId: "share",
        toolName: "share_file",
        input: { path: "report.txt" },
      },
      {
        type: "tool-result",
        toolCallId: "share",
        toolName: "share_file",
        input: { path: "report.txt" },
        output: `__FILE__${JSON.stringify({
          name: "report.txt",
          path: "report.txt",
          url: "https://example.com/report.txt",
          size: 12,
        })}`,
      },
    ]),
    (chunk) => {
      streamed += chunk;
    },
    undefined,
    false,
  );
  assert.match(result.visibleText, /data-file=/);
  assert.match(streamed, /data-file=/);
  assert.doesNotMatch(streamed, /data-tool/);
});

test("propagates SDK stream errors", async () => {
  const error = new Error("Provider unavailable");
  await assert.rejects(
    drainAgentStream(stream([{ type: "error", error }]), () => undefined),
    error,
  );
});

test("reports the SDK token totals across all steps", async () => {
  const usage = { inputTokens: 120, outputTokens: 30, totalTokens: 150 };
  const result = await drainAgentStream(
    {
      ...stream([]),
      totalUsage: Promise.resolve(usage),
    },
    () => undefined,
  );
  assert.deepEqual(result.usage, usage);
});

test("the SDK stops after asking a blocking question without another model call", async () => {
  const model = new MockLanguageModelV2({
    doStream: {
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        {
          type: "tool-call",
          toolCallId: "ask",
          toolName: "ask_user",
          input: JSON.stringify({ question: "Which target?", options: ["Web", "Mobile"] }),
        },
        {
          type: "finish",
          finishReason: "tool-calls",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      ]),
    },
  });
  const { ask_user } = sandboxTools({} as Sandbox, "/workspace");
  const result = streamText({
    model,
    prompt: "Ask me which target.",
    tools: { ask_user },
    stopWhen: AGENT_STOP,
  });
  const turn = await drainAgentStream(result, () => undefined);
  assert.equal(model.doStreamCalls.length, 1);
  assert.match(turn.visibleText, /Which target/);
  assert.equal(turn.usage?.totalTokens, 15);
});
