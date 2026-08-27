import { convertToModelMessages, streamText } from "ai";
import { createTools, instructions, model, stepCountIs } from "@/agent/agent";
import { getSandbox, WORKSPACE } from "@/lib/e2b";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = (await request.json()) as { messages?: unknown[]; sessionId?: string; git?: string; baseBranch?: string; envVars?: string; devCommand?: string; buildCommand?: string };
  if (!body.sessionId || !body.git || !Array.isArray(body.messages)) return Response.json({ error: "sessionId, git, and messages are required" }, { status: 400 });
  if (!/^[a-zA-Z0-9_-]+$/.test(body.sessionId)) return Response.json({ error: "Invalid session id" }, { status: 400 });

  const sandbox = await getSandbox(body.sessionId, body.git, body.baseBranch);

  const result = streamText({
    model,
    system: `${instructions}\nThe current repository is ${body.git}.\nThe workspace is ${WORKSPACE}.\nConfigured dev command: ${body.devCommand || "not set"}.\nConfigured build command: ${body.buildCommand || "not set"}.`,
    messages: await convertToModelMessages(body.messages as never),
    tools: createTools(sandbox, parseEnv(body.envVars)),
    stopWhen: stepCountIs(20),
  });
  return result.toUIMessageStreamResponse({
    headers: { "Cache-Control": "no-cache" },
  });
}

function parseEnv(raw?: string): Record<string, string> {
  try {
    const rows = JSON.parse(raw ?? "[]") as Array<{ key?: string; value?: string }>;
    return Object.fromEntries(rows.filter((row) => row.key?.trim()).map((row) => [row.key!.trim(), row.value ?? ""]));
  } catch { return {}; }
}
