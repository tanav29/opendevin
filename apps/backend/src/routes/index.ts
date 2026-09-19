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
  probePort,
  provisionSandbox,
  projectEnvVars,
  readWorkspaceDiff,
  resolveChatModel,
  runSandbox,
  sanitizeBranch,
  sanitizeRel,
  shellQuote,
  snapshotDiffAndIdle,
  waitForPort,
} from "../sandbox.js";
import { registerSystemRoutes } from "./system.js";

// In-flight agent turns by session. Lets POST /stop abort the model stream
// server-side instead of only dropping the client's fetch.
const activeTurns = new Map<string, AbortController>();

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
  const { repo } = req.body as { repo?: string };
  if (!repo?.trim()) return res.status(400).json({ error: "Repository is required" });
  const project = await prisma.project.create({
    data: { repo: repo.trim(), userId: session.user.id },
  });
  return res.status(201).json(project);
});

app.put("/api/projects/:id", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, userId: session.user.id },
  });
  if (!project) return res.status(404).json({ error: "Project not found" });
  const { setupScript, devCommand, devPort, envVars } = req.body as {
    setupScript?: string;
    devCommand?: string;
    devPort?: number;
    envVars?: Record<string, string>;
  };
  const data: Record<string, unknown> = {};
  if (typeof setupScript === "string") data.setupScript = setupScript.slice(0, 2000);
  if (typeof devCommand === "string") data.devCommand = devCommand.slice(0, 500);
  if (typeof devPort === "number" && Number.isInteger(devPort) && devPort >= 1 && devPort <= 65535)
    data.devPort = devPort;
  if (envVars && typeof envVars === "object" && !Array.isArray(envVars)) {
    const cleanEnvVars = Object.fromEntries(
      Object.entries(envVars)
        .map(([key, value]) => [key.trim().slice(0, 100), String(value).slice(0, 2000)] as const)
        .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
        .slice(0, 50),
    );
    data.envVars = JSON.stringify(cleanEnvVars);
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: "Nothing to update" });
  return res.json(await prisma.project.update({ where: { id: project.id }, data }));
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
    const githubRepo = parseGitHubRepo(repo);
    if (githubRepo) {
      const token = await githubTokenForUser(session.user.id);
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "opendevin",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const apiRepo = `https://api.github.com/repos/${encodeURIComponent(githubRepo.owner)}/${encodeURIComponent(githubRepo.name)}`;
      const repoResponse = await fetch(apiRepo, { headers });
      if (!repoResponse.ok) {
        return res.status(repoResponse.status === 404 ? 404 : 502).json({
          error: `Could not fetch GitHub repository (${repoResponse.status})`,
          branches: [],
          defaultBranch: "",
        });
      }
      const repoData = (await repoResponse.json()) as { default_branch?: string };

      const branches: string[] = [];
      for (let page = 1; ; page += 1) {
        const branchResponse = await fetch(`${apiRepo}/branches?per_page=100&page=${page}`, {
          headers,
        });
        if (!branchResponse.ok) {
          return res.status(502).json({
            error: `Could not fetch GitHub branches (${branchResponse.status})`,
            branches: [],
            defaultBranch: "",
          });
        }
        const pageBranches = (await branchResponse.json()) as Array<{ name?: string }>;
        branches.push(...pageBranches.flatMap((item) => (item.name ? [item.name] : [])));
        if (pageBranches.length < 100) break;
      }

      return res.json({ branches, defaultBranch: repoData.default_branch || branches[0] || "" });
    }

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
      .filter((b): b is string => Boolean(b));
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
  let plan: { title: string; status: string }[] = [];
  try {
    const parsed = JSON.parse(found.owner.plan || "[]") as unknown;
    if (Array.isArray(parsed)) plan = parsed as typeof plan;
  } catch {}
  let usage: Record<string, unknown> = {};
  try {
    usage = (JSON.parse(found.owner.usage || "{}") as Record<string, unknown>) || {};
  } catch {}
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
    model: resolveChatModel().modelId,
    plan,
    usage,
    devCommand: found.owner.project.devCommand ?? "",
    devPort: found.owner.project.devPort ?? 3000,
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

// Stream-marker helpers: the chat endpoint streams compact HTML markers for
// tool/question/error parts. Tool payloads and results stay server-side.

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

