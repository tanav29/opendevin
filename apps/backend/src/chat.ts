import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  pipeUIMessageStreamToResponse,
  createUIMessageStream,
  streamText,
  type ModelMessage,
  type TextStreamPart,
  type ToolSet,
} from "ai";
import type { Response } from "express";
import { prisma } from "./db/prisma.js";
import {
  AGENT_STOP,
  buildSystemPrompt,
  compactToolContext,
  loadToolLog,
  saveToolLog,
  trimToolLog,
  type SkillSelection,
} from "./agent.js";
import { LIMITS, resolveChatModel, WORKSPACE_PATH } from "./config.js";
import { connectSandboxTools, SHARED_FILE_PREFIX, type SandboxToolset } from "./tools.js";
import {
  hasUnrestoredWorkspace,
  snapshotDiffAndIdle,
  snapshotWorkspaceDiff,
  withContinuityWarning,
} from "./workspace.js";
import type { TurnKind } from "./lifecycle.js";

export type ActiveTurn = { controller: AbortController; kind: TurnKind };
export const activeTurns = new Map<string, ActiveTurn>();

export function claimAgentTurn(sessionId: string, kind: TurnKind): AbortController | null {
  if (activeTurns.has(sessionId)) return null;
  const controller = new AbortController();
  activeTurns.set(sessionId, { controller, kind });
  return controller;
}

export type AgentUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

export async function pipeAgentUIMessageStream(
  result: Parameters<typeof drainAgentStream>[0],
  res: Response,
  onFinish: (turn: Awaited<ReturnType<typeof drainAgentStream>>) => Promise<void>,
  onPlan?: (tasksJson: string) => void,
  onError?: (error: unknown) => Promise<void>,
): Promise<void> {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      try {
        const id = crypto.randomUUID();
        writer.write({ type: "text-start", id });
        const turn = await drainAgentStream(
          result,
          (delta) => writer.write({ type: "text-delta", id, delta }),
          onPlan,
        );
        await onFinish(turn);
        writer.write({ type: "text-end", id });
      } catch (error) {
        await onError?.(error);
        throw error;
      }
    },
    onError: (error) => (error instanceof Error ? error.message : "The agent run failed."),
  });
  await pipeUIMessageStreamToResponse({ response: res, stream });
}

function questionPayload(input: unknown, toolCallId?: string): string {
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
  return JSON.stringify({ question, options, toolCallId }).replace(/'/g, "&#39;");
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
    share_file: "path",
  };
  const preferred = record[preferredKey[name]];
  const fallback = Object.values(record).find((value) => typeof value === "string");
  const value =
    typeof preferred === "string" ? preferred : typeof fallback === "string" ? fallback : "";
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}

export function toolCallMarker(name: string, input: unknown, toolCallId?: string): string {
  if (name === "ask_user")
    return `\n\n<div data-question='${questionPayload(input, toolCallId)}'>\n\n`;
  if (name === "update_plan") return `\n\n<div data-plan='${planPayload(input)}'>\n\n`;
  if (name === "share_file") return "";
  const argument = escapeMarkerAttribute(toolArgument(name, input));
  return `\n\n<details data-tool="call" data-arg="${argument}"><summary>${name}</summary>\n\n`;
}

