import "dotenv/config";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth/auth.js";
import { prisma } from "./db/prisma.js";
import {Sandbox} from "e2b";

const app = express();
const port = Number(process.env.PORT || 3001);
const execFileAsync = promisify(execFile);

async function openSandbox() {
  if (process.env.SANDBOX_IMAGE) {
    const { stdout } = await execFileAsync("docker", ["run", "-d", "--rm", process.env.SANDBOX_IMAGE, "sleep", "infinity"]);
    return { id: stdout.trim(), path: null };
  }
  const path = await mkdtemp(`${tmpdir()}/opendevin-`);
  return { id: path, path };
}

async function currentUser(req: express.Request) {
  return auth.api.getSession({ headers: req.headers as HeadersInit });
}

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000", credentials: true }));
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/projects", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const projects = await prisma.project.findMany({ where: { userId: session.user.id }, orderBy: { updatedAt: "desc" } });
  return res.json(projects);
});

app.get("/api/projects/:id", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const project = await prisma.project.findFirst({ where: { id: req.params.id, userId: session.user.id } });
  return project ? res.json(project) : res.status(404).json({ error: "Project not found" });
});

app.post("/api/projects", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const { name, repo } = req.body as { name?: string; repo?: string };
  if (!name?.trim()) return res.status(400).json({ error: "Project name is required" });
  const project = await prisma.project.create({ data: { name: name.trim(), repo, userId: session.user.id } });
  return res.status(201).json(project);
});

app.get("/api/projects/:projectId/sessions", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const project = await prisma.project.findFirst({ where: { id: req.params.projectId, userId: session.user.id } });
  if (!project) return res.status(404).json({ error: "Project not found" });
  return res.json(await prisma.projectSession.findMany({ where: { projectId: project.id }, orderBy: { updatedAt: "desc" } }));
});

app.post("/api/projects/:projectId/sessions", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const project = await prisma.project.findFirst({ where: { id: req.params.projectId, userId: session.user.id } });
  if (!project) return res.status(404).json({ error: "Project not found" });
  const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "A first message is required" });
  try {
    const sandbox = await Sandbox.create('base')

    const created = await prisma.projectSession.create({
      data: { projectId: project.id, title: message.slice(0, 60), sandboxId: sandbox.sandboxId, messages: { create: { role: "user", content: message } } },
      include: { messages: true },
    });
    return res.status(201).json({ ...created, sandboxPath: sandbox.path });
  } catch (error) {
    console.error("Unable to open sandbox", error);
    return res.status(500).json({ error: "Could not open a sandbox" });
  }
});

app.get("/api/sessions/:id/messages", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const owner = await prisma.projectSession.findFirst({ where: { id: req.params.id, project: { userId: session.user.id } } });
  if (!owner) return res.status(404).json({ error: "Session not found" });
  return res.json(await prisma.message.findMany({ where: { sessionId: owner.id }, orderBy: { createdAt: "asc" } }));
});

app.get("/api/sessions/:id", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const owner = await prisma.projectSession.findFirst({ where: { id: req.params.id, project: { userId: session.user.id } } });
  return owner ? res.json(owner) : res.status(404).json({ error: "Session not found" });
});

app.post("/api/sessions/:id/chat", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const prompt = typeof req.body.message === "string" ? req.body.message.trim() : "";
  if (!prompt) return res.status(400).json({ error: "A message is required" });
  const owner = await prisma.projectSession.findFirst({ where: { id: req.params.id, project: { userId: session.user.id } } });
  if (!owner) return res.status(404).json({ error: "Session not found" });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_API_KEY is not configured" });
  await prisma.message.create({ data: { sessionId: owner.id, role: "user", content: prompt } });
  await prisma.projectSession.update({ where: { id: owner.id }, data: { status: "running" } });
  const history = await prisma.message.findMany({ where: { sessionId: owner.id }, orderBy: { createdAt: "asc" } });
  const result = streamText({
    model: openai(process.env.OPENAI_MODEL || "gpt-4o-mini"),
    system: "You are OpenDevin, a practical coding agent working inside the user's sandbox. Be concise and explain what you will do.",
    messages: history.map(({ role, content }) => ({ role: role as "user" | "assistant", content })),
    onFinish: async ({ text }) => {
      await prisma.message.create({ data: { sessionId: owner.id, role: "assistant", content: text } });
      await prisma.projectSession.update({ where: { id: owner.id }, data: { status: "idle" } });
    },
  });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  for await (const chunk of result.textStream) res.write(chunk);
  return res.end();
});

app.get("/", (_req, res) => res.json({ name: "OpenDevin API", ok: true }));

app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
