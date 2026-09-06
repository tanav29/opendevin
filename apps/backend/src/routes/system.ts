import type { Express } from "express";

export function registerSystemRoutes(app: Express): void {
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/", (_req, res) => res.json({ name: "OpenDevin API", ok: true }));
}
