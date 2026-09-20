import { stepCountIs, type ModelMessage } from "ai";
import { prisma } from "./db/prisma.js";
import { TOOL_LOG_MAX_MESSAGES } from "./config.js";

export const AGENT_STOP = stepCountIs(25);

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
export function trimToolLog(
  messages: ModelMessage[],
  maxMessages = TOOL_LOG_MAX_MESSAGES,
): ModelMessage[] {
  if (messages.length <= maxMessages) return messages;
  let start = messages.length - maxMessages;
  while (start < messages.length && messages[start].role === "tool") start++;
  return start < messages.length ? messages.slice(start) : messages.slice(-1);
}

export function buildSystemPrompt(
  workspacePath: string,
  repo: string | null,
  branch: string,
  sandboxNote: string,
): string {
  const repoLine = repo ? `Project repo: ${repo}. ` : "";
  const branchLine = branch ? `Active git branch: ${branch}. ` : "";
  return `You are OpenDevin, a concise cloud coding agent working inside an E2B sandbox at ${workspacePath}. ${repoLine}${branchLine}${sandboxNote} Workflow: for non-trivial tasks first call update_plan with 2-8 steps, then work the plan (search/read before edit, edit_file for patches, run_command to verify tests/build). Prefer inspecting real files with list_files/read_file/search before answering. When requirements are ambiguous, call ask_user with 2-4 short options instead of guessing. Keep replies short.`;
}
