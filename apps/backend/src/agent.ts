import type { ModelMessage } from "ai";
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
