import "dotenv/config";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamText, type ModelMessage } from "ai";
import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { Sandbox } from "e2b";
import { WebSocketServer } from "ws";
import { auth } from "../auth/auth.js";
import { prisma } from "../db/prisma.js";
import { attachPty, detachPty, dropPty, replayPty, resizePty, writePty } from "../pty.js";
import { loadToolLog, saveToolLog, trimToolLog } from "../agent.js";
import {
  AGENT_STOP,
  WORKSPACE_PATH,
  checkSandboxAvailable,
  connectSandboxTools,
  githubTokenForUser,
  isRepoUrl,
  provisionSandbox,
  readWorkspaceDiff,
  resolveChatModel,
  runSandbox,
  sanitizeBranch,
  sanitizeRel,
  shellQuote,
  snapshotDiffAndIdle,
} from "../sandbox.js";
import { registerSystemRoutes } from "./system.js";

const app = express();
const port = Number(process.env.PORT || 3001);

// Node's req.headers is a plain object (no .get()/.forEach()). Better Auth
// expects a real Headers instance, so build one once and share it between the
// REST helpers and the WebSocket upgrade handler.
function authHeaders(req: { headers: NodeJS.Dict<string | string[] | undefined> }): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  return headers;
}

async function currentUser(req: express.Request) {
  return auth.api.getSession({ headers: authHeaders(req) });
}

async function ownedSession(req: express.Request, id: string) {
  const session = await currentUser(req);
  if (!session) return { auth: false as const };
  const owner = await prisma.projectSession.findFirst({
    where: { id, project: { userId: session.user.id } },
    include: { project: true },
  });
  if (!owner) return { auth: true as const, owner: null };
  return { auth: true as const, owner };
}

async function killSandbox(sandboxId: string): Promise<void> {
  if (!sandboxId) return;
  try {
    await Sandbox.kill(sandboxId);
  } catch {
    // Best-effort: sandbox may already be gone or expired.
  }
}

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000", credentials: true }));
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json({ limit: "1mb" }));

registerSystemRoutes(app);

app.get("/api/github/repos", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required", repos: [] });
  const token = await githubTokenForUser(session.user.id);
  if (!token) return res.json({ repos: [], needsAuth: true });
  try {
    const ghRes = await fetch(
      "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "opendevin",
        },
      },
    );
    if (!ghRes.ok) {
      const text = await ghRes.text().catch(() => "");
      console.error("GitHub repos fetch failed", ghRes.status, text.slice(0, 400));
      if (ghRes.status === 401)
        return res.status(401).json({ error: "GitHub token expired. Sign in again.", repos: [] });
      return res.status(502).json({ error: `GitHub error ${ghRes.status}`, repos: [] });
    }
    const data = (await ghRes.json()) as Array<{
      id: number;
      name: string;
      full_name: string;
      html_url: string;
      clone_url: string;
      private: boolean;
      description: string | null;
      language: string | null;
      stargazers_count: number;
      fork: boolean;
      updated_at: string;
      owner: { login: string };
    }>;
    const repos = data
      .map((r) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        htmlUrl: r.html_url,
        cloneUrl: r.clone_url || `${r.html_url}.git`,
        private: !!r.private,
        description: r.description || "",
        language: r.language,
        stars: r.stargazers_count ?? 0,
        fork: !!r.fork,
        updatedAt: r.updated_at,
        owner: r.owner?.login || "",
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 100);
    return res.json({ repos });
  } catch (e) {
    console.error("GitHub repos exception", e);
    return res.status(500).json({ error: "Could not fetch GitHub repos", repos: [] });
  }
});
app.get("/api/me", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  let github: { login: string | null; avatarUrl: string | null; profileUrl: string | null } = {
    login: null,
    avatarUrl: null,
    profileUrl: null,
  };
  const token = await githubTokenForUser(session.user.id);
  if (token) {
    try {
      const gh = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "opendevin",
        },
      });
      if (gh.ok) {
        const d = (await gh.json()) as { login?: string; avatar_url?: string; html_url?: string };
        github = {
          login: d.login ?? null,
          avatarUrl: d.avatar_url ?? null,
          profileUrl: d.html_url ?? null,
        };
      }
    } catch {
      // Fall back to stored session profile.
    }
  }
  return res.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    },
    github,
  });
});

