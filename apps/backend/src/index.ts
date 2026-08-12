import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { Sandbox } from "@e2b/code-interpreter";
import { ollama } from "ollama-ai-provider-v2";
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
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
import { create } from "node:domain";

const runControllers = new Map<string, AbortController>();
const eventChains = new Map<string, Promise<unknown>>();
const terminalStatuses = new Set(["ready_for_review", "needs_attention", "cancelled", "failed"]);

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
const parseJson = (value: string) => { try { return JSON.parse(value); } catch { return {}; } };
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "task";

async function recordEvent(runId: string, type: string, message: string, payload: unknown = {}, status?: string) {
  const previous = eventChains.get(runId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const latest = await prisma.runEvent.aggregate({ where: { runId }, _max: { sequence: true } });
    return prisma.runEvent.create({ data: { runId, sequence: (latest._max.sequence ?? 0) + 1, type, status, message, payloadJson: JSON.stringify(payload) } });
  });
  eventChains.set(runId, next);
  try { return await next; } finally { if (eventChains.get(runId) === next) eventChains.delete(runId); }
}
async function updateRun(runId: string, status: string, data: Record<string, unknown> = {}) {
  const terminal = terminalStatuses.has(status);
  return prisma.agentRun.update({ where: { id: runId }, data: { status, ...data, ...(terminal ? { finishedAt: new Date() } : {}) } });
}

async function planRun(runId: string, session: { cwd: string; sandbox: string }, prompt: string) {
  try {
    const controller = new AbortController(); runControllers.set(runId, controller);
    const sandbox = await Sandbox.connect(session.sandbox);
    await recordEvent(runId, "plan_started", "Inspecting repository before proposing a plan.");
    const result = streamText({ model: ollama(process.env.OLLAMA_MODEL ?? "qwen3.5:4b"), prompt,
      system: `You are planning a bounded coding task in ${session.cwd}. Inspect the repository with read-only tools. Return ONLY valid JSON with objective, acceptanceCriteria (string[]), files (string[]), steps (string[]), validationCommands (string[]), risks (string[]), assumptions (string[]). Do not edit files.`,
      tools: sandboxTools(sandbox, session.cwd, { event: (t, m, p, s) => recordEvent(runId, t, m, p, s) }), stopWhen: stepCountIs(24), abortSignal: controller.signal });
    const raw = await result.text;
    let plan: Record<string, unknown>;
    try { plan = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "")); } catch { plan = { objective: prompt, steps: [], risks: ["The model returned a non-structured plan."], raw }; }
    await updateRun(runId, "awaiting_approval", { planJson: JSON.stringify(plan) });
    await recordEvent(runId, "plan_proposed", "Plan ready for operator approval.", plan, "awaiting_approval");
  } catch (error) {
    await updateRun(runId, "needs_attention", { summary: "Could not inspect the sandbox. Reconnect or create a new workspace." }).catch(() => undefined);
    await recordEvent(runId, "sandbox_unavailable", "Sandbox connection or planning failed.", { error: String(error) }, "failed").catch(() => undefined);
  } finally { runControllers.delete(runId); }
}

