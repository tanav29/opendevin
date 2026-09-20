import type { NextFunction, Request, Response } from "express";
import { auth } from "./auth/auth.js";
import { prisma } from "./db/prisma.js";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

// Wrap async route handlers so rejections reach the JSON error middleware
// instead of hanging or crashing the process.
export function asyncRoute(fn: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next);
  };
}

// Express 5 types route params as `string | string[]` (wildcards like
// `/api/auth/*splat` produce arrays). All of our `:id` params are single
// segments, so unwrap to a plain string in one place.
export function routeParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return (value as string | undefined) ?? "";
}

// Node's req.headers is a plain object (no .get()/.forEach()). Better Auth
// expects a real Headers instance, so build one once and share it between the
// REST helpers and the WebSocket upgrade handler.
export function authHeaders(req: { headers: NodeJS.Dict<string | string[] | undefined> }): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  return headers;
}

export async function currentUser(req: Request) {
  return auth.api.getSession({ headers: authHeaders(req) });
}

// Ownership check used by every session route: the signed-in user must own
// the session's project. Returns a discriminated result so callers map to
// 401 (signed out) vs 404 (not owned) without repeating the queries.
export async function ownedSession(req: Request, id: string) {
  const session = await currentUser(req);
  if (!session) return { auth: false as const };
  const owner = await prisma.projectSession.findFirst({
    where: { id, project: { userId: session.user.id } },
    include: { project: true },
  });
  if (!owner) return { auth: true as const, owner: null };
  return { auth: true as const, owner };
}

export async function ownedProject(req: Request, projectId: string) {
  const session = await currentUser(req);
  if (!session) return { auth: false as const };
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });
  if (!project) return { auth: true as const, project: null, user: session.user };
  return { auth: true as const, project, user: session.user };
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  console.error("Unhandled route error", err);
  if (err instanceof HttpError) {
    if (!res.headersSent) res.status(err.status).json({ error: err.message });
    else res.end();
    return;
  }
  const fields = (err ?? {}) as { status?: unknown; statusCode?: unknown };
  const code = fields.status ?? fields.statusCode;
  const safeStatus =
    typeof code === "number" && Number.isInteger(code) && code >= 400 && code <= 599 ? code : 500;
  if (!res.headersSent) {
    res.status(safeStatus).json({
      error: safeStatus === 413 ? "Request body too large." : "Internal server error.",
    });
  } else {
    res.end();
  }
}
