import assert from "node:assert/strict";
import test from "node:test";
import { streamText, type TextStreamPart, type ToolSet } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV2 } from "ai/test";
import type { Sandbox } from "e2b";
import { AGENT_STOP, sanitizeToolHistory } from "../src/agent.js";
import {
  activeTurns,
  claimAgentTurn,
  drainAgentStream,
  releaseAgentTurn,
  stopAgentTurn,
} from "../src/chat.js";
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
  assert.equal(result.text, visible);
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

test("streams and persists tool suggestions outside the tool details", async () => {
  const suggestion = 'Check <input> & the user\'s "settings"';
  const output = { suggestions: [suggestion, "Run tests", suggestion, " ", null, 42] };
  for (const value of [output, JSON.stringify(output)]) {
    let streamed = "";
    const result = await drainAgentStream(
      stream([
        { type: "tool-call", toolCallId: "suggest", toolName: "review", input: {} },
        {
          type: "tool-result",
          toolCallId: "suggest",
          toolName: "review",
          input: {},
          output: value,
        },
      ]),
      (chunk) => {
        streamed += chunk;
      },
    );
    const payload = streamed.match(/<div data-suggestions='(.*)'>/)?.[1];
    assert.ok(payload);
    assert.deepEqual(JSON.parse(payload.replace(/&#39;/g, "'")), [suggestion, "Run tests"]);
    assert.doesNotMatch(payload, /[<>&](?!#39;)/);
    assert.ok(streamed.indexOf("</details>") < streamed.indexOf("data-suggestions"));
    assert.match(result.visibleText, /data-suggestions/);
    assert.equal(result.text, streamed);
  }
});

test("ignores unrelated or malformed tool outputs when looking for suggestions", async () => {
  for (const output of ["plain text", "{", null, {}, { suggestions: "Run tests" }]) {
    const result = await drainAgentStream(
      stream([
        { type: "tool-result", toolCallId: "read", toolName: "read_file", input: {}, output },
      ]),
      () => undefined,
    );
    assert.doesNotMatch(result.text, /data-suggestions/);
    assert.equal(result.visibleText, "");
  }
});

test("does not persist an aborted stream as a completed reply", async () => {
  await assert.rejects(
    drainAgentStream(
      stream([{ type: "text-delta", id: "text", text: "Still working." }, { type: "abort" }]),
      () => undefined,
    ),
    { name: "AbortError" },
  );
});

test("keeps a stopped turn reserved until its owner finishes", () => {
  const controller = claimAgentTurn("stopping", "chat")!;
  try {
    assert.equal(stopAgentTurn("stopping"), true);
    assert.equal(controller.signal.aborted, true);
    assert.equal(claimAgentTurn("stopping", "chat"), null);
    releaseAgentTurn("stopping", new AbortController());
    assert.equal(activeTurns.has("stopping"), true);
  } finally {
    releaseAgentTurn("stopping", controller);
  }
  assert.equal(activeTurns.has("stopping"), false);
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

test("streams and replays redacted, bounded command activity with its exit status", async () => {
  for (const [output, failed] of [
    ["exit=0\nstdout:\nok", false],
    ["exit=1\nstderr:\nTOKEN=hidden-value", true],
    ["exit=0", false],
    ["exit=0\nstdout:\n" + "x".repeat(30000), false],
  ] as const) {
    let live = "";
    const result = await drainAgentStream(
      stream([
        {
          type: "tool-call",
          toolCallId: "cmd",
          toolName: "run_command",
          input: { command: "echo hidden-value" },
        },
        { type: "tool-result", toolCallId: "cmd", toolName: "run_command", input: {}, output },
        { type: "text-delta", id: "t", text: "Done" },
      ]),
      (chunk) => {
        live += chunk;
      },
      undefined,
      ["hidden-value"],
    );
    assert.equal(result.text, live);
    assert.equal(live.includes('data-tool-status="failed"'), failed);
    assert.match(live, /data-tool-output=/);
    assert.doesNotMatch(live, /hidden-value/);
    assert.ok(live.length < 13000);
    if (output.length > 30000) assert.match(live, /output truncated/);
  }
});

test("tool invocation errors have a distinct failure message", async () => {
  const result = await drainAgentStream(
    stream([
      { type: "tool-call", toolCallId: "cmd", toolName: "run_command", input: {} },
      {
        type: "tool-error",
        toolCallId: "cmd",
        toolName: "run_command",
        input: {},
        error: new Error("private"),
      },
    ]),
    () => undefined,
  );
  assert.match(result.text, /Tool invocation failed/);
  assert.match(result.text, /data-tool-status="failed"/);
  assert.doesNotMatch(result.text, /private/);
});

test("redacts tool history while retaining messages for replay", () => {
  const messages = [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "1",
          toolName: "run_command",
          input: { command: "echo known-secret" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "1",
          toolName: "run_command",
          output: { type: "text", value: "exit=1\nstderr:\nBearer abc123 known-secret" },
        },
      ],
    },
  ] as Parameters<typeof sanitizeToolHistory>[0];
  const replay = JSON.stringify(sanitizeToolHistory(messages, ["known-secret"]));
  assert.doesNotMatch(replay, /known-secret|abc123/);
  assert.match(replay, /exit=1/);
  assert.match(replay, /redacted/);
});
