import type { Express, Response } from "express";
import { prisma } from "../db/prisma.js";
import {
  activeTurns,
  drainAgentStream,
  persistFinishedTurn,
  startAgentTurn,
  stopAgentTurn,
} from "../chat.js";
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
      const content = prompt.slice(0, LIMITS.messageChars);
      const { modelId, apiKey } = resolveChatModel();
      if (!apiKey) return res.status(503).json({ error: "OPENROUTER_API_KEY is not configured" });
      if (activeTurns.has(owner.id))
        return res.status(409).json({ error: "Agent is already running. Stop it first." });

      // Persist the user's message and mark the turn running before any network
      // work, so a hung sandbox connect can't swallow the prompt.
      await prisma.message.create({ data: { sessionId: owner.id, role: "user", content } });
      await prisma.projectSession.update({
        where: { id: owner.id },
        data: { status: "running", model: modelId },
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
      const { result, controller } = startAgentTurn(owner.id, {
        modelId,
        apiKey,
        workspacePath: owner.workspacePath || WORKSPACE_PATH,
        repo: owner.project.repo,
        branch: owner.branch,
        sandboxNote,
        modelHistory,
        tools,
      });
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("x-model", modelId);
      if (!tools) res.setHeader("x-sandbox-degraded", "1");

      try {
        let streamed = "";
        let latestPlan: string | null = null;
        const write = (text: string) => {
          streamed += text;
          if (!clientGone) res.write(text);
        };
        const { messages, text, usage } = await drainAgentStream(result, write, (planJson) => {
          latestPlan = planJson;
        });
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
          (error as { name?: string })?.name === "AbortError" ||
          !activeTurns.has(owner.id) ||
          controller.signal.aborted;
        console.error("Chat stream failed", error);
        await prisma.projectSession.update({
          where: { id: owner.id },
          data: { status: aborted ? "idle" : "failed" },
        });
        if (!res.headersSent) return res.status(500).json({ error: "Agent run failed" });
        const msg = aborted
          ? "Agent stopped."
          : error instanceof Error && (error as { statusCode?: number }).statusCode === 402
            ? "Agent unavailable: insufficient credits. Add credits at https://openrouter.ai/settings/credits or check OPENROUTER_API_KEY."
            : "Agent run failed — please retry.";
        streamFailureTail(res, msg);
        return res.end();
      } finally {
        if (activeTurns.get(owner.id) === controller) activeTurns.delete(owner.id);
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
      await prisma.projectSession.update({
        where: { id: found.owner.id },
        data: { status: "idle" },
      });
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