app.get("/api/projects", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
  });
  return res.json(projects);
});

app.get("/api/projects/:id", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, userId: session.user.id },
  });
  return project ? res.json(project) : res.status(404).json({ error: "Project not found" });
});

app.post("/api/projects", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const { name, repo } = req.body as { name?: string; repo?: string };
  if (!name?.trim()) return res.status(400).json({ error: "Project name is required" });
  const project = await prisma.project.create({
    data: { name: name.trim(), repo, userId: session.user.id },
  });
  return res.status(201).json(project);
});

app.delete("/api/projects/:id", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, userId: session.user.id },
  });
  if (!project) return res.status(404).json({ error: "Project not found" });
  const sessions = await prisma.projectSession.findMany({
    where: { projectId: project.id },
    select: { id: true, sandboxId: true },
  });
  for (const s of sessions) {
    dropPty(s.id);
    await killSandbox(s.sandboxId);
  }
  await prisma.project.delete({ where: { id: project.id } });
  return res.json({ ok: true });
});

app.get("/api/projects/:projectId/sessions", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, userId: session.user.id },
  });
  if (!project) return res.status(404).json({ error: "Project not found" });
  return res.json(
    await prisma.projectSession.findMany({
      where: { projectId: project.id },
      omit: { toolLog: true, lastDiff: true },
      orderBy: { updatedAt: "desc" },
    }),
  );
});

app.get("/api/projects/:projectId/branches", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, userId: session.user.id },
  });
  if (!project) return res.status(404).json({ error: "Project not found" });
  const repo = project.repo?.trim() || "";
  if (!isRepoUrl(repo)) return res.json({ branches: [], defaultBranch: "" });
  try {
    const execFileAsync = promisify(execFile);
    // Private repos need the owner's token for ls-remote. Pass it via an
    // http.extraHeader flag (never embedded in the URL) and redact it from
    // any error that gets logged, so it can't leak into server logs.
    let extraHeader: string[] = [];
    try {
      const token = await githubTokenForUser(session.user.id);
      if (token && /^https:\/\/github\.com\//i.test(repo)) {
        extraHeader = ["-c", `http.extraHeader=Authorization: Bearer ${token}`];
      }
    } catch {
      // Fall back to unauthenticated ls-remote for public repos.
    }
    const lsRemote = (args: string[], timeout: number) =>
      execFileAsync("git", [...extraHeader, ...args, "--", repo], { timeout });
    // Try to get default branch via symref first (handles canary/develop etc)
    let defaultBranch = "";
    try {
      const { stdout: symrefOut } = await lsRemote(["ls-remote", "--symref", "HEAD"], 8000);
      const match = symrefOut.match(/ref:\s*refs\/heads\/([^\s]+)\s+HEAD/);
      if (match) defaultBranch = match[1].trim();
    } catch {
      // symref may fail for some hosts — fall back to guessing
    }
    const { stdout } = await lsRemote(["ls-remote", "--heads"], 15000);
    const branches = stdout
      .split("\n")
      .map((line) => line.split("\t")[1]?.replace("refs/heads/", "").trim())
      .filter((b): b is string => Boolean(b))
      .slice(0, 200);
    if (!defaultBranch) {
      defaultBranch = branches.includes("main")
        ? "main"
        : branches.includes("master")
          ? "master"
          : branches[0] || "";
    }
    // Ensure defaultBranch is actually in the list; if we got it from symref but list is truncated, keep it
    return res.json({ branches, defaultBranch });
  } catch (error) {
    const safe = String(error instanceof Error ? error.message : error)
      .replace(/Bearer [^\s]+/g, "Bearer [redacted]")
      .slice(0, 300);
    console.error("List branches failed", safe);
    return res.json({ branches: [], defaultBranch: "" });
  }
});

