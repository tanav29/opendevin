import { Router } from "express";
import { Sandbox } from "e2b";
import { prisma } from "../db/prisma.js";
import { resolveChatModel } from "../config.js";
import { currentUser, HttpError, ownedSession, routeParam } from "../http.js";
import { dropPty } from "../pty.js";
import { cancelSandboxProvisioning, checkSandboxAvailable, killSandbox } from "../sandbox.js";
import { activeTurns, stopAgentTurn } from "../chat.js";
import { getLifecycle } from "../lifecycle.js";
import { FRESH_CLONE_WARNING, snapshotWorkspaceDiff } from "../workspace.js";
import {
  checkpointMetadata,
  createCheckpointSandbox,
  createFreshSessionSandbox,
  findCheckpoint,
  lockWorkspace,
  saveCheckpoint,
} from "../checkpoints.js";

const router = Router();

async function idleWorkspace(owner: Awaited<ReturnType<typeof ownedSession>>) {
  if (activeTurns.has(owner.id))
    throw new HttpError(409, "Stop the active agent turn before changing checkpoints.");
  // Match the lifecycle's interrupted state after a process restart.
  const interrupted =
    owner.status === "running" ||
    (owner.status === "queued" &&
      owner.sandboxStatus === "ready" &&
      Date.now() - owner.updatedAt.getTime() > 30_000);
  return lockWorkspace(interrupted ? { ...owner, status: "interrupted" } : owner);
}

router.get("/api/sessions/:id/checkpoints", async (req, res) => {
  const owner = await ownedSession(req, routeParam(req, "id"));
  return res.json({
    checkpoints: await prisma.workspaceCheckpoint.findMany({
      where: { sessionId: owner.id },
      orderBy: { createdAt: "desc" },
      select: checkpointMetadata,
    }),
    error: owner.checkpointError,
  });
});

router.post("/api/sessions/:id/checkpoints", async (req, res) => {
  const owner = await ownedSession(req, routeParam(req, "id"));
  const unlock = await idleWorkspace(owner);
  try {
    if (!owner.sandboxId || owner.sandboxStatus !== "ready")
      throw new HttpError(409, "Reconnect the workspace before capturing a checkpoint.");
    const sandbox = await Sandbox.connect(owner.sandboxId).catch(() => {
      throw new HttpError(503, "Sandbox unavailable. Previous checkpoints were retained.");
    });
    const saved = await saveCheckpoint(
      owner,
      sandbox,
      typeof req.body?.label === "string"
        ? req.body.label.trim() || "Manual checkpoint"
        : "Manual checkpoint",
    );
    return res.status(201).json(saved);
  } finally {
    await unlock();
  }
});

router.delete("/api/sessions/:id/checkpoints/:checkpointId", async (req, res) => {
  const owner = await ownedSession(req, routeParam(req, "id"));
  const unlock = await idleWorkspace(owner);
  try {
    const checkpoint = await findCheckpoint(owner.id, routeParam(req, "checkpointId"));
    await prisma.workspaceCheckpoint.delete({ where: { id: checkpoint!.id } });
    return res.json({ ok: true });
  } finally {
    await unlock();
  }
});

router.post("/api/sessions/:id/checkpoints/:checkpointId/:action", async (req, res) => {
  const owner = await ownedSession(req, routeParam(req, "id"));
  const action = routeParam(req, "action");
  if (!["restore", "fork"].includes(action)) throw new HttpError(404, "Unknown checkpoint action.");
  if (action === "restore" && req.body?.confirmReplace !== true)
    throw new HttpError(
      409,
      "Confirm replacement of the current workspace, or fork into a new session.",
    );
  const unlock = await idleWorkspace(owner);
  let replacement: Sandbox | undefined;
  let adopted = false;
  try {
    const checkpoint = await findCheckpoint(owner.id, routeParam(req, "checkpointId"));
    replacement = await createCheckpointSandbox(owner, checkpoint!);
    if (action === "fork") {
      // Nested creation gives the fork its own durable copy in the same transaction.
      const { id: _id, sessionId: _sessionId, createdAt: _createdAt, ...data } = checkpoint!;
      const session = await prisma.projectSession.create({
        data: {
          projectId: owner.projectId,
          title: `${owner.title.slice(0, 45)} (checkpoint fork)`,
          sandboxId: replacement.sandboxId,
          sandboxStatus: "ready",
          status: "idle",
          branch: checkpoint!.branch,
          model: owner.model,
          checkpoints: { create: { ...data, label: "Fork source" } },
        },
      });
      adopted = true;
      return res.status(201).json({ sessionId: session.id });
    }
    await prisma.projectSession.update({
      where: { id: owner.id },
      data: {
        sandboxId: replacement.sandboxId,
        sandboxStatus: "ready",
        status: "idle",
        branch: checkpoint!.branch,
        lastError: null,
        checkpointError: null,
      },
    });
    adopted = true;
    dropPty(owner.id);
    await killSandbox(owner.sandboxId);
    return res.json({ restored: true, checkpointId: checkpoint!.id });
  } finally {
    if (replacement && !adopted) await killSandbox(replacement.sandboxId);
    await unlock();
  }
});