export function fileMarker(payloadJson: string): string {
  return `\n\n<div data-file='${payloadJson.replace(/'/g, "&#39;")}'>\n\n</div>\n\n`;
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

function suggestionsMarker(output: unknown): string {
  try {
    const value: unknown = typeof output === "string" ? JSON.parse(output) : output;
    if (
      !value ||
      typeof value !== "object" ||
      !("suggestions" in value) ||
      !Array.isArray(value.suggestions)
    )
      return "";
    const suggestions = [
      ...new Set(
        value.suggestions.filter(
          (suggestion: unknown): suggestion is string =>
            typeof suggestion === "string" && suggestion.trim().length > 0,
        ),
      ),
    ];
    const payload = JSON.stringify(suggestions)
      .replace(/&/g, "\\u0026")
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/'/g, "&#39;");
    return `\n\n<div data-suggestions='${payload}'>\n\n</div>\n\n`;
  } catch {
    return "";
  }
}

// Convert SDK events to the chat's text and tool markers.
export async function drainAgentStream(
  result: {
    fullStream: AsyncIterable<TextStreamPart<ToolSet>>;
    response: Promise<{ messages: ModelMessage[] }>;
    text: Promise<string>;
    totalUsage?: Promise<AgentUsage | undefined>;
  },
  sink: (chunk: string) => void,
  onPlan?: (tasksJson: string) => void,
): Promise<{
  messages: ModelMessage[];
  text: string;
  visibleText: string;
  usage: AgentUsage | undefined;
}> {
  let visibleText = "";
  let text = "";
  const write = (chunk: string) => {
    text += chunk;
    sink(chunk);
  };
  for await (const p of result.fullStream) {
    if (p.type === "text-delta") {
      visibleText += p.text;
      write(p.text);
    } else if (p.type === "tool-call") {
      const name = p.toolName;
      if (name !== "share_file") {
        const marker = toolCallMarker(name, p.input, p.toolCallId);
        if (name === "ask_user" || name === "update_plan") visibleText += marker;
        write(marker);
      }
    } else if (p.type === "tool-result" || p.type === "tool-error") {
      const name = p.toolName;
      const output = p.type === "tool-result" ? p.output : undefined;
      if (
        p.type === "tool-result" &&
        name === "share_file" &&
        typeof output === "string" &&
        output.startsWith(SHARED_FILE_PREFIX)
      ) {
        const marker = fileMarker(output.slice(SHARED_FILE_PREFIX.length));
        visibleText += marker;
        write(marker);
      }
      if (name !== "share_file") {
        write(toolDoneMarker(name, p.type, output));
      }
      if (p.type === "tool-result") {
        const marker = suggestionsMarker(output);
        visibleText += marker;
        write(marker);
      }
      if (name === "update_plan" && typeof output === "string" && output.startsWith("__PLAN__")) {
        try {
          onPlan?.(output.slice("__PLAN__".length));
        } catch {
          // Ignore malformed plan payloads.
        }
      }
    } else if (p.type === "error") {
      throw p.error;
    } else if (p.type === "abort") {
      throw new DOMException("The agent run was stopped.", "AbortError");
    }
  }
  const [response, usage] = await Promise.all([
    result.response,
    result.totalUsage?.catch(() => undefined),
  ]);
  return {
    messages: response.messages,
    text,
    visibleText,
    usage,
  };
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

export async function persistFinishedTurn(sessionId: string, turn: TurnPersistence): Promise<void> {
  const content = turn.replyText.trim() ? turn.replyText.slice(0, LIMITS.replyChars) : "";
  if (!content) throw new Error("The agent finished without an assistant response.");
  await prisma.message.create({ data: { sessionId, role: "assistant", content } });
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
    modelHistory: ModelMessage[];
    tools: SandboxToolset;
    projectInstructions?: string;
    skills?: SkillSelection[];
  },
  reservation: { controller: AbortController; kind: TurnKind },
) {
  const { controller } = reservation;
  if (activeTurns.get(sessionId)?.controller !== controller) {
    throw new Error("The agent turn is not reserved for this session.");
  }
  const result = streamText({
    model: createOpenRouter({ apiKey: opts.apiKey })(opts.modelId),
    system: buildSystemPrompt(
      opts.workspacePath,
      opts.repo,
      opts.branch,
      opts.projectInstructions,
      opts.skills ?? [],
    ),
    messages: opts.modelHistory,
    prepareStep: ({ messages }) => ({ messages: compactToolContext(messages) }),
    tools: opts.tools,
    stopWhen: AGENT_STOP,
    abortSignal: controller.signal,
  });
  return { result, controller };
}

export function stopAgentTurn(sessionId: string): boolean {
  const active = activeTurns.get(sessionId);
  if (!active) return false;
  // Keep the reservation until the owning turn unwinds in its finally block.
  // Releasing it here would allow a new turn to start while the aborted turn can
  // still write a stale terminal status.
  active.controller.abort();
  return true;
}

export function releaseAgentTurn(sessionId: string, controller: AbortController): void {
  if (activeTurns.get(sessionId)?.controller === controller) activeTurns.delete(sessionId);
}

// Run the opening prompt after provisioning, before a chat stream connects.
export async function runInitialTurn(sessionId: string): Promise<void> {
  let controller: AbortController | null = null;
  let previousError: string | null = null;
  try {
    const session = await prisma.projectSession.findUnique({
      where: { id: sessionId },
      include: {
        project: true,
        messages: { where: { role: "assistant" }, select: { id: true }, take: 1 },
      },
    });
    if (!session || session.sandboxStatus !== "ready") return;
    previousError = session.lastError;
    if (session.messages.length) return;

    const configured = resolveChatModel();
    const modelId = session.model || configured.modelId;
    if (!configured.apiKey) {
      await prisma.projectSession.update({
        where: { id: sessionId },
        data: {
          model: modelId,
          status: "failed",
          lastError: "The agent could not start because OPENROUTER_API_KEY is not configured.",
        },
      });
      return;
    }
    if (!session.model) {
      await prisma.projectSession.update({ where: { id: sessionId }, data: { model: modelId } });
    }

    const modelHistory = await loadToolLog(sessionId);
    if (!modelHistory.some((m) => m.role === "user")) {
      await prisma.projectSession.update({
        where: { id: sessionId },
        data: { status: "failed", lastError: "The opening prompt is missing; start a new task." },
      });
      return;
    }

    controller = claimAgentTurn(sessionId, "initial");
    if (!controller) return;
    const connected = await connectSandboxTools(
      session.sandboxId,
      session.workspacePath || WORKSPACE_PATH,
    );
    if (!connected) {
      await snapshotWorkspaceDiff(sessionId);
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
    const { tools, projectInstructions } = connected;
    controller.signal.throwIfAborted();
    await prisma.projectSession.update({
      where: { id: sessionId },
      data: {
        status: "running",
        lastError: hasUnrestoredWorkspace(session.lastError) ? session.lastError : null,
      },
    });

    const { result } = startAgentTurn(
      sessionId,
      {
        modelId,
        apiKey: configured.apiKey,
        workspacePath: session.workspacePath || WORKSPACE_PATH,
        repo: session.project.repo,
        branch: session.branch,
        modelHistory,
        tools,
        projectInstructions,
      },
      { controller, kind: "initial" },
    );
    let latestPlan: string | null = null;
    const { messages, text, visibleText, usage } = await drainAgentStream(
      result,
      () => undefined,
      (planJson) => {
        latestPlan = planJson;
      },
    );
    if (!visibleText.trim()) {
      throw new Error("The agent finished without an assistant response. Retry the task.");
    }
    await persistFinishedTurn(sessionId, {
      replyText: text,
      modelHistory,
      toolMessages: messages,
      planJson: latestPlan,
      usage,
    });
  } catch (error) {
    await failAgentTurn(sessionId, error, controller?.signal, previousError);
  } finally {
    if (controller) releaseAgentTurn(sessionId, controller);
  }
}

export async function failAgentTurn(
  sessionId: string,
  error: unknown,
  signal?: AbortSignal,
  previousError: string | null = null,
): Promise<string> {
  const stopped = signal?.aborted || (error instanceof Error && error.name === "AbortError");
  if (!stopped) console.error("Agent turn failed", error);
  const message = stopped
    ? "The agent run was stopped."
    : error instanceof Error
      ? error.message.slice(0, 500)
      : "The agent run failed. Retry the task.";
  await snapshotWorkspaceDiff(sessionId).catch(() => undefined);
  await prisma.projectSession
    .update({
      where: { id: sessionId },
      data: {
        status: stopped ? "stopped" : "failed",
        lastError: withContinuityWarning(previousError, message),
      },
    })
    .catch(() => undefined);
  return message;
}