// Cursor-like: creating a session immediately returns a record, then a cloud
// sandbox spins up in the background and clones the project's repo on the
// requested branch (empty = repo default branch). Once ready, the opening
// prompt runs automatically so the agent answers without a second message.
app.post("/api/projects/:projectId/sessions", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, userId: session.user.id },
  });
  if (!project) return res.status(404).json({ error: "Project not found" });
  const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "A first message is required" });
  const branch = sanitizeBranch(req.body.branch);

  const created = await prisma.projectSession.create({
    data: {
      projectId: project.id,
      title: message.slice(0, 60),
      status: "running",
      sandboxId: "",
      sandboxStatus: "creating",
      workspacePath: WORKSPACE_PATH,
      branch,
      // Seed the model transcript with the opening prompt so the first /chat
      // call still sees it (the UI never re-sends it through /chat).
      toolLog: JSON.stringify([{ role: "user", content: message }]),
      messages: { create: { role: "user", content: message } },
    },
    include: { messages: true },
  });

  // Background provisioning: sandbox spin-up + repo clone, then the opening
  // prompt runs automatically. Never block the response.
  void provisionSandbox(created.id)
    .then(() => runInitialTurn(created.id))
    .catch((error) => console.error("Sandbox provisioning failed", error));
  return res.status(201).json(created);
});

app.get("/api/sessions/:id/messages", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  return res.json(
    await prisma.message.findMany({
      where: { sessionId: found.owner.id },
      orderBy: { createdAt: "asc" },
    }),
  );
});

app.get("/api/sessions/:id", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  // toolLog/lastDiff can be ~100KB each and the UI never reads them here.
  const { toolLog: _toolLog, lastDiff: _lastDiff, ...safe } = found.owner;
  return res.json(safe);
});

app.get("/api/sessions/:id/status", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const sandboxAvailable = await checkSandboxAvailable(found.owner.sandboxId);
  return res.json({
    sandboxStatus: found.owner.sandboxStatus,
    sandboxAvailable,
    sandboxId: found.owner.sandboxId,
    workspacePath: found.owner.workspacePath,
    lastError: found.owner.lastError,
    status: found.owner.status,
    repo: found.owner.project.repo,
    branch: found.owner.branch,
    createdAt: found.owner.createdAt,
  });
});

app.post("/api/sessions/:id/reconnect", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  // The old sandbox (and its PTY) is dead — drop the shared terminal.
  dropPty(found.owner.id);
  if (await checkSandboxAvailable(found.owner.sandboxId)) {
    await prisma.projectSession.update({
      where: { id: found.owner.id },
      data: { sandboxStatus: "ready", lastError: null },
    });
    return res.json({ sandboxStatus: "ready" });
  }
  await prisma.projectSession.update({
    where: { id: found.owner.id },
    data: { sandboxStatus: "creating", status: "running", lastError: null },
  });
  void provisionSandbox(found.owner.id).catch((error) =>
    console.error("Sandbox reconnect failed", error),
  );
  return res.status(202).json({ sandboxStatus: "creating" });
});

app.delete("/api/sessions/:id", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  dropPty(found.owner.id);
  await killSandbox(found.owner.sandboxId);
  await prisma.projectSession.delete({ where: { id: found.owner.id } });
  return res.json({ ok: true });
});

app.post("/api/sessions/:id/kill", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  dropPty(found.owner.id);
  await killSandbox(found.owner.sandboxId);
  await prisma.projectSession.update({
    where: { id: found.owner.id },
    data: {
      sandboxId: "",
      sandboxStatus: "error",
      status: "idle",
      lastError: "Sandbox killed by user. Reconnect to start a new one.",
    },
  });
  return res.json({ ok: true });
});

// Stream-marker helpers: the chat endpoint streams plain-text markdown with
// embedded HTML markers for tool/question/error parts. Payloads are truncated
// so one huge file read can't blow up the live stream or the Message row.
function truncateMarkerText(value: unknown, max: number): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (value === undefined || value === null) {
    text = "";
  } else {
    try {
      text = JSON.stringify(value, null, 2) ?? "";
    } catch {
      text = String(value);
    }
  }
  if (text.length > max) text = `${text.slice(0, max)}\n…[truncated]`;
  return text.replace(/<\/details>/g, "<\\/details>");
}

function truncateMarkerJson(value: unknown, max = 2000): string {
  let text: string;
  try {
    text = JSON.stringify(value ?? {}, null, 2) ?? "{}";
  } catch {
    text = "{}";
  }
  if (text.length > max) text = `${text.slice(0, max)}\n…[truncated]`;
  return text.replace(/<\/details>/g, "<\\/details>");
}