// Every session the user owns, newest first — powers the /s sidebar.
router.get("/api/sessions", async (req, res) => {
  const session = await currentUser(req);
  const sessions = await prisma.projectSession.findMany({
    where: {
      project: { userId: session.user.id, repo: { not: "main-bot" } },
      archivedAt: null,
    },
    include: { project: { select: { id: true, repo: true } } },
    omit: { toolLog: true, lastDiff: true },
    orderBy: { updatedAt: "desc" },
  });
  return res.json(sessions);
});

router.post("/api/sessions/:id/archive", async (req, res) => {
  const owner = await ownedSession(req, routeParam(req, "id"));
  dropPty(owner.id);
  stopAgentTurn(owner.id);
  cancelSandboxProvisioning(owner.id);
  await snapshotWorkspaceDiff(owner.id);
  await killSandbox(owner.sandboxId);
  await prisma.projectSession.update({
    where: { id: owner.id },
    data: { archivedAt: new Date() },
  });
  return res.json({ ok: true });
});

router.get("/api/sessions/:id/messages", async (req, res) => {
  const owner = await ownedSession(req, routeParam(req, "id"));
  return res.json(
    await prisma.message.findMany({
      where: { sessionId: owner.id },
      orderBy: { createdAt: "asc" },
    }),
  );
});

router.get("/api/sessions/:id", async (req, res) => {
  const owner = await ownedSession(req, routeParam(req, "id"));
  // toolLog/lastDiff can be ~100KB each and the UI never reads them here.
  const { toolLog: _toolLog, lastDiff: _lastDiff, ...safe } = owner;
  return res.json(safe);
});

router.get("/api/sessions/:id/status", async (req, res) => {
  const owner = await ownedSession(req, routeParam(req, "id"));
  const sandboxAvailable = await checkSandboxAvailable(owner.sandboxId);
  const hasAssistant = await prisma.message
    .count({
      where: { sessionId: owner.id, role: "assistant" },
    })
    .then((count: number) => count > 0);
  const activeTurn = activeTurns.get(owner.id);
  const staleQueued =
    !activeTurn &&
    owner.status === "queued" &&
    owner.sandboxStatus === "ready" &&
    Date.now() - owner.updatedAt.getTime() > 30_000;
  const lifecycle = getLifecycle({
    sandboxStatus: owner.sandboxStatus,
    sandboxAvailable,
    status: staleQueued ? "running" : owner.status,
    activeTurn: Boolean(activeTurn),
    turnKind: activeTurn?.kind ?? null,
    hasAssistant,
  });
  let plan: { title: string; status: string }[] = [];
  try {
    const parsed = JSON.parse(owner.plan || "[]") as unknown;
    if (Array.isArray(parsed)) plan = parsed as typeof plan;
  } catch {
    // Keep default empty plan.
  }
  let usage: Record<string, unknown> = {};
  try {
    usage = (JSON.parse(owner.usage || "{}") as Record<string, unknown>) || {};
  } catch {
    // Keep default empty usage.
  }
  return res.json({
    sandboxStatus: owner.sandboxStatus,
    sandboxAvailable,
    sandboxId: owner.sandboxId,
    workspacePath: owner.workspacePath,
    lastError: owner.lastError,
    checkpointError: owner.checkpointError,
    status: owner.status,
    lifecycle,
    repo: owner.project.repo,
    branch: owner.branch,
    createdAt: owner.createdAt,
    model: owner.model || resolveChatModel().modelId,
    plan,
    usage,
    devCommand: owner.project.devCommand ?? "",
    devPort: owner.project.devPort ?? 3000,
  });
});

