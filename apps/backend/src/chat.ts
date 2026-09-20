import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamText, type ModelMessage } from "ai";
import { prisma } from "./db/prisma.js";
import { AGENT_STOP, buildSystemPrompt, loadToolLog, saveToolLog, trimToolLog } from "./agent.js";
import { resolveChatModel, WORKSPACE_PATH } from "./config.js";
import { LIMITS } from "./config.js";
import { connectSandboxTools } from "./tools.js";
import { snapshotDiffAndIdle } from "./workspace.js";

// In-flight agent turns by session. Lets POST /stop abort the model stream
// server-side instead of only dropping the client's fetch.
export const activeTurns = new Map<string, AbortController>();

export type AgentUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

// --- Stream markers --------------------------------------------------------
// The chat endpoint streams compact HTML markers for tool/question/error
// parts. Tool payloads and results stay server-side.

function questionPayload(input: unknown): string {
  let question = "Question";
  let options: string[] = [];
  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    if (typeof rec.question === "string" && rec.question.trim())
      question = rec.question.slice(0, 500);
    if (Array.isArray(rec.options))
      options = rec.options
        .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
        .slice(0, 6)
        .map((o) => o.slice(0, 200));
  }
  return JSON.stringify({ question, options }).replace(/'/g, "&#39;");
}

function planPayload(input: unknown): string {
  let tasks: { title: string; status: string }[] = [];
  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    if (Array.isArray(rec.tasks)) {
      tasks = rec.tasks
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
        .map((t) => ({
          title: typeof t.title === "string" ? t.title.slice(0, 200) : "",
          status: t.status === "done" || t.status === "in_progress" ? String(t.status) : "pending",
        }))
        .filter((t) => t.title)
        .slice(0, 12);
    }
  }
  return JSON.stringify(tasks).replace(/'/g, "&#39;");
}

function escapeMarkerAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toolArgument(name: string, input: unknown): string {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const preferredKey: Record<string, string> = {
    list_files: "path",
    read_file: "path",
    run_command: "command",
    write_file: "path",
    edit_file: "path",
    delete_file: "path",
    search: "pattern",
    ask_user: "question",
  };
  const preferred = record[preferredKey[name]];
  const fallback = Object.values(record).find((value) => typeof value === "string");
  const value =
    typeof preferred === "string" ? preferred : typeof fallback === "string" ? fallback : "";
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}

export function toolCallMarker(name: string, input: unknown): string {
  if (name === "ask_user") return `\n\n<div data-question='${questionPayload(input)}'>\n\n`;
  if (name === "update_plan") return `\n\n<div data-plan='${planPayload(input)}'>\n\n`;
  const argument = escapeMarkerAttribute(toolArgument(name, input));
  return `\n\n<details data-tool="call" data-arg="${argument}"><summary>${name}</summary>\n\n`;
}

