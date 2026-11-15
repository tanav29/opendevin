import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { resolveChatModel } from "../config.js";
import { currentUser, ownedSession, routeParam, scheduleBackgroundTask } from "../http.js";
import { dropPty } from "../pty.js";
import {
  cancelSandboxProvisioning,
  checkSandboxAvailable,
  killSandbox,
  provisionSandbox,
} from "../sandbox.js";
import { activeTurns, stopAgentTurn } from "../chat.js";
import { getLifecycle } from "../lifecycle.js";
import { FRESH_CLONE_WARNING, snapshotWorkspaceDiff } from "../workspace.js";

const router = Router();

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
    sandboxExpiresAt: owner.sandboxExpiresAt,
    workspacePath: owner.workspacePath,
    lastError: owner.lastError,
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
  if (sandboxAvailable && owner.sandboxStatus !== "error") {
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

  if (req.body?.confirmReplace !== true) {
    return res.status(409).json({
      code: "sandbox_reconnect_dirty",
      error:
        "A fresh sandbox cannot restore the previous workspace. Review any saved patch before replacing it.",
      patch: owner.lastDiff?.trim() ? { available: true, capturedAt: owner.lastDiffAt } : null,
    });
  }

  dropPty(owner.id);
  cancelSandboxProvisioning(owner.id);
  await killSandbox(owner.sandboxId);
  await prisma.projectSession.update({
    where: { id: owner.id },
    data: {
      sandboxId: "",
      sandboxStatus: "creating",
      sandboxExpiresAt: null,
      status: "queued",
      lastError: null,
    },
  });
  scheduleBackgroundTask(
    provisionSandbox(owner.id)
      .then(async (ready) => {
        if (!ready) return;
        await prisma.projectSession.update({
          where: { id: owner.id },
          data: {
            status: "idle",
            lastError: FRESH_CLONE_WARNING,
          },
        });
      })
      .catch((error) => console.error("Sandbox reconnect failed", error)),
  );
  return res.status(202).json({
    sandboxStatus: "creating",
    replaced: true,
    continuity: "fresh-clone",
    reviewOnlyPatch: Boolean(owner.lastDiff?.trim()),
  });
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
      sandboxExpiresAt: null,
      sandboxStatus: "error",
      status: "stopped",
      lastError: "Sandbox killed by user. Reconnect to start a new one.",
    },
  });
  return res.json({ ok: true });
});

export default router;
