import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "ai";
import { toolCallMarker } from "../src/chat.js";
import { answerQuestionnaire } from "../src/questionnaire.js";

const input = { question: "What's the target?", options: ["Web", "Mobile"] };
const content = `${toolCallMarker("ask_user", input, "ask")}\n</div>\n`;
const history: ModelMessage[] = [
  { role: "user", content: "Help me build an app." },
  {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "ask", toolName: "ask_user", input }],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "read",
        toolName: "read_file",
        output: { type: "text", value: "File contents" },
      },
      {
        type: "tool-result",
        toolCallId: "ask",
        toolName: "ask_user",
        output: { type: "text", value: "Waiting" },
      },
    ],
  },
];

test("answers a questionnaire through its tool result without adding a chat message", () => {
  const answered = answerQuestionnaire(content, history, "A desktop app, please")!;
  assert.ok(answered);
  assert.match(answered.content, /"answered":true/);
  assert.doesNotMatch(answered.content, /A desktop app/);
  assert.equal(answered.modelHistory.length, history.length);
  assert.deepEqual(answered.modelHistory.at(-1), {
    role: "tool",
    content: [
      history[2].content[0],
      {
        type: "tool-result",
        toolCallId: "ask",
        toolName: "ask_user",
        output: { type: "text", value: "A desktop app, please" },
      },
    ],
  });
  assert.doesNotMatch(content, /"answered"/);
  assert.equal(answerQuestionnaire(answered.content, answered.modelHistory, "Again"), null);
});

test("rejects malformed, unrelated, or missing questionnaire calls and results", () => {
  for (const invalid of [
    "plain text",
    "<div data-question='broken'>",
    content.replace('"ask"', '"other"'),
  ]) {
    assert.equal(answerQuestionnaire(invalid, history, "Web"), null);
  }
  assert.equal(answerQuestionnaire(content, history.slice(0, 2), "Web"), null);
  assert.equal(answerQuestionnaire(content, [], "Web"), null);
});

test("supports pending questionnaires saved before tool call IDs were included", () => {
  const legacy = toolCallMarker("ask_user", input);
  assert.ok(answerQuestionnaire(legacy, history, "Mobile"));
});
