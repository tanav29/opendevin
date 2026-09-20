import { createServer, type Server } from "node:http";
import type { Express } from "express";
import { WebSocketServer } from "ws";
import { auth } from "./auth/auth.js";
import { WORKSPACE_PATH } from "./config.js";
import { authHeaders } from "./http.js";
import { prisma } from "./db/prisma.js";
import { attachPty, detachPty, replayPty, resizePty, writePty } from "./pty.js";
import { checkSandboxAvailable } from "./sandbox.js";

// Terminal PTY bridge: browser WS <-> shared E2B PTY for the session.
// Message protocol (JSON): client -> {type:"input",data} | {type:"resize",cols,rows};
// server -> {type:"ready",pid} | {type:"replay",data} | {type:"data",data} | {type:"reset"} | {type:"error",error}.
export function createHttpServer(app: Express): { server: Server; wss: WebSocketServer } {
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url || "", "http://localhost");
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/pty$/);
      if (!match) {
        socket.destroy();
        return;
      }
      const fail = (code: string) => {
        socket.write(`HTTP/1.1 ${code}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
      };
      let owner: { id: string; sandboxId: string; workspacePath: string } | null | undefined;
      try {
        const session = await auth.api.getSession({ headers: authHeaders(req) });
        if (!session) return fail("401 Unauthorized");
        owner = await prisma.projectSession.findFirst({
          where: { id: match[1], project: { userId: session.user.id } },
          include: { project: true },
        });
        if (!owner) return fail("404 Not Found");
        if (!owner.sandboxId || !(await checkSandboxAvailable(owner.sandboxId)))
          return fail("409 Conflict");
      } catch {
        return fail("500 Internal Server Error");
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        (async () => {
          const cols = Number(url.searchParams.get("cols") || 80);
          const rows = Number(url.searchParams.get("rows") || 24);
          const sessionOwner = owner as { id: string; sandboxId: string; workspacePath: string };
          try {
            const entry = await attachPty(
              sessionOwner.id,
              sessionOwner.sandboxId,
              sessionOwner.workspacePath || WORKSPACE_PATH,
              cols,
              rows,
              ws,
            );
            ws.send(JSON.stringify({ type: "ready", pid: entry.pid }));
            const replay = replayPty(sessionOwner.id);
            if (replay) ws.send(JSON.stringify({ type: "replay", data: replay }));
          } catch {
            ws.send(
              JSON.stringify({
                error:
                  "Terminal unavailable: the sandbox PTY could not start. Reconnect and retry.",
              }),
            );
            ws.close();
            return;
          }
          ws.on("message", (raw) => {
            void (async () => {
              let message: { type?: string; data?: string; cols?: number; rows?: number };
              try {
                message = JSON.parse(String(raw));
              } catch {
                return;
              }
              try {
                if (message.type === "input" && typeof message.data === "string") {
                  const reset = await writePty(
                    sessionOwner.id,
                    sessionOwner.sandboxId,
                    sessionOwner.workspacePath || WORKSPACE_PATH,
                    message.data.slice(0, 16_000),
                  );
                  if (reset) ws.send(JSON.stringify({ type: "reset" }));
                } else if (message.type === "resize") {
                  await resizePty(
                    sessionOwner.id,
                    sessionOwner.sandboxId,
                    Number(message.cols) || 80,
                    Number(message.rows) || 24,
                  );
                }
              } catch {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    error: "Terminal write failed: the sandbox is unreachable.",
                  }),
                );
              }
            })();
          });
          ws.on("close", () => detachPty(sessionOwner.id, ws));
        })().catch(() => ws.close());
      });
    })();
  });

  return { server, wss };
}
