import "dotenv/config";
import express from "express";
import { Sandbox } from "@e2b/code-interpreter";
import { ollama } from "ollama-ai-provider-v2";
import {
  convertToModelMessages,
  pipeUIMessageStreamToResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
} from "ai";
import { prisma } from "./lib/db";
import { sandboxTools } from "./lib/ai";

const app = express();
const port = Number(process.env.PORT ?? 3001);

type StoredMessage = {
  id?: string;
  role: "user" | "assistant" | "system";
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
};
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
    const session = await prisma.sessions.update({
      where: { id: req.params.sessionId },
      data: { archived: Boolean(req.body.archived) },
    });
    res.json(session);
  } catch {
    res.status(404).json({ message: "Session not found" });
  }
});

app.post("/ai/:sessionId", async (req, res) => {
  const session = await prisma.sessions.findUnique({
    where: { id: req.params.sessionId },
  });
  if (!session) return res.status(404).json({ message: "Session not found" });
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
      system: `You are OpenDevin, an autonomous coding agent. Work in the attached sandbox. Inspect before editing, use tools for every repository action, run relevant tests, and report exactly what changed. Never claim a command ran unless its tool result confirms it. The repository directory is ${session.cwd}.`,
      tools: sandboxTools(sandbox, session.cwd),
      stopWhen: stepCountIs(12),
      maxRetries: 1,
      onFinish: async ({ text }) => {
        // Store the assistant response using the same UIMessage parts shape used by the AI SDK.
        const current = await prisma.sessions.findUnique({
          where: { id: session.id },
          select: { parts: true },
        });
        const history = current ? parseMessages(current.parts) : incoming;
        history.push({
          id: `assistant-${Date.now()}`,
          role: "assistant",
          parts: [{ type: "text", text }],
        });
        await prisma.sessions
          .update({
            where: { id: session.id },
            data: { parts: JSON.stringify(history), status: "idle" },
          })
          .catch(() => undefined);
      },
    });
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    await pipeUIMessageStreamToResponse({
      response: res,
      stream: toUIMessageStream({ stream: result.stream }),
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

app.listen(port, () =>
  console.log(`OpenDevin listening on http://localhost:${port}`),
);