router.post("/api/sessions/:id/reconnect", async (req, res) => {
  const owner = await ownedSession(req, routeParam(req, "id"));
  if (owner.archivedAt) {
    return res.status(409).json({ error: "Archived sessions cannot be reconnected." });
  }
  if (activeTurns.has(owner.id)) {
    return res.status(409).json({
      code: "agent_busy",
      error: "Stop the active agent turn before reconnecting the sandbox.",
    });
  }
  const sandboxAvailable = await checkSandboxAvailable(owner.sandboxId);
  if (sandboxAvailable && owner.sandboxStatus === "ready") {
    await prisma.projectSession.update({
      where: { id: owner.id },
      data: { sandboxStatus: "ready" },
    });
    return res.json({
      sandboxStatus: "ready",
      reattached: true,
      continuity: "existing-sandbox",
    });
  }

  const checkpoint = await findCheckpoint(owner.id, req.body?.checkpointId);
  if ((!checkpoint || sandboxAvailable) && req.body?.confirmReplace !== true) {
    return res.status(409).json({
      code: "sandbox_reconnect_dirty",
      error: checkpoint
        ? "Confirm replacement of the current sandbox with the selected checkpoint."
        : "No durable checkpoint is available. A fresh clone will lose previous workspace state. Review any saved patch before replacing it.",
      patch: owner.lastDiff?.trim() ? { available: true, capturedAt: owner.lastDiffAt } : null,
    });
  }

  const unlock = await idleWorkspace(owner);
  let replacementId = "";
  let adopted = false;
  try {
    replacementId = checkpoint
      ? (await createCheckpointSandbox(owner, checkpoint)).sandboxId
      : await createFreshSessionSandbox(owner);
    await prisma.projectSession.update({
      where: { id: owner.id },
      data: {
        sandboxId: replacementId,
        sandboxStatus: "ready",
        status: "idle",
        ...(checkpoint ? { branch: checkpoint.branch } : {}),
        lastError: checkpoint ? null : FRESH_CLONE_WARNING,
        checkpointError: null,
      },
    });
    adopted = true;
    dropPty(owner.id);
    await killSandbox(owner.sandboxId);
    return res.json({
      sandboxStatus: "ready",
      replaced: true,
      continuity: checkpoint ? "checkpoint" : "fresh-clone",
      checkpoint: checkpoint
        ? { id: checkpoint.id, createdAt: checkpoint.createdAt, exclusions: checkpoint.exclusions }
        : null,
      reviewOnlyPatch: !checkpoint && Boolean(owner.lastDiff?.trim()),
    });
  } catch (error) {
    await prisma.projectSession.update({
      where: { id: owner.id },
      data: {
        checkpointError:
          "Reconnect failed. Existing sandbox, checkpoints, and saved patch were retained.",
      },
    });
    throw error;
  } finally {
    if (replacementId && !adopted) await killSandbox(replacementId);
    await unlock();
  }
});

router.delete("/api/sessions/:id", async (req, res) => {
  const owner = await ownedSession(req, routeParam(req, "id"));
  dropPty(owner.id);
  stopAgentTurn(owner.id);
  cancelSandboxProvisioning(owner.id);
  await killSandbox(owner.sandboxId);
  await prisma.projectSession.delete({ where: { id: owner.id } });
  return res.json({ ok: true });
});

router.post("/api/sessions/:id/kill", async (req, res) => {
  const owner = await ownedSession(req, routeParam(req, "id"));
  dropPty(owner.id);
  stopAgentTurn(owner.id);
  cancelSandboxProvisioning(owner.id);
  await snapshotWorkspaceDiff(owner.id);
  await killSandbox(owner.sandboxId);
  await prisma.projectSession.update({
    where: { id: owner.id },
    data: {
      sandboxId: "",
      sandboxStatus: "error",
      status: "stopped",
      lastError: "Sandbox killed by user. Reconnect to start a new one.",
    },
  });
  return res.json({ ok: true });
});

export default router;
