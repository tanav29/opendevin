import { Router } from "express";
import { prisma } from "../db/prisma.js";
import {
  failAgentTurn,
  claimAgentTurn,
  pipeAgentUIMessageStream,
  persistFinishedTurn,
  releaseAgentTurn,
  startAgentTurn,
  stopAgentTurn,
} from "../chat.js";
import {
  ensureSkillsIgnored,
  hasUnrestoredWorkspace,
  snapshotWorkspaceDiff,
  withContinuityWarning,
} from "../workspace.js";
import { LIMITS, resolveChatModel, WORKSPACE_PATH } from "../config.js";
import { ownedSession, routeParam } from "../http.js";
import { loadToolLog, parseSkillsBlock } from "../agent.js";
import { connectSandboxTools } from "../tools.js";

const router = Router();

router.post("/api/sessions/:id/chat", async (req, res) => {
  const owner = await ownedSession(req, routeParam(req, "id"));
  const prompt = typeof req.body?.message === "string" ? req.body?.message.trim() : "";
  if (!prompt) return res.status(400).json({ error: "A message is required" });
  if (prompt.length > LIMITS.messageChars) {
    return res.status(413).json({
      error: `Message is too long: max ${LIMITS.messageChars.toLocaleString()} characters.`,
    });
  }
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
    await prisma.message.create({ data: { sessionId: owner.id, role: "user", content: prompt } });
    await prisma.projectSession.update({
      where: { id: owner.id },
      data: {
        status: "running",
        model: modelId,
        lastError: hasUnrestoredWorkspace(owner.lastError) ? owner.lastError : null,
      },
    });

    const connected = await connectSandboxTools(
      owner.sandboxId,
      owner.workspacePath || WORKSPACE_PATH,
    );
    if (!connected) {
      const error = "Workspace sandbox is unavailable. Reconnect the sandbox, then retry.";
      await prisma.projectSession.update({
        where: { id: owner.id },
        data: { status: "failed", sandboxStatus: "error", lastError: error },
      });
      return res.status(503).json({ error });
    }
    const { tools, projectInstructions, sandbox } = connected;
    controller.signal.throwIfAborted();
    const selectedSkills = parseSkillsBlock(prompt);
    if (selectedSkills.length > 0) {
      // Keep skills.sh files out of version control from the moment the
      // agent starts installing them.
      await ensureSkillsIgnored(sandbox, owner.workspacePath || WORKSPACE_PATH).catch(
        () => undefined,
      );
    }

    // Model history comes from toolLog (user/assistant/tool messages, including
    // prior tool calls so the agent keeps working state across turns). The
    // Message table is only the plain-text timeline for the UI.
    const modelHistory = await loadToolLog(owner.id);
    modelHistory.push({ role: "user", content: prompt });

    const { result } = startAgentTurn(
      owner.id,
      {
        modelId,
        apiKey: configured.apiKey,
        workspacePath: owner.workspacePath || WORKSPACE_PATH,
        repo: owner.project.repo,
        branch: owner.branch,
        modelHistory,
        tools,
        projectInstructions,
        skills: selectedSkills,
      },
      { controller, kind: "chat" },
    );
    res.setHeader("x-model", modelId);
    let latestPlan: string | null = null;
    await pipeAgentUIMessageStream(
      result,
      res,
      async ({ messages, text, visibleText, usage }) => {
        if (!visibleText.trim())
          throw new Error("The agent finished without an assistant response. Retry the task.");
        await persistFinishedTurn(owner.id, {
          replyText: text,
          modelHistory,
          toolMessages: messages,
          planJson: latestPlan,
          usage,
        });
      },
      (planJson) => {
        latestPlan = planJson;
      },
      async (error) => {
        await failAgentTurn(owner.id, error, controller.signal, owner.lastError);
      },
    );
    return;
  } catch (error) {
    const message = await failAgentTurn(owner.id, error, controller.signal, owner.lastError);
    if (!res.headersSent) {
      return res.status(controller.signal.aborted ? 409 : 500).json({ error: message });
    }
    if (!res.writableEnded) res.end();
    return;
  } finally {
    releaseAgentTurn(owner.id, controller);
  }
});

router.post("/api/sessions/:id/stop", async (req, res) => {
  const owner = await ownedSession(req, routeParam(req, "id"));
  const stopped = stopAgentTurn(owner.id);
  if (stopped) {
    await snapshotWorkspaceDiff(owner.id).catch(() => undefined);
    await prisma.projectSession.update({
      where: { id: owner.id },
      data: {
        status: "stopped",
        lastError: withContinuityWarning(owner.lastError, "The agent run was stopped."),
      },
    });
  }
  return res.json({ ok: true, stopped });
});

export default router;