function planPayload(input: unknown): string {
  let tasks: { title: string; status: string }[] = [];
  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    if (Array.isArray(rec.tasks)) {
      tasks = rec.tasks
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
        .map((t) => ({
          title: typeof t.title === "string" ? t.title.slice(0, 200) : "",
          status: t.status === "done" || t.status === "in_progress" ? String(t.status) : "pending",
        }))
        .filter((t) => t.title)
        .slice(0, 12);
    }
  }
  return JSON.stringify(tasks).replace(/'/g, "&#39;");
}

function escapeMarkerAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toolArgument(name: string, input: unknown): string {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const preferredKey: Record<string, string> = {
    list_files: "path",
    read_file: "path",
    run_command: "command",
    write_file: "path",
    edit_file: "path",
    delete_file: "path",
    search: "pattern",
    ask_user: "question",
  };
  const preferred = record[preferredKey[name]];
  const fallback = Object.values(record).find((value) => typeof value === "string");
  const value =
    typeof preferred === "string" ? preferred : typeof fallback === "string" ? fallback : "";
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}

function toolCallMarker(name: string, input: unknown): string {
  if (name === "ask_user") return `\n\n<div data-question='${questionPayload(input)}'>\n\n`;
  if (name === "update_plan") return `\n\n<div data-plan='${planPayload(input)}'>\n\n`;
  const argument = escapeMarkerAttribute(toolArgument(name, input));
  return `\n\n<details data-tool="call" data-arg="${argument}"><summary>${name}</summary>\n\n`;
}

function toolDoneMarker(name: string, partType: string, output: unknown): string {
  if (name === "ask_user" || name === "update_plan") return `\n</div>\n\n`;
  if (partType === "tool-error") return `\n<div data-tool-status="failed"></div>\n\n</details>\n\n`;
  if (typeof output === "string" && output.startsWith("__PLAN__")) {
    const raw = output.slice("__PLAN__".length).replace(/'/g, "&#39;");
    return `\n<div data-plan='${raw}'>\n\n</div>\n\n`;
  }
  return `\n</details>\n\n`;
}

// Drain one agent turn: stream text deltas as-is, surface tool activity as
// collapsible markers, and always consume the whole stream so the turn
// completes and the full assistant/tool transcript is available to persist.
async function drainAgentStream(
  result: {
    fullStream: AsyncIterable<unknown>;
    response: Promise<{ messages: unknown }>;
    text: Promise<string>;
    usage?: Promise<
      { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined
    >;
  },
  sink: (chunk: string) => void,
  onPlan?: (tasksJson: string) => void,
): Promise<{
  messages: ModelMessage[];
  text: string;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
}> {
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
      const name = typeof p.toolName === "string" ? p.toolName : "";
      sink(toolDoneMarker(name, p.type, p.output));
      if (
        name === "update_plan" &&
        typeof p.output === "string" &&
        p.output.startsWith("__PLAN__")
      ) {
        try {
          onPlan?.(p.output.slice("__PLAN__".length));
        } catch {}
      }
    }
  }
  const [response, text, usage] = await Promise.all([
    result.response,
    result.text,
    result.usage?.catch(() => undefined),
  ]);
  return { messages: (response.messages ?? []) as ModelMessage[], text, usage };
}

function buildSystemPrompt(
  workspacePath: string,
  repo: string | null,
  branch: string,
  sandboxNote: string,
): string {
  const repoLine = repo ? `Project repo: ${repo}. ` : "";
  const branchLine = branch ? `Active git branch: ${branch}. ` : "";
  return `You are OpenDevin, a concise cloud coding agent working inside an E2B sandbox at ${workspacePath}. ${repoLine}${branchLine}${sandboxNote} Workflow: for non-trivial tasks first call update_plan with 2-8 steps, then work the plan (search/read before edit, edit_file for patches, run_command to verify tests/build). Prefer inspecting real files with list_files/read_file/search before answering. When requirements are ambiguous, call ask_user with 2-4 short options instead of guessing. Keep replies short.`;
}