function questionPayload(input: unknown): string {
  let question = "Question";
  let options: string[] = [];
  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    if (typeof rec.question === "string" && rec.question.trim())
      question = rec.question.slice(0, 500);
    if (Array.isArray(rec.options))
      options = rec.options
        .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
        .slice(0, 6)
        .map((o) => o.slice(0, 200));
  }
  return JSON.stringify({ question, options }).replace(/'/g, "&#39;");
}

function toolCallMarker(name: string, input: unknown): string {
  if (name === "ask_user") return `\n\n<div data-question='${questionPayload(input)}'>\n\n`;
  return `\n\n<details data-tool="call"><summary>🛠 ${name}</summary>\n\ninput:\n\n\`\`\`json\n${truncateMarkerJson(input)}\n\`\`\`\n\n`;
}

function toolDoneMarker(name: string, partType: string, output: unknown, error: unknown): string {
  if (name === "ask_user") return `\n</div>\n\n`;
  if (partType === "tool-error")
    return `\nerror:\n\n\`\`\`\n${truncateMarkerText(error, 2000)}\n\`\`\`\n\n</details>\n\n`;
  return `\noutput:\n\n\`\`\`\n${truncateMarkerText(output, 4000)}\n\`\`\`\n\n</details>\n\n`;
}

// Drain one agent turn: stream text deltas as-is, surface tool activity as
// collapsible markers, and always consume the whole stream so the turn
// completes and the full assistant/tool transcript is available to persist.
async function drainAgentStream(
  result: {
    fullStream: AsyncIterable<unknown>;
    response: Promise<{ messages: unknown }>;
    text: Promise<string>;
  },
  sink: (chunk: string) => void,
): Promise<{ messages: ModelMessage[]; text: string }> {
  for await (const part of result.fullStream) {
    const p = part as {
      type?: unknown;
      text?: unknown;
      toolName?: unknown;
      input?: unknown;
      output?: unknown;
      error?: unknown;
    };
    if (p.type === "text-delta") {
      sink(typeof p.text === "string" ? p.text : "");
    } else if (p.type === "tool-call") {
      sink(toolCallMarker(typeof p.toolName === "string" ? p.toolName : "tool", p.input));
    } else if (p.type === "tool-result" || p.type === "tool-error") {
      sink(
        toolDoneMarker(typeof p.toolName === "string" ? p.toolName : "", p.type, p.output, p.error),
      );
    }
  }
  const [response, text] = await Promise.all([result.response, result.text]);
  return { messages: (response.messages ?? []) as ModelMessage[], text };
}

function buildSystemPrompt(
  workspacePath: string,
  repo: string | null,
  branch: string,
  sandboxNote: string,
): string {
  const repoLine = repo ? `Project repo: ${repo}. ` : "";
  const branchLine = branch ? `Active git branch: ${branch}. ` : "";
  return `You are OpenDevin, a concise cloud coding agent working inside an E2B sandbox at ${workspacePath}. ${repoLine}${branchLine}${sandboxNote} Prefer inspecting real files with list_files/read_file before answering, and use run_command for verification. When requirements are ambiguous, call ask_user with 2-4 short options instead of guessing. Keep replies short.`;
}

