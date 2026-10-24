import type { Express } from "express";
import { prisma } from "../db/prisma.js";
import {
  claimAgentTurn,
  drainAgentStream,
  persistFinishedTurn,
  releaseAgentTurn,
  startAgentTurn,
  stopAgentTurn,
} from "../chat.js";
import { botSessionTools, connectSandboxTools } from "../tools.js";
import { BOT_PROJECT_REPO, LIMITS, resolveBotModel, WORKSPACE_PATH } from "../config.js";
import { asyncRoute, currentUser } from "../http.js";
import { killSandbox, provisionSandbox } from "../sandbox.js";
import { loadToolLog } from "../agent.js";

const BOT_TITLE = "Bot";
const BOT_SYSTEM_PROMPT =
  "You are Bot, the user's personal OpenDevin assistant. Chat like a helpful person on WhatsApp: warm, direct, and concise. " +
  "Start each turn with a short acknowledgement such as 'On it.' or 'Got it — checking now.' before the result. " +
  "Keep answers to a few short sentences and use Markdown only for lists or code. " +
  "Think and use tools silently: never expose tool calls, plans, internal reasoning, or system details — return only the concise answer the user needs. " +
  "You can inspect the user's project sessions only through the read-only session tools. " +
  "When asked about a session, report whether it is working or done and mention only the available recent text. " +
  "You also have your own empty sandbox and may use all workspace tools for quick, non-project-specific tasks. " +
  "When the user asks for a file, use share_file so it appears as a download card in the chat. The card is shown automatically: do not repeat the file link or name in your reply.";

async function getBotSession(userId: string) {
  let project = await prisma.project.findFirst({ where: { userId, repo: BOT_PROJECT_REPO } });
  if (!project) {
    project = await prisma.project.create({
      data: { userId, repo: BOT_PROJECT_REPO, setupScript: "", devCommand: "" },
    });
  }
  let session = await prisma.projectSession.findFirst({
    where: { projectId: project.id, title: BOT_TITLE },
    include: { project: true },
  });
  if (!session) {
    session = await prisma.projectSession.create({
      data: {
        projectId: project.id,
        title: BOT_TITLE,
        branch: "",
        workspacePath: WORKSPACE_PATH,
      },
      include: { project: true },
    });
  }
  return session;
}

export function registerBotRoutes(app: Express): void {
  app.get(
    "/api/bot",
    asyncRoute(async (req, res) => {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: "Sign in required" });
      const session = await getBotSession(user.user.id);
      const messages = await prisma.message.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: "asc" },
      });
      return res.json({
        id: session.id,
        title: BOT_TITLE,
        status: session.status,
        sandboxStatus: session.sandboxStatus,
        sandboxId: session.sandboxId,
        lastError: session.lastError,
        messages,
        user: { name: user.user.name, email: user.user.email },
      });
    }),
  );

  app.post(
    "/api/bot/chat",
    asyncRoute(async (req, res) => {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: "Sign in required" });
      const prompt = typeof req.body.message === "string" ? req.body.message.trim() : "";
      if (!prompt) return res.status(400).json({ error: "A message is required" });
      if (prompt.length > LIMITS.messageChars) {
        return res.status(413).json({ error: `Message is too long: max ${LIMITS.messageChars}.` });
      }

      let session = await getBotSession(user.user.id);
      if (session.sandboxStatus !== "ready" || !session.sandboxId) {
        const provisioned = await provisionSandbox(session.id);
        if (!provisioned) {
          return res.status(409).json({
            code: "sandbox_not_ready",
            error: "Bot is starting its empty workspace. Retry in a moment.",
          });
        }
        session = await getBotSession(user.user.id);
      }
      const configured = resolveBotModel();
      if (!configured.apiKey) return res.status(503).json({ error: "Bot is not configured yet." });
      const controller = claimAgentTurn(session.id, "chat");
      if (!controller) return res.status(409).json({ code: "agent_busy", error: "Bot is busy." });

      try {
        await prisma.message.create({
          data: { sessionId: session.id, role: "user", content: prompt },
        });
        await prisma.projectSession.update({
          where: { id: session.id },
          data: { status: "running", model: configured.modelId, lastError: null },
        });
        const connected = await connectSandboxTools(
          session.sandboxId,
          session.workspacePath || WORKSPACE_PATH,
        );
        if (!connected.tools) throw new Error("Bot workspace is unavailable. Retry.");
        const modelHistory = await loadToolLog(session.id);
        modelHistory.push({ role: "user", content: prompt });
        const tools = { ...connected.tools, ...botSessionTools(user.user.id) };
        const { result } = startAgentTurn(
          session.id,
          {
            modelId: configured.modelId,
            apiKey: configured.apiKey,
            workspacePath: session.workspacePath || WORKSPACE_PATH,
            repo: null,
            branch: "",
            sandboxNote: "",
            modelHistory,
            tools,
            systemPrompt: `${BOT_SYSTEM_PROMPT} The signed-in user is ${user.user.name} (${user.user.email}).`,
          },
          { controller, kind: "chat" },
        );
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Transfer-Encoding", "chunked");
        let clientGone = false;
        req.on("close", () => {
          if (!res.writableEnded) clientGone = true;
        });
        let streamed = "";
        const { messages, text, visibleText, usage } = await drainAgentStream(
          result,
          (chunk) => {
            streamed += chunk;
            if (!clientGone) res.write(chunk);
          },
          undefined,
          false,
        );
        if (!visibleText.trim()) throw new Error("Bot finished without a response. Retry.");
        await persistFinishedTurn(session.id, {
          replyText: streamed || text,
          modelHistory,
          toolMessages: messages,
          planJson: null,
          usage,
        });
        if (!res.writableEnded) res.end();
      } catch (error) {
        const stopped = controller.signal.aborted;
        await prisma.projectSession
          .update({
            where: { id: session.id },
            data: {
              status: stopped ? "stopped" : "failed",
              lastError: error instanceof Error ? error.message : "Bot failed.",
            },
          })
          .catch(() => undefined);
        if (!res.headersSent)
          return res
            .status(stopped ? 409 : 500)
            .json({ error: stopped ? "Bot stopped." : "Bot failed. Retry." });
        if (!res.writableEnded) res.end(`\n\n${stopped ? "Bot stopped." : "Bot failed. Retry."}`);
      } finally {
        releaseAgentTurn(session.id, controller);
      }
    }),
  );

  app.post(
    "/api/bot/stop",
    asyncRoute(async (req, res) => {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: "Sign in required" });
      const session = await getBotSession(user.user.id);
      return res.json({ ok: true, stopped: stopAgentTurn(session.id) });
    }),
  );

  app.delete(
    "/api/bot",
    asyncRoute(async (req, res) => {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: "Sign in required" });
      const session = await getBotSession(user.user.id);
      stopAgentTurn(session.id);
      if (session.sandboxId) await killSandbox(session.sandboxId);
      await prisma.projectSession.delete({ where: { id: session.id } });
      return res.json({ ok: true });
    }),
  );
}
