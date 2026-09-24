import type { Express } from "express";
import { prisma } from "../db/prisma.js";
import { resolveChatModel } from "../config.js";
import { asyncRoute, currentUser, ownedSession, routeParam } from "../http.js";
import { dropPty } from "../pty.js";
import { checkSandboxAvailable, killSandbox, provisionSandbox } from "../sandbox.js";

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
        repo: found.owner.project.repo,
        branch: found.owner.branch,
        createdAt: found.owner.createdAt,
        model: resolveChatModel().modelId,
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
      dropPty(found.owner.id);
      if (await checkSandboxAvailable(found.owner.sandboxId)) {
        await prisma.projectSession.update({
          where: { id: found.owner.id },
          data: { sandboxStatus: "ready", lastError: null },
        });
        return res.json({ sandboxStatus: "ready" });
      }
      await prisma.projectSession.update({
        where: { id: found.owner.id },
        data: { sandboxStatus: "creating", status: "running", lastError: null },
      });
      void provisionSandbox(found.owner.id).catch((error) =>
        console.error("Sandbox reconnect failed", error),
      );
      return res.status(202).json({ sandboxStatus: "creating" });
    }),
  );

  app.delete(
    "/api/sessions/:id",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      dropPty(found.owner.id);
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
      await killSandbox(found.owner.sandboxId);
      await prisma.projectSession.update({
        where: { id: found.owner.id },
        data: {
          sandboxId: "",
          sandboxStatus: "error",
          status: "idle",
          lastError: "Sandbox killed by user. Reconnect to start a new one.",
        },
      });
      return res.json({ ok: true });
    }),
  );
}