app.post("/api/sessions/:id/chat", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const owner = found.owner;
  const prompt = typeof req.body.message === "string" ? req.body.message.trim() : "";
  if (!prompt) return res.status(400).json({ error: "A message is required" });
  const { modelId, apiKey } = resolveChatModel();
  if (!apiKey) return res.status(503).json({ error: "OPENROUTER_API_KEY is not configured" });

  // Persist the user's message and mark the turn running before any network
  // work, so a hung sandbox connect can't swallow the prompt.
  await prisma.message.create({ data: { sessionId: owner.id, role: "user", content: prompt } });
  await prisma.projectSession.update({ where: { id: owner.id }, data: { status: "running" } });

  const { tools, sandboxNote } = await connectSandboxTools(
    owner.sandboxId,
    owner.workspacePath || WORKSPACE_PATH,
  );

  // Model history comes from toolLog (user/assistant/tool messages, including
  // prior tool calls so the agent keeps working state across turns). The
  // Message table is only the plain-text timeline for the UI.
  const modelHistory = await loadToolLog(owner.id);
  modelHistory.push({ role: "user", content: prompt });

  let clientGone = false;
  // A disconnected client must not abort the model turn: the completed SDK
  // response is the source of truth that gets persisted below.
  req.on("close", () => {
    if (!res.writableEnded) clientGone = true;
  });
  const result = streamText({
    model: createOpenRouter({ apiKey })(modelId),
    system: buildSystemPrompt(
      owner.workspacePath || WORKSPACE_PATH,
      owner.project.repo,
      owner.branch,
      sandboxNote,
    ),
    messages: modelHistory,
    ...(tools ? { tools, stopWhen: AGENT_STOP } : {}),
  });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  // Lets the UI banner degraded answers (sandbox provisioning/expired) while
  // still streaming general-knowledge text.
  if (!tools) res.setHeader("x-sandbox-degraded", "1");

  try {
    // Accumulate the exact streamed markdown so the persisted Message keeps
    // tool cards after the UI refreshes from the DB.
    let streamed = "";
    const write = (text: string) => {
      streamed += text;
      if (!clientGone) res.write(text);
    };
    const { messages, text } = await drainAgentStream(result, write);
    return finishTurn(res, owner.id, streamed.trim() ? streamed : text, modelHistory, messages);
  } catch (error) {
    console.error("Chat stream failed", error);
    await prisma.projectSession.update({
      where: { id: owner.id },
      data: { status: "failed" },
    });
    if (!res.headersSent) return res.status(500).json({ error: "Agent run failed" });
    const msg =
      error instanceof Error && (error as { statusCode?: number }).statusCode === 402
        ? "Agent unavailable: insufficient credits. Add credits at https://openrouter.ai/settings/credits or check OPENROUTER_API_KEY."
        : "Agent run failed — please retry.";
    try {
      if (!res.writableEnded)
        res.write(
          `\n\n<details data-tool="error"><summary>⚠️ Agent run failed</summary>\n\n${msg}\n\n</details>\n`,
        );
    } catch {}
    // Don't persist the failure text as an assistant message: it would
    // pollute the timeline and the next turn's context. The failed status
    // drives the UI's "Retry last message" path instead.
    return res.end();
  }
});

// Persist a finished agent turn: the assistant text to the timeline, the full
// (text + tool) transcript to toolLog for the next turn, a best-effort diff
// snapshot, and finally reset the session status so it is not left "running".
async function finishTurn(
  res: express.Response,
  sessionId: string,
  replyText: string,
  modelHistory: ModelMessage[],
  toolMessages: ModelMessage[],
) {
  const content = replyText.trim() ? replyText.slice(0, 100_000) : "";
  if (content) {
    try {
      await prisma.message.create({
        data: { sessionId, role: "assistant", content },
      });
    } catch (error) {
      console.error("Could not persist assistant reply", error);
    }
  }
  try {
    // modelHistory already ends with this turn's user prompt; append the
    // assistant + tool messages so later turns keep full working context.
    await saveToolLog(sessionId, trimToolLog([...modelHistory, ...toolMessages]));
  } catch (error) {
    console.error("Could not persist agent tool history", error);
  }
  await snapshotDiffAndIdle(sessionId);
  if (!res.writableEnded) res.end();
}

