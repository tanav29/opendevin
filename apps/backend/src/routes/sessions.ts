import type { Express } from "express";
import { prisma } from "../db/prisma.js";
import { resolveChatModel } from "../config.js";
import { asyncRoute, currentUser, ownedSession, routeParam } from "../http.js";
import { dropPty } from "../pty.js";
import {
  cancelSandboxProvisioning,
  checkSandboxAvailable,
  killSandbox,
  provisionSandbox,
} from "../sandbox.js";
import { activeTurns, stopAgentTurn } from "../chat.js";
import { getLifecycle } from "../lifecycle.js";
import { decideReconnect } from "../reconnect-policy.js";
import { FRESH_CLONE_WARNING, snapshotWorkspaceDiff } from "../workspace.js";

export function registerSessionRoutes(app: Express): void {
  // Every session the user owns, newest first — powers the /s sidebar.
  app.get(
    "/api/sessions",
    asyncRoute(async (req, res) => {
      const session = await currentUser(req);
      if (!session) return res.status(401).json({ error: "Sign in required" });
      const sessions = await prisma.projectSession.findMany({
        where: { project: { userId: session.user.id }, archivedAt: null },
        include: { project: { select: { id: true, repo: true } } },
        omit: { toolLog: true, lastDiff: true },
        orderBy: { updatedAt: "desc" },
      });
      return res.json(sessions);
    }),
  );

  app.post(
    "/api/sessions/:id/archive",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      dropPty(found.owner.id);
      stopAgentTurn(found.owner.id);
      cancelSandboxProvisioning(found.owner.id);
      await snapshotWorkspaceDiff(found.owner.id);
      await killSandbox(found.owner.sandboxId);
      await prisma.projectSession.update({
        where: { id: found.owner.id },
        data: { archivedAt: new Date() },
      });
      return res.json({ ok: true });
    }),
  );

  app.get(
    "/api/sessions/:id/messages",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      return res.json(
        await prisma.message.findMany({
          where: { sessionId: found.owner.id },
          orderBy: { createdAt: "asc" },
        }),
      );
    }),
  );

  app.get(
    "/api/sessions/:id",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      // toolLog/lastDiff can be ~100KB each and the UI never reads them here.
      const { toolLog: _toolLog, lastDiff: _lastDiff, ...safe } = found.owner;
      return res.json(safe);
    }),
  );

  app.get(
    "/api/sessions/:id/status",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      const sandboxAvailable = await checkSandboxAvailable(found.owner.sandboxId);
      const hasAssistant = await prisma.message
        .count({
          where: { sessionId: found.owner.id, role: "assistant" },
        })
        .then((count) => count > 0);
      const activeTurn = activeTurns.get(found.owner.id);
      const staleQueued =
        !activeTurn &&
        found.owner.status === "queued" &&
        found.owner.sandboxStatus === "ready" &&
        Date.now() - found.owner.updatedAt.getTime() > 30_000;
      const lifecycle = getLifecycle({
        sandboxStatus: found.owner.sandboxStatus,
        sandboxAvailable,
        status: staleQueued ? "running" : found.owner.status,
        activeTurn: Boolean(activeTurn),
        turnKind: activeTurn?.kind ?? null,
        hasAssistant,
      });
      let plan: { title: string; status: string }[] = [];
      try {
        const parsed = JSON.parse(found.owner.plan || "[]") as unknown;
        if (Array.isArray(parsed)) plan = parsed as typeof plan;
      } catch {
        // Keep default empty plan.
      }
      let usage: Record<string, unknown> = {};
      try {
        usage = (JSON.parse(found.owner.usage || "{}") as Record<string, unknown>) || {};
      } catch {
        // Keep default empty usage.
      }
      return res.json({
        sandboxStatus: found.owner.sandboxStatus,
        sandboxAvailable,
        sandboxId: found.owner.sandboxId,
        workspacePath: found.owner.workspacePath,
        lastError: found.owner.lastError,
        status: found.owner.status,
        lifecycle,
        repo: found.owner.project.repo,
        branch: found.owner.branch,
        createdAt: found.owner.createdAt,
        model: found.owner.model || resolveChatModel().modelId,
        plan,
        usage,
        devCommand: found.owner.project.devCommand ?? "",
        devPort: found.owner.project.devPort ?? 3000,
      });
    }),
  );

  app.post(
    "/api/sessions/:id/reconnect",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      if (found.owner.archivedAt) {
        return res.status(409).json({ error: "Archived sessions cannot be reconnected." });
      }
      const decision = decideReconnect({
        sandboxAvailable: await checkSandboxAvailable(found.owner.sandboxId),
        sandboxStatus: found.owner.sandboxStatus,
        lastDiff: found.owner.lastDiff,
        lastDiffAt: found.owner.lastDiffAt,
        activeTurn: activeTurns.has(found.owner.id),
        confirmReplace: req.body?.confirmReplace === true,
      });
      if (decision.action === "conflict") {
        return res.status(409).json({
          code: decision.code,
          error: decision.error,
          recoverable: decision.recoverable,
          patch: decision.patch,
          recovery: decision.recovery,
        });
      }
      if (decision.action === "reuse") {
        await prisma.projectSession.update({
          where: { id: found.owner.id },
          data: { sandboxStatus: "ready" },
        });
        return res.json({
          sandboxStatus: "ready",
          reattached: true,
          continuity: "existing-sandbox",
        });
      }

      dropPty(found.owner.id);
      cancelSandboxProvisioning(found.owner.id);
      await killSandbox(found.owner.sandboxId);
      await prisma.projectSession.update({
        where: { id: found.owner.id },
        data: { sandboxId: "", sandboxStatus: "creating", status: "queued", lastError: null },
      });
      void provisionSandbox(found.owner.id)
        .then(async (ready) => {
          if (!ready) return;
          await prisma.projectSession.update({
            where: { id: found.owner.id },
            data: {
              status: "idle",
              lastError: FRESH_CLONE_WARNING,
            },
          });
        })
        .catch((error) => console.error("Sandbox reconnect failed", error));
      return res.status(202).json({
        sandboxStatus: "creating",
        replaced: true,
        continuity: "fresh-clone",
        reviewOnlyPatch: Boolean(found.owner.lastDiff?.trim()),
      });
    }),
  );

  app.delete(
    "/api/sessions/:id",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      dropPty(found.owner.id);
      stopAgentTurn(found.owner.id);
      cancelSandboxProvisioning(found.owner.id);
      await killSandbox(found.owner.sandboxId);
      await prisma.projectSession.delete({ where: { id: found.owner.id } });
      return res.json({ ok: true });
    }),
  );

  app.post(
    "/api/sessions/:id/kill",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      dropPty(found.owner.id);
      stopAgentTurn(found.owner.id);
      cancelSandboxProvisioning(found.owner.id);
      await snapshotWorkspaceDiff(found.owner.id);
      await killSandbox(found.owner.sandboxId);
      await prisma.projectSession.update({
        where: { id: found.owner.id },
        data: {
          sandboxId: "",
          sandboxStatus: "error",
          status: "stopped",
          lastError: "Sandbox killed by user. Reconnect to start a new one.",
        },
      });
      return res.json({ ok: true });
    }),
  );
}