app.post("/api/sessions/:id/chat", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const owner = found.owner;
  const prompt = typeof req.body.message === "string" ? req.body.message.trim() : "";
  if (!prompt) return res.status(400).json({ error: "A message is required" });
  const content = prompt.slice(0, 20_000);
  const { modelId, apiKey } = resolveChatModel();
  if (!apiKey) return res.status(503).json({ error: "OPENROUTER_API_KEY is not configured" });
  if (activeTurns.has(owner.id))
    return res.status(409).json({ error: "Agent is already running. Stop it first." });

  // Persist the user's message and mark the turn running before any network
  // work, so a hung sandbox connect can't swallow the prompt.
  await prisma.message.create({ data: { sessionId: owner.id, role: "user", content } });
  await prisma.projectSession.update({
    where: { id: owner.id },
    data: { status: "running", model: modelId },
  });

  const { tools, sandboxNote } = await connectSandboxTools(
    owner.sandboxId,
    owner.workspacePath || WORKSPACE_PATH,
  );
  // A session with a sandbox id must never silently fall back to a text-only
  // model response: that makes tool calls look like ordinary assistant text.
  // Ask the user to reconnect so a fresh sandbox can be provisioned instead.
  if (!tools && owner.sandboxId) {
    const error = "Workspace sandbox is unavailable. Reconnect the sandbox, then retry.";
    await prisma.projectSession.update({
      where: { id: owner.id },
      data: { status: "failed", sandboxStatus: "error", lastError: error },
    });
    return res.status(503).json({ error });
  }

  // Model history comes from toolLog (user/assistant/tool messages, including
  // prior tool calls so the agent keeps working state across turns). The
  // Message table is only the plain-text timeline for the UI.
  const modelHistory = await loadToolLog(owner.id);
  modelHistory.push({ role: "user", content });

  let clientGone = false;
  // A disconnected client must not abort the model turn: the completed SDK
  // response is the source of truth that gets persisted below. Only an
  // explicit POST /stop aborts via activeTurns.
  req.on("close", () => {
    if (!res.writableEnded) clientGone = true;
  });
  const controller = new AbortController();
  activeTurns.set(owner.id, controller);
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
    abortSignal: controller.signal,
  });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("x-model", modelId);
  // Lets the UI banner degraded answers (sandbox provisioning/expired) while
  // still streaming general-knowledge text.
  if (!tools) res.setHeader("x-sandbox-degraded", "1");

  try {
    // Accumulate the exact streamed markdown so the persisted Message keeps
    // tool cards after the UI refreshes from the DB.
    let streamed = "";
    let latestPlan: string | null = null;
    const write = (text: string) => {
      streamed += text;
      if (!clientGone) res.write(text);
    };
    const { messages, text, usage } = await drainAgentStream(result, write, (planJson) => {
      latestPlan = planJson;
    });
    return finishTurn(
      res,
      owner.id,
      streamed.trim() ? streamed : text,
      modelHistory,
      messages,
      latestPlan,
      usage,
    );
  } catch (error) {
    const aborted =
      (error as { name?: string })?.name === "AbortError" ||
      !activeTurns.has(owner.id) ||
      controller.signal.aborted;
    console.error("Chat stream failed", error);
    await prisma.projectSession.update({
      where: { id: owner.id },
      data: { status: aborted ? "idle" : "failed" },
    });
    if (!res.headersSent) return res.status(500).json({ error: "Agent run failed" });
    const msg = aborted
      ? "Agent stopped."
      : error instanceof Error && (error as { statusCode?: number }).statusCode === 402
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
  } finally {
    if (activeTurns.get(owner.id) === controller) activeTurns.delete(owner.id);
  }
});