// Background run for the opening prompt: session creation seeds the user
// message + toolLog but has no HTTP stream to write to, so run the same agent
// turn headless. Skips when the sandbox failed to provision or an assistant
// reply already exists (e.g. user sent a second message first).
async function runInitialTurn(sessionId: string): Promise<void> {
  try {
    const session = await prisma.projectSession.findUnique({
      where: { id: sessionId },
      include: { project: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!session || session.sandboxStatus !== "ready") return;
    if (session.messages.some((m) => m.role === "assistant")) return;
    const { modelId, apiKey } = resolveChatModel();
    if (!apiKey) {
      await prisma.projectSession.update({ where: { id: sessionId }, data: { status: "idle" } });
      return;
    }
    const modelHistory = await loadToolLog(sessionId);
    if (!modelHistory.some((m) => m.role === "user")) return;

    const { tools, sandboxNote } = await connectSandboxTools(
      session.sandboxId,
      session.workspacePath || WORKSPACE_PATH,
    );
    await prisma.projectSession.update({ where: { id: sessionId }, data: { status: "running" } });
    const result = streamText({
      model: createOpenRouter({ apiKey })(modelId),
      system: buildSystemPrompt(
        session.workspacePath || WORKSPACE_PATH,
        session.project.repo,
        session.branch,
        sandboxNote,
      ),
      messages: modelHistory,
      ...(tools ? { tools, stopWhen: AGENT_STOP } : {}),
    });
    let streamed = "";
    try {
      const { messages, text } = await drainAgentStream(result, (chunk) => {
        streamed += chunk;
      });
      const content = streamed.trim() ? streamed.slice(0, 100_000) : text.slice(0, 100_000);
      if (content.trim()) {
        await prisma.message
          .create({ data: { sessionId, role: "assistant", content } })
          .catch((e) => console.error("Could not persist initial reply", e));
      }
      await saveToolLog(sessionId, trimToolLog([...modelHistory, ...messages])).catch((e) =>
        console.error("Could not persist initial tool history", e),
      );
      await snapshotDiffAndIdle(sessionId);
    } catch (error) {
      console.error("Initial agent turn failed", error);
      await prisma.projectSession.update({ where: { id: sessionId }, data: { status: "failed" } });
    }
  } catch (error) {
    console.error("runInitialTurn failed", error);
  }
}

// Every session the user owns, newest first — powers the /s sidebar.
app.get("/api/sessions", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const sessions = await prisma.projectSession.findMany({
    where: { project: { userId: session.user.id } },
    include: { project: { select: { id: true, name: true } } },
    omit: { toolLog: true, lastDiff: true },
    orderBy: { updatedAt: "desc" },
  });
  return res.json(sessions);
});

app.get("/api/sessions/:id/diff", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const persisted = found.owner.lastDiff || "";
  const persistedAt = found.owner.lastDiffAt || null;
  if (!found.owner.sandboxId) {
    if (persisted)
      return res.json({ diff: persisted, truncated: false, persisted: true, persistedAt });
    const reason =
      found.owner.sandboxStatus === "error" && found.owner.lastError
        ? `sandbox failed (${found.owner.lastError}). Reconnect the sandbox and retry.`
        : "sandbox is still provisioning. Retry once it is ready.";
    return res.status(409).json({ error: `Changes unavailable: ${reason}` });
  }
  try {
    const sandbox = await Sandbox.connect(found.owner.sandboxId);
    const { diff, truncated } = await readWorkspaceDiff(
      sandbox,
      found.owner.workspacePath || WORKSPACE_PATH,
    );
    // Snapshot so the tab survives sandbox expiry/refresh.
    void prisma.projectSession
      .update({ where: { id: found.owner.id }, data: { lastDiff: diff, lastDiffAt: new Date() } })
      .catch(() => undefined);
    return res.json({ diff, truncated, persisted: false });
  } catch (error) {
    console.error("Could not read workspace diff", error);
    if (persisted)
      return res.json({ diff: persisted, truncated: false, persisted: true, persistedAt });
    const message = error instanceof Error ? error.message : "unknown error";
    return res.status(503).json({ error: `Changes unavailable: ${message}` });
  }
});

app.get("/api/sessions/:id/preview", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const previewPort = Number(req.query.port || 3000);
  if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65535) {
    return res.status(400).json({ error: "Preview unavailable: port must be 1-65535." });
  }
  const rawPath = typeof req.query.path === "string" && req.query.path ? req.query.path : "/";
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  if (!found.owner.sandboxId) {
    const reason =
      found.owner.sandboxStatus === "error" && found.owner.lastError
        ? `sandbox failed (${found.owner.lastError}). Reconnect the sandbox and retry.`
        : "sandbox is still provisioning. Start the dev server, then retry.";
    return res.status(409).json({ error: `Preview unavailable: ${reason}` });
  }
  try {
    const sandbox = await Sandbox.connect(found.owner.sandboxId);
    const url = `https://${sandbox.getHost(previewPort)}${path}`;
    return res.json({ url, host: sandbox.getHost(previewPort), port: previewPort, path });
  } catch {
    return res.status(503).json({
      error: "Preview unavailable: sandbox is unreachable. Reconnect the sandbox and retry.",
    });
  }
});

