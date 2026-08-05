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
  tool,
} from "ai";
import { z } from "zod";
import { prisma } from "./lib/db";
import { sandboxTools } from "./lib/ai";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "opendevin" });
});

app.post("/new", async (req, res) => {
  const { prompt, gitUrl } = req.body as { prompt?: string; gitUrl?: string };
  if (!gitUrl || typeof gitUrl !== "string") {
    return res.status(400).json({ message: "gitUrl is required" });
  }

  try {
    const sandbox = await Sandbox.create();
    const clone = await sandbox.git.clone(gitUrl, {
      branch: "main",
      // Set GITHUB_TOKEN in the server environment for private repositories.
      // username: process.env.GITHUB_TOKEN ? "x-access-token" : undefined,
      // password: process.env.GITHUB_TOKEN,
    });

    if (clone.exitCode !== 0) {
      return res
        .status(502)
        .json({ message: "Could not clone repository", stderr: clone.stderr });
    }

    const session = await prisma.sessions.create({
      data: {
        git: gitUrl,
        sandbox: sandbox.sandboxId,
        cwd: "/home/user/" + gitUrl.split("/").pop()?.replace(".git", ""),
      },
    });

    return res.json({
      message: "Session created",
      sessionId: session.id,
      sandboxId: sandbox.sandboxId,
      prompt,
    });
  } catch (error) {
    console.error("create session failed", error);
    return res.status(500).json({ message: "Could not create session" });
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
  ) {
    return res.status(400).json({ message: "prompt or messages is required" });
  }

  try {
    const sandbox = await Sandbox.connect(session.sandbox);
    // const tools = ;
    const messages = Array.isArray(body.messages)
      ? await convertToModelMessages(body.messages as never[])
      : undefined;

    const result = streamText({
      model: ollama("qwen3.5:4b"),
      ...(messages ? { messages } : { prompt: body.prompt as string }),
      system: `You are OpenDevin, an autonomous coding agent. Work on the user's repository in the attached sandbox. Inspect before editing, use tools for every repository action, run relevant tests, and report exactly what changed. The sandbox is already attached; never claim to have run a command unless a tool result confirms it. The default repository directory is ${session.cwd}.`,
      tools: sandboxTools(sandbox, session.cwd),
      stopWhen: stepCountIs(12),
      maxRetries: 1,
    });

    res.setHeader("Cache-Control", "no-cache");
    await pipeUIMessageStreamToResponse({
      response: res,
      stream: toUIMessageStream({ stream: result.stream }),
    });
  } catch (error) {
    console.error("AI request failed", error);
    if (!res.headersSent)
      res.status(502).json({ message: "AI request failed" });
  }
});

app.listen(port, () =>
  console.log(`OpenDevin listening on http://localhost:${port}`),
);