app.post("/api/sessions/:id/stop", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const controller = activeTurns.get(found.owner.id);
  if (controller) {
    controller.abort();
    activeTurns.delete(found.owner.id);
  }
  await prisma.projectSession.update({
    where: { id: found.owner.id },
    data: { status: "idle" },
  });
  return res.json({ ok: true, stopped: Boolean(controller) });
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
  planJson: string | null = null,
  usage:
    | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    | undefined = undefined,
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
  try {
    const data: Record<string, unknown> = {};
    if (planJson) {
      try {
        const parsed = JSON.parse(planJson) as unknown;
        if (Array.isArray(parsed)) data.plan = JSON.stringify(parsed).slice(0, 5000);
      } catch {}
    }
    if (usage && (usage.inputTokens || usage.outputTokens || usage.totalTokens)) {
      data.usage = JSON.stringify({
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
        at: new Date().toISOString(),
      }).slice(0, 500);
    }
    if (Object.keys(data).length > 0) {
      await prisma.projectSession.update({ where: { id: sessionId }, data });
    }
  } catch (error) {
    console.error("Could not persist plan/usage", error);
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
    if (!tools && session.sandboxId) {
      await prisma.projectSession.update({
        where: { id: sessionId },
        data: {
          status: "failed",
          sandboxStatus: "error",
          lastError: "Workspace sandbox is unavailable. Reconnect the sandbox, then retry.",
        },
      });
      return;
    }
    await prisma.projectSession.update({ where: { id: sessionId }, data: { status: "running" } });
    const controller = new AbortController();
    activeTurns.set(sessionId, controller);
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
      abortSignal: controller.signal,
    });
    let streamed = "";
    try {
      let latestPlan: string | null = null;
      const { messages, text, usage } = await drainAgentStream(
        result,
        (chunk) => {
          streamed += chunk;
        },
        (planJson) => {
          latestPlan = planJson;
        },
      );
      const content = streamed.trim() ? streamed.slice(0, 100_000) : text.slice(0, 100_000);
      if (content.trim()) {
        await prisma.message
          .create({ data: { sessionId, role: "assistant", content } })
          .catch((e) => console.error("Could not persist initial reply", e));
      }
      await saveToolLog(sessionId, trimToolLog([...modelHistory, ...messages])).catch((e) =>
        console.error("Could not persist initial tool history", e),
      );
      try {
        const data: Record<string, unknown> = {};
        if (latestPlan) {
          try {
            const parsed = JSON.parse(latestPlan) as unknown;
            if (Array.isArray(parsed)) data.plan = JSON.stringify(parsed).slice(0, 5000);
          } catch {}
        }
        if (usage && (usage.inputTokens || usage.outputTokens || usage.totalTokens)) {
          data.usage = JSON.stringify({
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
            at: new Date().toISOString(),
          }).slice(0, 500);
        }
        if (Object.keys(data).length > 0) {
          await prisma.projectSession.update({ where: { id: sessionId }, data });
        }
      } catch (e) {
        console.error("Could not persist initial plan/usage", e);
      }
      await snapshotDiffAndIdle(sessionId);
    } catch (error) {
      console.error("Initial agent turn failed", error);
      await prisma.projectSession.update({ where: { id: sessionId }, data: { status: "failed" } });
    } finally {
      if (activeTurns.get(sessionId) === controller) activeTurns.delete(sessionId);
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
    include: { project: { select: { id: true, repo: true } } },
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
  const rawPort = req.query.port;
  const previewPort =
    rawPort === undefined || rawPort === ""
      ? (found.owner.project.devPort ?? 3000)
      : Number(rawPort);
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
    const host = sandbox.getHost(previewPort);
    const url = `https://${host}${path}`;
    // Never hand out a dead URL: the e2b.app host exists for every port, but
    // the site only loads when a server inside the sandbox serves this one.
    const { listening } = await probePort(sandbox, previewPort);
    if (!listening) {
      return res.status(409).json({
        error: `Preview unavailable: nothing is listening on port ${previewPort} in the sandbox. Start the dev server (Auto-start), then retry.`,
        url,
        host,
        port: previewPort,
        path,
        listening: false,
      });
    }
    return res.json({ url, host, port: previewPort, path, listening: true });
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

app.put("/api/sessions/:id/file", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const rel = sanitizeRel(req.body.path ?? req.query.path);
  const content = typeof req.body.content === "string" ? req.body.content : null;
  if (!rel) return res.status(400).json({ error: "path must be workspace-relative." });
  if (content === null) return res.status(400).json({ error: "content is required." });
  if (content.length > 200_000)
    return res.status(413).json({ error: "Content too large: max 200,000 chars." });
  if (!found.owner.sandboxId) return res.status(409).json({ error: "Sandbox not ready." });
  try {
    const sandbox = await Sandbox.connect(found.owner.sandboxId);
    const cwd = found.owner.workspacePath || WORKSPACE_PATH;
    await sandbox.files.write(`${cwd}/${rel}`, content);
    return res.json({ ok: true, path: rel, chars: content.length });
  } catch (error) {
    console.error("Could not write workspace file", error);
    return res.status(503).json({ error: "Write failed: sandbox unreachable." });
  }
});