async function executeRun(runId: string, session: { id: string; cwd: string; sandbox: string }, run: { prompt: string; planJson: string }) {
  try {
    const controller = new AbortController(); runControllers.set(runId, controller);
    const sandbox = await Sandbox.connect(session.sandbox);
    const base = await sandbox.commands.run("git branch --show-current", { cwd: session.cwd });
    const baseBranch = base.stdout.trim() || "main";
    const branch = `opendevin/${runId.slice(-8)}/${slugify(run.prompt)}`;
    await sandbox.commands.run(`git switch -c ${branch}`, { cwd: session.cwd });
    await updateRun(runId, "running", { branch, baseBranch, startedAt: new Date() });
    await recordEvent(runId, "branch_created", `Created task branch ${branch}.`, { branch, baseBranch });
    const result = streamText({ model: ollama(process.env.OLLAMA_MODEL ?? "qwen3.5:4b"), prompt: run.prompt,
      system: `Execute only this approved plan in ${session.cwd}: ${run.planJson}. Use repository-relative paths only. Test after edits. Do not use destructive git commands, push, or access credentials. If you need work outside the plan, stop and explain. End with a concise handoff summary.`,
      tools: sandboxTools(sandbox, session.cwd, { mutate: true, event: (t, m, p, s) => recordEvent(runId, t, m, p, s) }), stopWhen: stepCountIs(80), abortSignal: controller.signal });
    const summary = await result.text;
    if (controller.signal.aborted) return;
    await updateRun(runId, "validating"); await recordEvent(runId, "validation_started", "Running recorded validation and capturing review evidence.");
    const plan = parseJson(run.planJson); const commands = Array.isArray(plan.validationCommands) ? plan.validationCommands as string[] : [];
    let validations: { command: string; exitCode: number; stderr: string }[] = [];
    const validate = async () => {
      validations = [];
      for (const command of commands) {
        if (/\b(git\s+(reset|clean|checkout\s+--|push\s+--force)|rm\s+-rf|sudo)\b/i.test(command)) throw new Error("Unsafe validation command in approved plan.");
        const checked = await sandbox.commands.run(command, { cwd: session.cwd, timeoutMs: 120_000 });
        validations.push({ command, exitCode: checked.exitCode, stderr: checked.stderr.slice(0, 30_000) });
        await recordEvent(runId, "test_completed", command, { exitCode: checked.exitCode, stdout: checked.stdout.slice(0, 30_000), stderr: checked.stderr.slice(0, 30_000) }, checked.exitCode === 0 ? "passed" : "failed");
      }
    };
    await validate();
    for (let attempt = 1; commands.length && validations.some((item) => item.exitCode !== 0) && attempt <= 2; attempt += 1) {
      if (controller.signal.aborted) return;
      const failures = validations.filter((item) => item.exitCode !== 0);
      await recordEvent(runId, "recovery_started", `Validation recovery attempt ${attempt} of 2.`, { failures, attempt }, "running");
      const recovery = streamText({ model: ollama(process.env.OLLAMA_MODEL ?? "qwen3.5:4b"), prompt: `Fix only the direct cause of these failures, then stop: ${JSON.stringify(failures)}`,
        system: `You are in recovery attempt ${attempt} for the approved plan: ${run.planJson}. Work only in ${session.cwd}; do not expand scope.`, tools: sandboxTools(sandbox, session.cwd, { mutate: true, event: (t, m, p, s) => recordEvent(runId, t, m, p, s) }), stopWhen: stepCountIs(30), abortSignal: controller.signal });
      await recovery.text;
      await recordEvent(runId, "recovery_completed", `Recovery attempt ${attempt} completed; rerunning validation.`, { attempt });
      await validate();
    }
    const diff = await sandbox.commands.run("git diff --no-ext-diff --unified=3", { cwd: session.cwd, timeoutMs: 30_000 });
    const files = await sandbox.commands.run("git diff --name-status", { cwd: session.cwd, timeoutMs: 30_000 });
    await prisma.runArtifact.createMany({ data: [
      { runId, kind: "diff", content: diff.stdout.slice(0, 100_000), truncated: diff.stdout.length > 100_000 },
      { runId, kind: "changed_files", content: files.stdout.slice(0, 30_000), truncated: files.stdout.length > 30_000 },
    ] });
    const validation = !commands.length ? "not_specified" : validations.every((item) => item.exitCode === 0) ? "passed" : "failed";
    const finalStatus = validation === "failed" ? "needs_attention" : "ready_for_review";
    await updateRun(runId, finalStatus, { summary, validationStatus: validation, prTitle: String(plan.objective || run.prompt).slice(0, 120), prBody: `## Summary\n${summary}\n\n## Validation\n${validations.map((item) => `- \`${item.command}\` — exit ${item.exitCode}`).join("\n") || "Not specified"}` });
    await recordEvent(runId, finalStatus === "ready_for_review" ? "review_ready" : "validation_failed", finalStatus === "ready_for_review" ? "Branch, diff, and handoff are ready for review." : "Validation failed; review logs and decide the next action.", { validation }, validation === "failed" ? "failed" : "passed");
  } catch (error) {
    const cancelled = runControllers.get(runId)?.signal.aborted;
    if (!cancelled) { await updateRun(runId, "needs_attention", { summary: `Execution stopped: ${String(error)}` }).catch(() => undefined); await recordEvent(runId, "failure", "Execution needs operator attention.", { error: String(error) }, "failed").catch(() => undefined); }
  } finally { runControllers.delete(runId); }
}
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

app.post("/sessions/:sessionId/runs", async (req, res) => {
  const prompt = req.body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) return res.status(400).json({ message: "A task prompt is required." });
  const session = await prisma.sessions.findUnique({ where: { id: req.params.sessionId } });
  if (!session) return res.status(404).json({ message: "Session not found" });
  if (session.status === "stopped") return res.status(409).json({ message: "This sandbox has been stopped." });
  const active = await prisma.agentRun.findFirst({ where: { sessionId: session.id, status: { in: ["planning", "awaiting_approval", "running", "validating"] } } });
  if (active) return res.status(409).json({ message: "This workspace already has an active run.", run: active });
  const run = await prisma.agentRun.create({ data: { sessionId: session.id, prompt: prompt.trim(), status: "planning" } });
  await recordEvent(run.id, "run_created", "Run created and queued for repository inspection.", { prompt: run.prompt }, "planning");
  void planRun(run.id, session, run.prompt);
  res.status(201).json({ run });
});

app.get("/runs/:runId", async (req, res) => {
  const run = await prisma.agentRun.findUnique({ where: { id: req.params.runId }, include: { artifacts: true } });
  if (!run) return res.status(404).json({ message: "Run not found" });
  res.json({ ...run, plan: parseJson(run.planJson), artifacts: undefined });
});

app.get("/runs/:runId/events", async (req, res) => {
  const run = await prisma.agentRun.findUnique({ where: { id: req.params.runId } });
  if (!run) return res.status(404).end();
  res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Cache-Control", "no-cache"); res.setHeader("Connection", "keep-alive"); res.flushHeaders();
  let last = Number(req.query.after ?? 0) || 0;
  const send = async () => { const events = await prisma.runEvent.findMany({ where: { runId: run.id, sequence: { gt: last } }, orderBy: { sequence: "asc" } }); for (const event of events) { last = event.sequence; res.write(`data: ${JSON.stringify({ ...event, payload: parseJson(event.payloadJson) })}\n\n`); } const current = await prisma.agentRun.findUnique({ where: { id: run.id } }); if (current && terminalStatuses.has(current.status) && !events.length) { res.write(`event: complete\ndata: ${JSON.stringify({ status: current.status })}\n\n`); clearInterval(timer); res.end(); } };
  const timer = setInterval(() => void send(), 800); void send(); req.on("close", () => clearInterval(timer));
});

app.post("/runs/:runId/approve", async (req, res) => {
  const run = await prisma.agentRun.findUnique({ where: { id: req.params.runId }, include: { session: true } });
  if (!run) return res.status(404).json({ message: "Run not found" });
  if (run.status !== "awaiting_approval") return res.status(409).json({ message: "Only a proposed plan can be approved." });
  await updateRun(run.id, "running", { startedAt: new Date() }); await recordEvent(run.id, "plan_approved", "Operator approved the plan; execution is starting.", {}, "running");
  void executeRun(run.id, run.session, run); res.json({ run: await prisma.agentRun.findUnique({ where: { id: run.id } }) });
});

app.post("/runs/:runId/cancel", async (req, res) => {
  const run = await prisma.agentRun.findUnique({ where: { id: req.params.runId } });
  if (!run) return res.status(404).json({ message: "Run not found" });
  runControllers.get(run.id)?.abort();
  const cancelled = await prisma.agentRun.update({ where: { id: run.id }, data: { status: "cancelled", cancelledAt: new Date(), finishedAt: new Date() } });
  await recordEvent(run.id, "cancelled", "Operator cancelled this run. Previous evidence has been preserved.", {}, "cancelled"); res.json({ run: cancelled });
});

app.get("/runs/:runId/diff", async (req, res) => {
  const artifact = await prisma.runArtifact.findFirst({ where: { runId: req.params.runId, kind: "diff" }, orderBy: { createdAt: "desc" } });
  const files = await prisma.runArtifact.findFirst({ where: { runId: req.params.runId, kind: "changed_files" }, orderBy: { createdAt: "desc" } });
  if (!artifact) return res.status(404).json({ message: "No review diff is available yet." });
  res.json({ diff: artifact.content, truncated: artifact.truncated, changedFiles: files?.content.split("\n").filter(Boolean) ?? [] });
});

app.post("/runs/:runId/validate", async (req, res) => {
  const run = await prisma.agentRun.findUnique({ where: { id: req.params.runId }, include: { session: true } });
  if (!run) return res.status(404).json({ message: "Run not found" });
  const plan = parseJson(run.planJson); const commands = Array.isArray(plan.validationCommands) ? plan.validationCommands as string[] : [];
  if (!commands.length) return res.status(409).json({ message: "This plan has no recorded validation commands." });
  try { const sandbox = await Sandbox.connect(run.session.sandbox); await updateRun(run.id, "validating"); const results = []; for (const command of commands) { const result = await sandbox.commands.run(command, { cwd: run.session.cwd, timeoutMs: 120_000 }); results.push({ command, exitCode: result.exitCode }); await recordEvent(run.id, "test_completed", command, results.at(-1), result.exitCode === 0 ? "passed" : "failed"); } const passed = results.every((v) => v.exitCode === 0); await updateRun(run.id, passed ? "ready_for_review" : "needs_attention", { validationStatus: passed ? "passed" : "failed" }); res.json({ results, status: passed ? "ready_for_review" : "needs_attention" }); } catch { await updateRun(run.id, "needs_attention", { summary: "Could not reconnect to sandbox for validation." }); res.status(502).json({ message: "Could not connect to sandbox." }); }
});

app.get("/sessions", async (_req, res) => {
  try {
    const sessions = await prisma.sessions.findMany({
      orderBy: { updatedAt: "desc" },
    });
    res.json(sessions);
  } catch (error) {
    console.error("list sessions failed", error);
    res.status(500).json({ message: "Could not load sessions" });
  }
});

app.get("/sessions/:sessionId/runs", async (req, res) => {
  const runs = await prisma.agentRun.findMany({ where: { sessionId: req.params.sessionId }, orderBy: { createdAt: "desc" }, take: 20 });
  res.json(runs.map((run) => ({ ...run, plan: parseJson(run.planJson) })));
});

app.post("/new", async (req, res) => {
  const body = req.body as { prompt?: string; gitUrl?: string };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return res.status(400).json({ message: "A task prompt is required" });

  // A repository can be supplied separately or pasted into the task prompt.
  const mentionedRepo = prompt.match(/https?:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\/[^\s)]+/i)?.[0]?.replace(/[.,;!?]+$/, "");
  const gitUrl = (typeof body.gitUrl === "string" && body.gitUrl.trim()) || mentionedRepo || "";
  if (gitUrl && !/^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[^\s/]+\/[^\s/]+/i.test(gitUrl)) {
    return res.status(400).json({ message: "Enter a valid public Git repository URL" });
  }
  try {
    const sandbox = await Sandbox.create({
      timeoutMs: 15 * 60 * 1000,
      lifecycle: {
        onTimeout: "pause", // don't kill
      },
    });
    const repoName = gitUrl
      ? gitUrl.split("/").pop()?.replace(/\.git$/, "").replace(/[^a-zA-Z0-9._-]/g, "-") || "repository"
      : "workspace";
    let cwd = `/home/user/${repoName}`;
    if (gitUrl) {
      const clone = await sandbox.git.clone(gitUrl);
      if (clone.exitCode !== 0)
        return res.status(502).json({ message: "Could not clone repository", stderr: clone.stderr });
    } else {
      cwd = "/home/user/workspace";
      const initialized = await sandbox.commands.run("mkdir -p /home/user/workspace && git init", { cwd: "/home/user" });
      if (initialized.exitCode !== 0)
        return res.status(502).json({ message: "Could not initialize workspace", stderr: initialized.stderr });
    }
    const session = await prisma.sessions.create({
      data: {
        git: gitUrl,
        sandbox: sandbox.sandboxId,
        cwd,
        status: "idle",
      },
    });
    const run = await prisma.agentRun.create({ data: { sessionId: session.id, prompt, status: "planning" } });
    await recordEvent(run.id, "run_created", "Run created and queued for workspace inspection.", { prompt: run.prompt }, "planning");
    void planRun(run.id, session, run.prompt);
    res.status(201).json({
      message: "Session created",
      sessionId: session.id,
      sandboxId: sandbox.sandboxId,
      prompt: run.prompt,
      gitUrl,
      runId: run.id,
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

    const op = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY
    })

    const result = streamText({
      model: op.chat(process.env.MODEL!),
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