const TREE_SKIP_DIRS: Record<string, true> = { ".git": true, node_modules: true };

app.get("/api/sessions/:id/files", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  if (!found.owner.sandboxId) {
    const reason =
      found.owner.sandboxStatus === "error" && found.owner.lastError
        ? `sandbox failed (${found.owner.lastError}). Reconnect the sandbox and retry.`
        : "sandbox is still provisioning. Retry once it is ready.";
    return res.status(409).json({ error: `Files unavailable: ${reason}` });
  }
  try {
    const sandbox = await Sandbox.connect(found.owner.sandboxId);
    const cwd = found.owner.workspacePath || WORKSPACE_PATH;
    const paths: string[] = [];
    const queue: string[] = [""];
    const LIMIT = 5000;
    const DIR_LIMIT = 10_000;
    let truncated = false;
    for (let head = 0; head < queue.length && head < DIR_LIMIT; head++) {
      const dir = queue[head];
      let entries;
      try {
        entries = await sandbox.files.list(dir ? `${cwd}/${dir}` : cwd);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (rel.split("/").some((part) => TREE_SKIP_DIRS[part])) continue;
        if (entry.type === "dir") {
          queue.push(rel);
        } else {
          paths.push(rel);
          if (paths.length >= LIMIT) {
            truncated = true;
            break;
          }
        }
      }
      if (truncated) break;
    }
    if (queue.length > DIR_LIMIT) truncated = true;
    paths.sort();
    return res.json({ paths, truncated });
  } catch (error) {
    console.error("Could not list workspace files", error);
    const message = error instanceof Error ? error.message : "unknown error";
    return res.status(503).json({ error: `Files unavailable: ${message}` });
  }
});

app.get("/api/sessions/:id/file", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const rel = sanitizeRel(req.query.path);
  if (!rel)
    return res
      .status(400)
      .json({ error: "File unavailable: path must be a workspace-relative file." });
  if (!found.owner.sandboxId) {
    return res
      .status(409)
      .json({ error: "File unavailable: sandbox is still provisioning. Retry once it is ready." });
  }
  try {
    const sandbox = await Sandbox.connect(found.owner.sandboxId);
    const cwd = found.owner.workspacePath || WORKSPACE_PATH;
    const content = await sandbox.files.read(`${cwd}/${rel}`);
    const text = typeof content === "string" ? content : "";
    const truncated = text.length > 100_000;
    return res.json({ path: rel, content: text.slice(0, 100_000), truncated });
  } catch (error) {
    console.error("Could not read workspace file", error);
    const message = error instanceof Error ? error.message : "unknown error";
    return res.status(404).json({ error: `File unavailable: ${message.slice(0, 200)}` });
  }
});

function parseGitHubRepo(repo: string): { owner: string; name: string } | null {
  const match = repo.trim().match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return match ? { owner: match[1], name: match[2] } : null;
}