export function toolDoneMarker(name: string, partType: string, output: unknown): string {
  if (name === "ask_user" || name === "update_plan") return `\n</div>\n\n`;
  if (partType === "tool-error") return `\n<div data-tool-status="failed"></div>\n\n</details>\n\n`;
  if (typeof output === "string" && output.startsWith("__PLAN__")) {
    const raw = output.slice("__PLAN__".length).replace(/'/g, "&#39;");
    return `\n<div data-plan='${raw}'>\n\n</div>\n\n`;
  }
  return `\n</details>\n\n`;
}

// Drain one agent turn: stream text deltas as-is, surface tool activity as
// collapsible markers, and always consume the whole stream so the turn
// completes and the full assistant/tool transcript is available to persist.
export async function drainAgentStream(
  result: {
    fullStream: AsyncIterable<unknown>;
    response: Promise<{ messages: unknown }>;
    text: Promise<string>;
    usage?: Promise<AgentUsage | undefined>;
  },
  sink: (chunk: string) => void,
  onPlan?: (tasksJson: string) => void,
): Promise<{ messages: ModelMessage[]; text: string; usage: AgentUsage | undefined }> {
  for await (const part of result.fullStream) {
    const p = part as {
      type?: unknown;
      text?: unknown;
      toolName?: unknown;
      input?: unknown;
      output?: unknown;
      error?: unknown;
    };
    if (p.type === "text-delta") {
      sink(typeof p.text === "string" ? p.text : "");
    } else if (p.type === "tool-call") {
      sink(toolCallMarker(typeof p.toolName === "string" ? p.toolName : "tool", p.input));
    } else if (p.type === "tool-result" || p.type === "tool-error") {
      const name = typeof p.toolName === "string" ? p.toolName : "";
      sink(toolDoneMarker(name, p.type, p.output));
      if (
        name === "update_plan" &&
        typeof p.output === "string" &&
        p.output.startsWith("__PLAN__")
      ) {
        try {
          onPlan?.(p.output.slice("__PLAN__".length));
        } catch {
          // Ignore malformed plan payloads.
        }
      }
    }
  }
  const [response, text, usage] = await Promise.all([
    result.response,
    result.text,
    result.usage?.catch(() => undefined),
  ]);
  return { messages: (response.messages ?? []) as ModelMessage[], text, usage };
}

async function persistTurnExtras(
  sessionId: string,
  planJson: string | null,
  usage: AgentUsage | undefined,
): Promise<void> {
  try {
    const data: Record<string, string> = {};
    if (planJson) {
      try {
        const parsed = JSON.parse(planJson) as unknown;
        if (Array.isArray(parsed)) data.plan = JSON.stringify(parsed).slice(0, 5000);
      } catch {
        // Ignore malformed plan JSON.
      }
    }
    if (usage && (usage.inputTokens || usage.outputTokens || usage.totalTokens)) {
      data.usage = JSON.stringify({
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
        at: new Date().toISOString(),
      }).slice(0, 500);
    }
    if (Object.keys(data).length > 0) {
      await prisma.projectSession.update({ where: { id: sessionId }, data });
    }
  } catch (error) {
    console.error("Could not persist plan/usage", error);
  }
}

export type TurnPersistence = {
  replyText: string;
  modelHistory: ModelMessage[];
  toolMessages: ModelMessage[];
  planJson: string | null;
  usage: AgentUsage | undefined;
};

// Persist a finished agent turn: the assistant text to the timeline, the full
// (text + tool) transcript to toolLog for the next turn, a best-effort diff
// snapshot, and finally reset the session status so it is not left "running".
async function persistFinishedTurn(sessionId: string, turn: TurnPersistence): Promise<void> {
  const content = turn.replyText.trim() ? turn.replyText.slice(0, LIMITS.replyChars) : "";
  if (content) {
    try {
      await prisma.message.create({ data: { sessionId, role: "assistant", content } });
    } catch (error) {
      console.error("Could not persist assistant reply", error);
    }
  }
  try {
    await saveToolLog(sessionId, trimToolLog([...turn.modelHistory, ...turn.toolMessages]));
  } catch (error) {
    console.error("Could not persist agent tool history", error);
  }
  await persistTurnExtras(sessionId, turn.planJson, turn.usage);
  await snapshotDiffAndIdle(sessionId);
}

export function startAgentTurn(
  sessionId: string,
  opts: {
    modelId: string;
    apiKey: string;
    workspacePath: string;
    repo: string | null;
    branch: string;
    sandboxNote: string;
    modelHistory: ModelMessage[];
    tools: Awaited<ReturnType<typeof connectSandboxTools>>["tools"];
  },
) {
  const controller = new AbortController();
  activeTurns.set(sessionId, controller);
  const result = streamText({
    model: createOpenRouter({ apiKey: opts.apiKey })(opts.modelId),
    system: buildSystemPrompt(opts.workspacePath, opts.repo, opts.branch, opts.sandboxNote),
    messages: opts.modelHistory,
    ...(opts.tools ? { tools: opts.tools, stopWhen: AGENT_STOP } : {}),
    abortSignal: controller.signal,
  });
  return { result, controller };
}

export function stopAgentTurn(sessionId: string): boolean {
  const controller = activeTurns.get(sessionId);
  if (controller) {
    controller.abort();
    activeTurns.delete(sessionId);
    return true;
  }
  return false;
}

function takeController(sessionId: string, controller: AbortController): boolean {
  return activeTurns.get(sessionId) === controller;
}

function releaseController(sessionId: string, controller: AbortController): void {
  if (takeController(sessionId, controller)) activeTurns.delete(sessionId);
}

// Background run for the opening prompt: session creation seeds the user
// message + toolLog but has no HTTP stream to write to, so run the same agent
// turn headless. Skips when the sandbox failed to provision or an assistant
// reply already exists (e.g. user sent a second message first).
export async function runInitialTurn(sessionId: string): Promise<void> {
  try {
    const session = await prisma.projectSession.findUnique({
      where: { id: sessionId },
      include: { project: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!session || session.sandboxStatus !== "ready") return;
    if (session.messages.some((m) => m.role === "assistant")) return;
    const { modelId, apiKey } = resolveChatModel();
    if (!apiKey) {
      await prisma.projectSession.update({ where: { id: sessionId }, data: { status: "idle" } });
      return;
    }
    const modelHistory = await loadToolLog(sessionId);
    if (!modelHistory.some((m) => m.role === "user")) return;

    const { tools, sandboxNote } = await connectSandboxTools(
      session.sandboxId,
      session.workspacePath || WORKSPACE_PATH,
    );
    if (!tools && session.sandboxId) {
      await prisma.projectSession.update({
        where: { id: sessionId },
        data: {
          status: "failed",
          sandboxStatus: "error",
          lastError: "Workspace sandbox is unavailable. Reconnect the sandbox, then retry.",
        },
      });
      return;
    }
    await prisma.projectSession.update({ where: { id: sessionId }, data: { status: "running" } });
    const { result, controller } = startAgentTurn(sessionId, {
      modelId,
      apiKey,
      workspacePath: session.workspacePath || WORKSPACE_PATH,
      repo: session.project.repo,
      branch: session.branch,
      sandboxNote,
      modelHistory,
      tools,
    });
    let streamed = "";
    try {
      let latestPlan: string | null = null;
      const { messages, text, usage } = await drainAgentStream(
        result,
        (chunk) => {
          streamed += chunk;
        },
        (planJson) => {
          latestPlan = planJson;
        },
      );
      const content = streamed.trim()
        ? streamed.slice(0, LIMITS.replyChars)
        : text.slice(0, LIMITS.replyChars);
      await persistFinishedTurn(sessionId, {
        replyText: content,
        modelHistory,
        toolMessages: messages,
        planJson: latestPlan,
        usage,
      });
    } catch (error) {
      console.error("Initial agent turn failed", error);
      await prisma.projectSession.update({ where: { id: sessionId }, data: { status: "failed" } });
    } finally {
      releaseController(sessionId, controller);
    }
  } catch (error) {
    console.error("runInitialTurn failed", error);
  }
}

export { persistFinishedTurn, persistTurnExtras };