app.post("/api/sessions/:id/revert", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const rel = sanitizeRel(req.body.path);
  if (rel === null || rel === "")
    return res.status(400).json({ error: "path must be a workspace-relative file." });
  if (!found.owner.sandboxId) return res.status(409).json({ error: "Sandbox not ready." });
  try {
    const sandbox = await Sandbox.connect(found.owner.sandboxId);
    const cwd = found.owner.workspacePath || WORKSPACE_PATH;
    const run = (command: string) => runSandbox(sandbox, command, cwd, 30_000);
    // Tracked: restore from HEAD. Untracked: delete.
    const checkout = await run(`git checkout -- ${shellQuote(rel)}`);
    const clean = await run(`git clean -f -- ${shellQuote(rel)}`);
    if (checkout.exitCode === 0 || clean.exitCode === 0) {
      void prisma.projectSession
        .update({ where: { id: found.owner.id }, data: { lastDiff: "", lastDiffAt: null } })
        .catch(() => undefined);
      return res.json({ ok: true, path: rel });
    }
    return res.status(409).json({
      error: `Revert failed: ${(checkout.stderr || clean.stderr || "git error").slice(0, 300)}`,
    });
  } catch (error) {
    console.error("Revert failed", error);
    return res.status(503).json({ error: "Revert failed: sandbox unreachable." });
  }
});

app.post("/api/sessions/:id/devserver", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  if (!found.owner.sandboxId) return res.status(409).json({ error: "Sandbox not ready." });
  try {
    const sandbox = await Sandbox.connect(found.owner.sandboxId);
    const cwd = found.owner.workspacePath || WORKSPACE_PATH;
    const project = found.owner.project as unknown as {
      devCommand?: string;
      devPort?: number;
      envVars?: string;
    };
    let command = typeof req.body.command === "string" ? req.body.command.trim().slice(0, 500) : "";
    const rawPort = req.body.port;
    const parsedPort =
      typeof rawPort === "number"
        ? rawPort
        : typeof rawPort === "string" && rawPort.trim()
          ? Number(rawPort)
          : NaN;
    const port =
      Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
        ? parsedPort
        : (project.devPort ?? 3000);
    if (!command) command = (project.devCommand || "").trim();
    if (!command) {
      // Auto-detect from package.json scripts.
      try {
        const raw = await sandbox.files.read(`${cwd}/package.json`);
        const pkg = JSON.parse(typeof raw === "string" ? raw : "{}") as {
          scripts?: Record<string, string>;
        };
        const scripts = pkg.scripts || {};
        if (scripts.dev) command = `npm run dev -- --port ${port} --hostname 0.0.0.0`;
        else if (scripts.start) command = `npm run start -- --port ${port} --hostname 0.0.0.0`;
        else command = `python3 -m http.server ${port} --bind 0.0.0.0`;
      } catch {
        command = `python3 -m http.server ${port} --bind 0.0.0.0`;
      }
    } else if (/^python3 -m http\.server\b/.test(command) && !command.includes("--bind")) {
      command = command.replace(
        /^python3 -m http\.server\b/,
        "python3 -m http.server --bind 0.0.0.0",
      );
    }
    const log = "/tmp/opendevin-dev.log";
    const envs = {
      PORT: String(port),
      HOST: "0.0.0.0",
      HOSTNAME: "0.0.0.0",
      ...projectEnvVars(project.envVars),
    };
    // Best-effort: free the port so a stale server doesn't shadow the new one.
    await runSandbox(sandbox, `fuser -k ${port}/tcp 2>/dev/null || true`, cwd, 10_000).catch(
      () => undefined,
    );
    const start = await runSandbox(
      sandbox,
      `nohup sh -c ${shellQuote(`${command} > ${log} 2>&1`)} > /dev/null 2>&1 & echo $!`,
      cwd,
      30_000,
      envs,
    );
    // Don't return a URL that doesn't serve yet: wait until the port answers.
    const ready = await waitForPort(sandbox, port);
    const tail = await runSandbox(sandbox, `tail -n 30 ${log}`, cwd, 10_000).catch(() => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));
    const url = `https://${sandbox.getHost(port)}/`;
    const logTail = `pid ${start.stdout.trim()}\n${tail.stdout}`.slice(0, 2000);
    if (!ready.listening) {
      return res.status(502).json({
        error: `Dev server did not open port ${port}. Fix the command and retry (log: cat ${log} in the terminal).`,
        command,
        port,
        url,
        listening: false,
        log: logTail,
      });
    }
    return res.json({ ok: true, command, port, url, listening: true, log: logTail });
  } catch (error) {
    console.error("Dev server start failed", error);
    return res.status(503).json({ error: "Could not start dev server: sandbox unreachable." });
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
