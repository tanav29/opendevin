import { fromNodeHeaders } from "better-auth/node";
import { waitUntil } from "@vercel/functions";
import type { NextFunction, Request, Response } from "express";
import { auth } from "./auth/auth.js";
import { prisma } from "./db/prisma.js";
import { workspaceLocked, workspaceOperations } from "./lifecycle.js";

export function scheduleBackgroundTask(task: Promise<unknown>): void {
  if (process.env.VERCEL) waitUntil(task);
  else void task;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export async function currentUser(req: Request) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) throw new HttpError(401, "Sign in required");
  return session;
}

export async function ownedSession(req: Request, id: string) {
  const session = await currentUser(req);
  const owner = await prisma.projectSession.findFirst({
    where: { id, project: { userId: session.user.id } },
    include: { project: true },
  });
  if (!owner) throw new HttpError(404, "Session not found");
  if (req.method !== "GET" && (workspaceLocked(owner) || workspaceOperations.has(owner.id))) {
    throw new HttpError(409, "A checkpoint operation is in progress. Wait for it to finish.");
  }
  return owner;
}

export async function ownedProject(req: Request, projectId: string) {
  const session = await currentUser(req);
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });
  if (!project) throw new HttpError(404, "Project not found");
  return { project, user: session.user };
}

export function sandboxNotReadyReason(sandboxStatus: string, lastError: string | null): string {
  return sandboxStatus === "error" && lastError
    ? `sandbox failed (${lastError}). Reconnect the sandbox and retry.`
    : "sandbox is still provisioning. Retry once it is ready.";
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const code = (err as { status?: number } | null)?.status;
  const status = code && Number.isInteger(code) && code >= 400 && code <= 599 ? code : 500;
  if (status >= 500) console.error("Unhandled route error", err);
  res.status(status).json({
    error:
      status === 413
        ? "Request body too large."
        : status === 400
          ? "Invalid request body."
          : "Internal server error.",
  });
}