app.post("/api/sessions/:id/publish", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const owner = found.owner;
  const repo = owner.project.repo?.trim() || "";
  const slug = parseGitHubRepo(repo);
  if (!slug)
    return res
      .status(400)
      .json({ error: "Publish unavailable: project repo is not a GitHub https URL." });
  const token = await githubTokenForUser(owner.project.userId);
  if (!token) {
    return res.status(400).json({
      error: "Publish unavailable: no GitHub access token. Sign in with GitHub and retry.",
    });
  }
  const branch = sanitizeBranch(req.body.branch) || `opendevin/session-${owner.id.slice(-8)}`;
  const title =
    typeof req.body.title === "string" && req.body.title.trim()
      ? req.body.title.trim().slice(0, 200)
      : owner.title || "OpenDevin changes";
  const body = typeof req.body.body === "string" ? req.body.body.slice(0, 4000) : "";
  if (!owner.sandboxId) {
    return res.status(409).json({ error: "Publish unavailable: sandbox is still provisioning." });
  }
  try {
    const sandbox = await Sandbox.connect(owner.sandboxId);
    const cwd = owner.workspacePath || WORKSPACE_PATH;
    // runSandbox unwraps non-zero exits into { exitCode, stdout, stderr }
    // instead of throwing, so git failures stay publish errors (4xx), not 503s.
    const run = (command: string) => runSandbox(sandbox, command, cwd, 120_000);
    await run(`git checkout -B ${shellQuote(branch)}`);
    const status = await run("git status --porcelain=v1 -uall");
    if (!status.stdout.trim()) {
      return res.status(400).json({ error: "Nothing to publish: the workspace has no changes." });
    }
    const who = await currentUser(req);
    const name = who?.user.name || "OpenDevin";
    const email = `${(who?.user.email || "opendevin").split("@")[0]}@opendevin.local`;
    const commit = await run(
      `git add -A && git -c ${shellQuote(`user.name=${name}`)} -c ${shellQuote(`user.email=${email}`)} commit -m ${shellQuote(title)}`,
    );
    if (commit.exitCode !== 0) {
      return res.status(409).json({
        error: `Publish failed: ${(commit.stderr || commit.stdout || "git commit failed").slice(0, 500)}`,
      });
    }
    const authedPushUrl = `https://oauth2:${token}@github.com/${slug.owner}/${slug.name}.git`;
    const push = await run(`git push ${shellQuote(authedPushUrl)} HEAD:${shellQuote(branch)}`);
    if (push.exitCode !== 0) {
      return res.status(409).json({
        error: `Publish failed: ${(push.stderr || push.stdout || "git push failed").slice(0, 500)}`,
      });
    }
    // Scrub the token that was embedded in the push URL so it can't linger in
    // the sandbox's git config or process logs.
    await run(
      `git remote set-url origin ${shellQuote(repo)} && git config --unset-all credential.helper`,
    ).then(
      (r) => {
        if (r.exitCode !== 0)
          console.warn("Could not scrub publish token from git config", r.stderr);
      },
      () => undefined,
    );
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    };
    const repoInfo = await fetch(`https://api.github.com/repos/${slug.owner}/${slug.name}`, {
      headers,
    });
    const base = repoInfo.ok
      ? ((await repoInfo.json()) as { default_branch?: string }).default_branch || "main"
      : "main";
    const pr = await fetch(`https://api.github.com/repos/${slug.owner}/${slug.name}/pulls`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title, head: branch, base, body }),
    });
    const prData = (await pr.json().catch(() => ({}))) as { html_url?: string; message?: string };
    if (!pr.ok || !prData.html_url) {
      return res.status(409).json({
        error: `Branch pushed, but the pull request failed: ${(prData.message || "GitHub rejected the PR").slice(0, 500)}`,
      });
    }
    return res.json({ branch, prUrl: prData.html_url });
  } catch (error) {
    console.error("Publish failed", error);
    return res
      .status(503)
      .json({ error: "Publish failed: sandbox is unreachable. Reconnect and retry." });
  }
});

// Keep async route failures (and body-parser errors) as JSON for the client
// instead of Express's default HTML error page.
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled route error", err);
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
  },
);

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Terminal PTY bridge: browser WS <-> shared E2B PTY for the session.
// Message protocol (JSON): client -> {type:"input",data} | {type:"resize",cols,rows};
// server -> {type:"ready",pid} | {type:"replay",data} | {type:"data",data} | {type:"reset"} | {type:"error",error}.
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
        try {
          const entry = await attachPty(
            owner.id,
            owner.sandboxId,
            owner.workspacePath || WORKSPACE_PATH,
            cols,
            rows,
            ws,
          );
          ws.send(JSON.stringify({ type: "ready", pid: entry.pid }));
          const replay = replayPty(owner.id);
          if (replay) ws.send(JSON.stringify({ type: "replay", data: replay }));
        } catch {
          ws.send(
            JSON.stringify({
              error: "Terminal unavailable: the sandbox PTY could not start. Reconnect and retry.",
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
                  owner.id,
                  owner.sandboxId,
                  owner.workspacePath || WORKSPACE_PATH,
                  message.data.slice(0, 16_000),
                );
                if (reset) ws.send(JSON.stringify({ type: "reset" }));
              } else if (message.type === "resize") {
                await resizePty(
                  owner.id,
                  owner.sandboxId,
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
        ws.on("close", () => detachPty(owner.id, ws));
      })().catch(() => ws.close());
    });
  })();
});

server.listen(port, () => console.log(`API listening on http://localhost:${port}`));
