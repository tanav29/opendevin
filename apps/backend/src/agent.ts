import type {
  AssistantModelMessage,
  ModelMessage,
  ToolCallPart,
  ToolContent,
  ToolModelMessage,
  ToolResultPart,
} from "ai";
import { prisma } from "./db/prisma.js";

// The toolLog column stores the authoritative, ordered model transcript for a
// session (user + assistant + tool messages), so an agent that uses tools on a
// turn can recall its own prior tool calls/results on the next turn, even
// after the server restarts. It complements the `Message` table, which keeps a
// plain-text chat timeline for the UI.

export async function loadToolLog(sessionId: string): Promise<ModelMessage[]> {
  const session = await prisma.projectSession.findUnique({
    where: { id: sessionId },
    select: { toolLog: true },
  });
  const raw = session?.toolLog || "[]";
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ModelMessage[]) : [];
  } catch {
    return [];
  }
}

export async function saveToolLog(sessionId: string, messages: ModelMessage[]) {
  await prisma.projectSession.update({
    where: { id: sessionId },
    data: { toolLog: JSON.stringify(messages) },
  });
}

type StreamPartLike = {
  type: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
};

// Accumulates the flat `fullStream` parts emitted for one assistant turn and
// converts them into the ordered assistant + tool ModelMessages a later turn
// can replay. Feed stream parts to `addPart`; call `flushStep` at each step
// boundary to emit one assistant message (text + tool-calls) followed by the
// matching tool-result message. `flushStep` is idempotent: it resets its
// buffers, so an extra safety flush after the stream is harmless.
export class TurnRecorder {
  private text = "";
  private toolCalls: ToolCallPart[] = [];
  private toolResults: ToolResultPart[] = [];

  addPart(part: StreamPartLike) {
    switch (part.type) {
      case "text-delta":
        this.text += part.text || "";
        break;
      case "tool-call":
        this.toolCalls.push({
          type: "tool-call",
          toolCallId: String(part.toolCallId ?? ""),
          toolName: String(part.toolName ?? ""),
          input: part.input,
        });
        break;
      case "tool-result":
        this.toolResults.push({
          type: "tool-result",
          toolCallId: String(part.toolCallId ?? ""),
          toolName: String(part.toolName ?? ""),
          output: asToolOutput(part.output),
        });
        break;
      case "tool-error":
        this.toolResults.push({
          type: "tool-result",
          toolCallId: String(part.toolCallId ?? ""),
          toolName: String(part.toolName ?? ""),
          output: { type: "text", value: String(part.error ?? "Tool failed") },
        });
        break;
    }
  }

  flushStep(out: ModelMessage[]) {
    const content: AssistantModelMessage["content"] = this.text
      ? [{ type: "text", text: this.text }, ...this.toolCalls]
      : this.toolCalls;
    if (content.length > 0) {
      out.push({ role: "assistant", content });
    }
    if (this.toolResults.length > 0) {
      const toolContent: ToolContent = this.toolResults;
      out.push({ role: "tool", content: toolContent } as ToolModelMessage);
    }
    this.text = "";
    this.toolCalls = [];
    this.toolResults = [];
  }
}

// Guard against unbounded context: keep the most recent messages and drop
// older ones, but never start the window on an orphan `tool` message (its
// matching assistant tool-call would be gone and the model API would reject
// the history).
export function trimToolLog(messages: ModelMessage[], maxMessages = 60): ModelMessage[] {
  if (messages.length <= maxMessages) return messages;
  let start = messages.length - maxMessages;
  while (start < messages.length && messages[start].role === "tool") start++;
  return start < messages.length ? messages.slice(start) : messages.slice(-1);
}

function asToolOutput(value: unknown): ToolResultPart["output"] {
  if (typeof value === "string") {
    return {
      type: "text",
      value: value.length > 8_000 ? `${value.slice(0, 8_000)}\n…[truncated]` : value,
    };
  }
  return { type: "json", value: value as never };
}
