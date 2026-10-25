import { createServer, type Server } from "node:http";
import type { Express } from "express";
import { Server as SocketIOServer } from "socket.io";
import { createApp } from "./application.js";
import { auth } from "./auth/auth.js";
import { FRONTEND_ORIGINS, WORKSPACE_PATH } from "./config.js";
import { authHeaders } from "./http.js";
import { prisma } from "./db/prisma.js";
import { attachPty, detachPty, replayPty, resizePty, writePty } from "./pty.js";
import { checkSandboxAvailable } from "./sandbox.js";

export function createHttpServer(app: Express): { server: Server; io: SocketIOServer } {
  const server = createServer(app);
  const io = new SocketIOServer(server, {
    path: "/api/socket.io",
    transports: ["websocket"],
    cors: { origin: FRONTEND_ORIGINS, credentials: true },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, !origin || FRONTEND_ORIGINS.includes(origin));
    },
  });

  io.use(async (socket, next) => {
    try {
      const session = await auth.api.getSession({ headers: authHeaders(socket.request) });
      if (!session) return next(new Error("Sign in required"));

      const owner = await prisma.projectSession.findFirst({
        where: {
          id: String(socket.handshake.auth.sessionId || ""),
          project: { userId: session.user.id },
        },
        select: { id: true, sandboxId: true, workspacePath: true },
      });
      if (!owner) return next(new Error("Session not found"));
      if (!owner.sandboxId || !(await checkSandboxAvailable(owner.sandboxId)))
        return next(new Error("Sandbox unavailable"));

      socket.data.owner = owner;
      next();
    } catch {
      next(new Error("Terminal authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    const owner = socket.data.owner as {
      id: string;
      sandboxId: string;
      workspacePath: string;
    };
    const cols = Number(socket.handshake.auth.cols) || 80;
    const rows = Number(socket.handshake.auth.rows) || 24;

    void (async () => {
      try {
        const entry = await attachPty(
          owner.id,
          owner.sandboxId,
          owner.workspacePath || WORKSPACE_PATH,
          cols,
          rows,
          socket,
        );
        if (!socket.connected) {
          detachPty(owner.id, socket);
          return;
        }
        socket.emit("pty:ready", { pid: entry.pid });
        const replay = replayPty(owner.id);
        if (replay) socket.emit("pty:replay", { data: replay });
      } catch {
        socket.emit("pty:error", {
          error: "Terminal unavailable: the sandbox PTY could not start. Reconnect and retry.",
        });
        socket.disconnect(true);
        return;
      }

      socket.on("pty:input", (data: unknown) => {
        if (typeof data !== "string") return;
        void writePty(
          owner.id,
          owner.sandboxId,
          owner.workspacePath || WORKSPACE_PATH,
          data.slice(0, 16_000),
        )
          .then((reset) => {
            if (reset) socket.emit("pty:reset");
          })
          .catch(() => {
            socket.emit("pty:error", {
              error: "Terminal write failed: the sandbox is unreachable.",
            });
          });
      });

      socket.on("pty:resize", (size: unknown) => {
        if (!size || typeof size !== "object") return;
        const dimensions = size as { cols?: unknown; rows?: unknown };
        void resizePty(
          owner.id,
          owner.sandboxId,
          Number(dimensions.cols) || 80,
          Number(dimensions.rows) || 24,
        );
      });

      socket.on("disconnect", () => detachPty(owner.id, socket));
    })().catch(() => socket.disconnect(true));
  });

  return { server, io };
}

const { server } = createHttpServer(createApp());
export default server;
