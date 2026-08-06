import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { Sandbox } from "@e2b/code-interpreter";
import { ollama } from "ollama-ai-provider-v2";
import {
  convertToModelMessages,
  pipeUIMessageStreamToResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { prisma } from "./lib/db";
import { sandboxTools } from "./lib/ai";

const app = express();
const port = Number(process.env.PORT ?? 3001);
type TerminalClient = WebSocket;
type TerminalSession = {
  sandbox: Sandbox;
  pid: number;
  output: string;
  clients: Set<TerminalClient>;
};
const terminals = new Map<string, TerminalSession>();

async function openTerminal(session: { id: string; sandbox: string; cwd: string }) {
  let terminal = terminals.get(session.id);
  if (terminal) return terminal;
  const sandbox = await Sandbox.connect(session.sandbox);
  let created: TerminalSession | undefined;
  const handle = await sandbox.pty.create({
    cols: 100,
    rows: 32,
    cwd: session.cwd,
    onData: (data) => {
      if (!created) return;
      const text = new TextDecoder().decode(data);
      created.output = (created.output + text).slice(-100_000);
      for (const client of created.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(text);
      }
    },
  });
  created = { sandbox, pid: handle.pid, output: "", clients: new Set() };
  terminals.set(session.id, created);
  return created;
}

// Keep the complete AI SDK UI message. Text-only persistence loses the tool
// call and tool-result parts that make an agent run auditable in the client.
type StoredMessage = UIMessage;
const parseMessages = (value: string): StoredMessage[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
app.use(express.json({ limit: "2mb" }));
app.use((_req, res, next) => {
  res.setHeader(
    "Access-Control-Allow-Origin",
    process.env.FRONTEND_URL ?? "http://localhost:3000",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.get("/", (_req, res) =>
  res.json({ ok: true, service: "opendevin", version: "0.1.0" }),
);
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/sessions", async (_req, res) => {
  try {
    const sessions = await prisma.sessions.findMany({
      where: { archived: false },
      orderBy: { updatedAt: "desc" },
    });
    res.json(sessions);
  } catch (error) {
    console.error("list sessions failed", error);
    res.status(500).json({ message: "Could not load sessions" });
  }
});

app.post("/new", async (req, res) => {
  const { prompt, gitUrl } = req.body as { prompt?: string; gitUrl?: string };
  if (
    !gitUrl ||
    typeof gitUrl !== "string" ||
    !/^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)\//i.test(gitUrl)
  ) {
    return res
      .status(400)
      .json({ message: "Enter a valid public Git repository URL" });
  }
  try {
    const sandbox = await Sandbox.create({
      timeoutMs: 15 * 60 * 1000,
      lifecycle: {
        onTimeout: "pause", // don't kill
      },
    });
    const repoName =
      gitUrl
        .split("/")
        .pop()
        ?.replace(/\.git$/, "") || "repository";
    const clone = await sandbox.git.clone(gitUrl);
    if (clone.exitCode !== 0)
      return res
        .status(502)
        .json({ message: "Could not clone repository", stderr: clone.stderr });
    const session = await prisma.sessions.create({
      data: {
        git: gitUrl,
        sandbox: sandbox.sandboxId,
        cwd: `/home/user/${repoName}`,
        status: "idle",
      },
    });
    res.status(201).json({
      message: "Session created",
      sessionId: session.id,
      sandboxId: sandbox.sandboxId,
      prompt,
    });
  } catch (error) {
    console.error("create session failed", error);
    res.status(500).json({
      message:
        "Could not create session. Check E2B_API_KEY and repository access.",
    });
  }
});

app.get("/sessions/:sessionId/messages", async (req, res) => {
  try {
    const session = await prisma.sessions.findUnique({
      where: { id: req.params.sessionId },
      select: { parts: true },
    });
    if (!session) return res.status(404).json({ message: "Session not found" });
    res.json(parseMessages(session.parts));
  } catch {
    res.status(500).json({ message: "Could not load messages" });
  }
});

app.patch("/sessions/:sessionId", async (req, res) => {
  try {
    const current = await prisma.sessions.findUnique({
      where: { id: req.params.sessionId },
    });
    if (!current) return res.status(404).json({ message: "Session not found" });
    if (req.body.archived) {
      const terminal = terminals.get(current.id);
      if (terminal) {
        await terminal.sandbox.pty.kill(terminal.pid).catch(() => undefined);
        terminals.delete(current.id);
      }
      await Sandbox.connect(current.sandbox)
        .then((sandbox) => sandbox.kill())
        .catch(() => undefined);
    }
    const session = await prisma.sessions.update({
      where: { id: req.params.sessionId },
      data: {
        archived: Boolean(req.body.archived),
        ...(req.body.archived ? { status: "stopped" } : {}),
      },
    });
    res.json(session);
  } catch {
    res.status(404).json({ message: "Session not found" });
  }
});

app.get("/sessions/:sessionId/sandbox", async (req, res) => {
  const session = await prisma.sessions.findUnique({
    where: { id: req.params.sessionId },
  });
  if (!session) return res.status(404).json({ message: "Session not found" });
  if (session.status === "stopped") return res.json({ status: "stopped" });
  try {
    const sandbox = await Sandbox.connect(session.sandbox);
    res.json({ status: (await sandbox.isRunning()) ? "running" : "stopped" });
  } catch {
    res.json({ status: "stopped" });
  }
});

app.post("/sessions/:sessionId/stop", async (req, res) => {
  const session = await prisma.sessions.findUnique({
    where: { id: req.params.sessionId },
  });
  if (!session) return res.status(404).json({ message: "Session not found" });
  const terminal = terminals.get(session.id);
  if (terminal) {
    await terminal.sandbox.pty.kill(terminal.pid).catch(() => undefined);
    terminals.delete(session.id);
  }
  await Sandbox.connect(session.sandbox)
    .then((sandbox) => sandbox.kill())
    .catch(() => undefined);
  const updated = await prisma.sessions.update({
    where: { id: session.id },
    data: { status: "stopped" },
  });
  res.json({ status: "stopped", session: updated });
});

app.get("/sessions/:sessionId/diff", async (req, res) => {
  const session = await prisma.sessions.findUnique({
    where: { id: req.params.sessionId },
  });
  if (!session) return res.status(404).json({ message: "Session not found" });
  if (session.status === "stopped")
    return res
      .status(409)
      .json({ message: "Start a new workspace to inspect a stopped sandbox." });
  try {
    const sandbox = await Sandbox.connect(session.sandbox);
    const result = await sandbox.commands.run(
      "git diff --no-ext-diff --unified=3",
      { cwd: session.cwd, timeoutMs: 30_000 },
    );
    if (result.exitCode !== 0)
      return res
        .status(502)
        .json({ message: result.stderr || "Could not read Git diff." });
    res.json({ diff: result.stdout });
  } catch {
    res.status(502).json({ message: "Could not connect to this sandbox." });
  }
});

app.post("/sessions/:sessionId/terminal", async (req, res) => {
  const session = await prisma.sessions.findUnique({
    where: { id: req.params.sessionId },
  });
  if (!session) return res.status(404).json({ message: "Session not found" });
  if (session.status === "stopped")
    return res.status(409).json({ message: "This sandbox has been stopped." });
  try {
    const terminal = await openTerminal(session);
    res.json({ pid: terminal.pid, output: terminal.output });
  } catch {
    res
      .status(502)
      .json({ message: "Could not start a terminal for this sandbox." });
  }
});

app.get("/sessions/:sessionId/terminal", async (req, res) => {
  const terminal = terminals.get(req.params.sessionId);
  if (!terminal)
    return res.status(404).json({ message: "Terminal is not open." });
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json({
    output: terminal.output.slice(offset),
    offset: terminal.output.length,
  });
});

app.post("/sessions/:sessionId/terminal/input", async (req, res) => {
  const terminal = terminals.get(req.params.sessionId);
  const input = req.body.input;
  if (!terminal)
    return res.status(404).json({ message: "Terminal is not open." });
  if (typeof input !== "string" || !input)
    return res.status(400).json({ message: "Terminal input is required." });
  await terminal.sandbox.pty.sendInput(
    terminal.pid,
    new TextEncoder().encode(input),
  );
  res.sendStatus(204);
});

app.post("/ai/:sessionId", async (req, res) => {
  const session = await prisma.sessions.findUnique({
    where: { id: req.params.sessionId },
  });
  if (!session) return res.status(404).json({ message: "Session not found" });
  if (session.status === "stopped")
    return res
      .status(409)
      .json({ message: "This session's sandbox has been stopped." });
  const body = req.body as { prompt?: string; messages?: unknown[] };
  if (
    (!body.prompt || typeof body.prompt !== "string") &&
    !Array.isArray(body.messages)
  )
    return res.status(400).json({ message: "prompt or messages is required" });
  try {
    await prisma.sessions.update({
      where: { id: session.id },
      data: { status: "running" },
    });
    const abortController = new AbortController();
    const abort = () => {
      if (!res.writableFinished) abortController.abort();
    };
    req.once("aborted", abort);
    res.once("close", abort);
    const sandbox = await Sandbox.connect(session.sandbox);
    const incoming = Array.isArray(body.messages)
      ? (body.messages as StoredMessage[])
      : [];
    // Persist the complete UIMessage[] before starting generation so a disconnect never loses the user prompt.
    if (incoming.length) {
      await prisma.sessions.update({
        where: { id: session.id },
        data: { parts: JSON.stringify(incoming) },
      });
    }
    const messages = incoming.length
      ? await convertToModelMessages(incoming as never[])
      : undefined;
    const result = streamText({
      model: ollama(process.env.OLLAMA_MODEL ?? "qwen3.5:4b"),
      abortSignal: abortController.signal,
      ...(messages ? { messages } : { prompt: body.prompt as string }),
      system: `You are OpenDevin, an autonomous coding agent. Working in the attached sandbox. Inspect before editing, use tools for repository actions, run relevant tests, and report exactly what changed. Never claim a command ran unless its tool result confirms it. The repository directory is ${session.cwd}. Your major text response will be in the last part for user and can do all processing on the above parts.`,
      tools: sandboxTools(sandbox, session.cwd),
      stopWhen: stepCountIs(100),
      maxRetries: 1,
    });
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    await pipeUIMessageStreamToResponse({
      response: res,
      stream: toUIMessageStream({
        stream: result.stream,
        originalMessages: incoming as UIMessage[],
        onFinish: async ({ messages }) => {
          await prisma.sessions
            .update({
              where: { id: session.id },
              data: { parts: JSON.stringify(messages), status: "idle" },
            })
            .catch(() => undefined);
        },
      }),
    });
  } catch (error) {
    await prisma.sessions
      .update({ where: { id: session.id }, data: { status: "idle" } })
      .catch(() => undefined);
    console.error("AI request failed", error);
    if (!res.headersSent)
      res
        .status(502)
        .json({ message: "AI request failed. Check that Ollama is running." });
  }
});

const server = createServer(app);
const terminalWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const match = new URL(request.url ?? "", `http://${request.headers.host}`).pathname.match(
    /^\/sessions\/([^/]+)\/terminal\/ws$/,
  );
  if (!match) {
    socket.destroy();
    return;
  }
  terminalWss.handleUpgrade(request, socket, head, (client) => {
    terminalWss.emit("connection", client, match[1]);
  });
});

terminalWss.on("connection", async (client: WebSocket, sessionId: string) => {
  try {
    const session = await prisma.sessions.findUnique({ where: { id: sessionId } });
    if (!session || session.status === "stopped") {
      client.close(1008, "Session is unavailable");
      return;
    }
    const terminal = await openTerminal(session);
    terminal.clients.add(client);
    // Replay the current PTY buffer so reconnects are seamless.
    if (terminal.output) client.send(terminal.output);

    client.on("message", async (payload) => {
      try {
        const message = JSON.parse(payload.toString()) as { type?: string; data?: string };
        if (message.type === "input" && typeof message.data === "string") {
          await terminal.sandbox.pty.sendInput(
            terminal.pid,
            new TextEncoder().encode(message.data),
          );
        }
      } catch {
        // Ignore malformed client frames; the connection remains usable.
      }
    });
    client.on("close", () => terminal.clients.delete(client));
  } catch {
    client.close(1011, "Could not open terminal");
  }
});

server.listen(port, () =>
  console.log(`OpenDevin listening on http://localhost:${port}`),
);
