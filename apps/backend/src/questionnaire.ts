import type { ModelMessage } from "ai";

// Keep the answer in model tool history, while the UI stores only completion state.
export function answerQuestionnaire(content: string, history: ModelMessage[], answer: string) {
  const match = [...content.matchAll(/<div data-question='(.*)'>/g)].at(-1);
  if (!match) return null;
  try {
    const question = JSON.parse(match[1].replace(/&#39;/g, "'"));
    if (!question || question.answered || typeof question.question !== "string") return null;
    const calls = history.flatMap((message) =>
      message.role === "assistant" && Array.isArray(message.content)
        ? message.content.filter(
            (part) => part.type === "tool-call" && part.toolName === "ask_user",
          )
        : [],
    );
    const call = calls.at(-1);
    if (!call || call.type !== "tool-call") return null;
    const input = call.input as { question?: string };
    if (
      input?.question?.slice(0, 500) !== question.question ||
      (question.toolCallId && question.toolCallId !== call.toolCallId)
    )
      return null;
    let updated = false;
    const modelHistory = history.map((message) => {
      if (message.role !== "tool") return message;
      return {
        ...message,
        content: message.content.map((part) => {
          if (part.type !== "tool-result" || part.toolCallId !== call.toolCallId) return part;
          updated = true;
          return { ...part, output: { type: "text" as const, value: answer } };
        }),
      };
    });
    if (!updated) return null;
    const payload = JSON.stringify({ ...question, answered: true }).replace(/'/g, "&#39;");
    return {
      content:
        content.slice(0, match.index) +
        `<div data-question='${payload}'>` +
        content.slice(match.index! + match[0].length),
      modelHistory,
    };
  } catch {
    return null;
  }
}
