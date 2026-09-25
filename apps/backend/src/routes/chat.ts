import type { Express, Response } from "express";
import { prisma } from "../db/prisma.js";
import {
  activeTurns,
  claimAgentTurn,
  drainAgentStream,
  persistFinishedTurn,
  releaseAgentTurn,
  startAgentTurn,
  stopAgentTurn,
} from "../chat.js";
import {
  hasUnrestoredWorkspace,
  snapshotWorkspaceDiff,
  withContinuityWarning,
} from "../workspace.js";
import { LIMITS, resolveChatModel, WORKSPACE_PATH } from "../config.js";
import { asyncRoute, ownedSession, routeParam } from "../http.js";
import { loadToolLog } from "../agent.js";
import { connectSandboxTools } from "../tools.js";

export function registerChatRoutes(app: Express): void {
  app.post(
    "/api/sessions/:id/chat",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      const owner = found.owner;
      const prompt = typeof req.body.message === "string" ? req.body.message.trim() : "";
      if (!prompt) return res.status(400).json({ error: "A message is required" });
      if (prompt.length > LIMITS.messageChars) {
        return res.status(413).json({
          error: `Message is too long: max ${LIMITS.messageChars.toLocaleString()} characters.`,
        });
      }
      const content = prompt;
      if (owner.archivedAt) {
        return res.status(409).json({ error: "Archived sessions cannot run new agent turns." });
      }
      const staleQueued =
        owner.status === "queued" &&
        owner.sandboxStatus === "ready" &&
        Date.now() - owner.updatedAt.getTime() > 30_000;
      if (
        !owner.sandboxId ||
        owner.sandboxStatus !== "ready" ||
        (owner.status === "queued" && !staleQueued)
      ) {
        return res.status(409).json({
          code: "sandbox_not_ready",
          error: "The workspace is not ready for another agent turn yet.",
        });
      }
      const configured = resolveChatModel();
      const modelId = owner.model || configured.modelId;
      if (!configured.apiKey) {
        const error = "The agent could not start because OPENROUTER_API_KEY is not configured.";
        await prisma.projectSession.update({
          where: { id: owner.id },
          data: { status: "failed", model: modelId, lastError: error },
        });
        return res.status(503).json({ error });
      }
      if (activeTurns.has(owner.id)) {
        return res.status(409).json({
          code: "agent_busy",
          error: "An agent turn is already running, possibly in another tab. Stop it first.",
        });
      }
      const controller = claimAgentTurn(owner.id, "chat");
      if (!controller) {
        return res.status(409).json({
          code: "agent_busy",
          error: "An agent turn is already running, possibly in another tab. Stop it first.",
        });
      }

      try {
        // Persist the user's message and mark the turn running before any network
        // work, so a hung sandbox connect can't swallow the prompt.
        await prisma.message.create({ data: { sessionId: owner.id, role: "user", content } });
        await prisma.projectSession.update({
          where: { id: owner.id },
          data: {
            status: "running",
            model: modelId,
            lastError: hasUnrestoredWorkspace(owner.lastError) ? owner.lastError : null,
          },
        });

        const { tools, sandboxNote } = await connectSandboxTools(
          owner.sandboxId,
          owner.workspacePath || WORKSPACE_PATH,
        );
        // A session with a sandbox id must never silently fall back to a text-only
        // model response: that makes tool calls look like ordinary assistant text.
        if (!tools && owner.sandboxId) {
          const error = "Workspace sandbox is unavailable. Reconnect the sandbox, then retry.";
          await prisma.projectSession.update({
            where: { id: owner.id },
            data: { status: "failed", sandboxStatus: "error", lastError: error },
          });
          return res.status(503).json({ error });
        }

        // Model history comes from toolLog (user/assistant/tool messages, including
        // prior tool calls so the agent keeps working state across turns). The
        // Message table is only the plain-text timeline for the UI.
        const modelHistory = await loadToolLog(owner.id);
        modelHistory.push({ role: "user", content });

        let clientGone = false;
        req.on("close", () => {
          if (!res.writableEnded) clientGone = true;
        });
        const { result } = startAgentTurn(
          owner.id,
          {
            modelId,
            apiKey: configured.apiKey,
            workspacePath: owner.workspacePath || WORKSPACE_PATH,
            repo: owner.project.repo,
            branch: owner.branch,
            sandboxNote,
            modelHistory,
            tools,
          },
          { controller, kind: "chat" },
        );
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("x-model", modelId);
        if (!tools) res.setHeader("x-sandbox-degraded", "1");

        let streamed = "";
        let latestPlan: string | null = null;
        const write = (text: string) => {
          streamed += text;
          if (!clientGone) res.write(text);
        };
        const { messages, text, visibleText, usage } = await drainAgentStream(
          result,
          write,
          (planJson) => {
            latestPlan = planJson;
          },
        );
        if (!visibleText.trim()) {
          throw new Error("The agent finished without an assistant response. Retry the task.");
        }
        await persistFinishedTurn(owner.id, {
          replyText: streamed.trim() ? streamed : text,
          modelHistory,
          toolMessages: messages,
          planJson: latestPlan,
          usage,
        });
        if (!res.writableEnded) res.end();
        return;
      } catch (error) {
        const aborted =
          controller.signal.aborted || (error as { name?: string })?.name === "AbortError";
        console.error("Chat stream failed", error);
        await snapshotWorkspaceDiff(owner.id).catch(() => undefined);
        const message = aborted
          ? "The agent run was stopped."
          : error instanceof Error
            ? error.message.slice(0, 500)
            : "The agent run failed. Retry the task.";
        await prisma.projectSession
          .update({
            where: { id: owner.id },
            data: {
              status: aborted ? "stopped" : "failed",
              lastError: withContinuityWarning(owner.lastError, message),
            },
          })
          .catch(() => undefined);
        if (!res.headersSent) {
          return res.status(aborted ? 409 : 500).json({ error: message });
        }
        const msg = aborted
          ? "Agent stopped."
          : error instanceof Error && (error as { statusCode?: number }).statusCode === 402
            ? "Agent unavailable: insufficient credits. Add credits at https://openrouter.ai/settings/credits or check OPENROUTER_API_KEY."
            : "Agent run failed — please retry.";
        streamFailureTail(res, msg);
        return res.end();
      } finally {
        releaseAgentTurn(owner.id, controller);
      }
    }),
  );

  app.post(
    "/api/sessions/:id/stop",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      const stopped = stopAgentTurn(found.owner.id);
      if (stopped) {
        await snapshotWorkspaceDiff(found.owner.id).catch(() => undefined);
        await prisma.projectSession.update({
          where: { id: found.owner.id },
          data: {
            status: "stopped",
            lastError: withContinuityWarning(found.owner.lastError, "The agent run was stopped."),
          },
        });
      }
      return res.json({ ok: true, stopped });
    }),
  );
}

function streamFailureTail(res: Response, msg: string): void {
  try {
    if (!res.writableEnded)
      res.write(
        `\n\n<details data-tool="error"><summary>⚠️ Agent run failed</summary>\n\n${msg}\n\n</details>\n`,
      );
  } catch {
    // Client already gone — nothing to stream.
  }
}
