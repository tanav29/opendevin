import "dotenv/config";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { Sandbox } from "e2b";
import { WebSocketServer } from "ws";
import { auth } from "./auth/auth.js";
import { prisma } from "./db/prisma.js";
import { attachPty, detachPty, dropPty, replayPty, resizePty, writePty } from "./pty.js";
import {
  AGENT_STOP,
  WORKSPACE_PATH,
  checkSandboxAvailable,
  githubTokenForUser,
  isRepoUrl,
  provisionSandbox,
  sandboxTools,
  sanitizeBranch,
  shellQuote,
} from "./sandbox.js";

const app = express();
const port = Number(process.env.PORT || 3001);

async function currentUser(req: express.Request) {
  return auth.api.getSession({ headers: req.headers as HeadersInit });
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
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

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
    const { stdout } = await execFileAsync("git", ["ls-remote", "--heads", repo], {
      timeout: 15000,
    });
    const branches = stdout
      .split("\n")
      .map((line) => line.split("\t")[1]?.replace("refs/heads/", "").trim())
      .filter((b): b is string => Boolean(b))
      .slice(0, 200);
    // ls-remote does not tell us the default branch; guess common names first.
    const defaultBranch = branches.includes("main")
      ? "main"
      : branches.includes("master")
        ? "master"
        : branches[0] || "";
    return res.json({ branches, defaultBranch });
  } catch (error) {
    console.error("List branches failed", error);
    return res.json({ branches: [], defaultBranch: "" });
  }
});

// Cursor-like: creating a session immediately returns a record, then a cloud
// sandbox spins up in the background and clones the project's repo on the
// requested branch (empty = repo default branch).
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
      messages: { create: { role: "user", content: message } },
    },
    include: { messages: true },
  });

  // Background provisioning: sandbox spin-up + repo clone. Never block the response.
  void provisionSandbox(created.id).catch((error) =>
    console.error("Sandbox provisioning failed", error),
  );
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
  return found.owner ? res.json(found.owner) : res.status(404).json({ error: "Session not found" });
});

app.get("/api/sessions/:id/status", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const sandboxAvailable = await checkSandboxAvailable(found.owner.sandboxId);
  return res.json({
    sandboxStatus:
      sandboxAvailable && found.owner.sandboxStatus === "ready"
        ? "ready"
        : found.owner.sandboxStatus,
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

app.post("/api/sessions/:id/chat", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const owner = found.owner;
  const prompt = typeof req.body.message === "string" ? req.body.message.trim() : "";
  if (!prompt) return res.status(400).json({ error: "A message is required" });
  if (!process.env.OPENAI_API_KEY)
    return res.status(503).json({ error: "OPENAI_API_KEY is not configured" });

  await prisma.message.create({ data: { sessionId: owner.id, role: "user", content: prompt } });
  await prisma.projectSession.update({ where: { id: owner.id }, data: { status: "running" } });
  const history = await prisma.message.findMany({
    where: { sessionId: owner.id },
    orderBy: { createdAt: "asc" },
  });

  // Attach sandbox tools when the workspace sandbox is reachable.
  let tools: ReturnType<typeof sandboxTools> | undefined;
  let sandboxNote = "";
  try {
    if (owner.sandboxId) {
      const sandbox = await Sandbox.connect(owner.sandboxId);
      tools = sandboxTools(sandbox, owner.workspacePath || WORKSPACE_PATH);
    } else {
      sandboxNote =
        "The cloud sandbox is still provisioning (repo clone pending). Answer from general knowledge and ask the user to retry once it is ready.";
    }
  } catch {
    sandboxNote =
      "The cloud sandbox is currently unreachable. Answer from general knowledge and suggest reconnecting the sandbox.";
  }

  const repoLine = owner.project.repo ? `Project repo: ${owner.project.repo}. ` : "";
  const branchLine = owner.branch ? `Active git branch: ${owner.branch}. ` : "";
  let clientGone = false;
  req.on("close", () => {
    if (!res.writableEnded) clientGone = true;
  });
  const result = streamText({
    model: openai(process.env.OPENAI_MODEL || "gpt-4o-mini"),
    system: `You are OpenDevin, a concise cloud coding agent working inside an E2B sandbox at ${owner.workspacePath || WORKSPACE_PATH}. ${repoLine}${branchLine}${sandboxNote} Prefer inspecting real files with list_files/read_file before answering, and use run_command for verification. Keep replies short.`,
    messages: history.map(({ role, content }) => ({ role: role as "user" | "assistant", content })),
    ...(tools ? { tools, stopWhen: AGENT_STOP } : {}),
    onFinish: async ({ text }) => {
      await prisma.message.create({
        data: { sessionId: owner.id, role: "assistant", content: text },
      });
      // Best-effort: snapshot the workspace diff so Changes survives sandbox expiry.
      try {
        if (owner.sandboxId) {
          const sandbox = await Sandbox.connect(owner.sandboxId);
          const cwd = owner.workspacePath || WORKSPACE_PATH;
          const diffOut = await sandbox.commands.run(
            `git -C ${shellQuote(cwd)} diff HEAD --no-color`,
            { timeoutMs: 30_000 },
          );
          if (diffOut.exitCode === 0) {
            await prisma.projectSession.update({
              where: { id: owner.id },
              data: {
                lastDiff: (diffOut.stdout || "").slice(0, 100_000),
                lastDiffAt: new Date(),
                status: clientGone ? "idle" : "idle",
              },
            });
          } else {
            await prisma.projectSession.update({
              where: { id: owner.id },
              data: { status: "idle" },
            });
          }
        } else {
          await prisma.projectSession.update({ where: { id: owner.id }, data: { status: "idle" } });
        }
      } catch {
        await prisma.projectSession.update({
          where: { id: owner.id },
          data: { status: clientGone ? "idle" : "idle" },
        });
      }
    },
  });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  try {
    // Stream text deltas as-is; surface tool activity as collapsible markers
    // the frontend renders (persisted transcript keeps text only).
    for await (const part of result.fullStream) {
      if (clientGone) break;
      if (part.type === "text-delta") {
        res.write((part as { text?: string }).text ?? "");
      } else if (part.type === "tool-call") {
        const name = (part as { toolName?: string }).toolName || "tool";
        res.write(`\n\n<details data-tool="call"><summary>🛠 ${name}</summary>\n\n`);
      } else if (part.type === "tool-result") {
        res.write(`\n</details>\n\n`);
      }
    }
    return res.end();
  } catch (error) {
    console.error("Chat stream failed", error);
    await prisma.projectSession.update({
      where: { id: owner.id },
      data: { status: clientGone ? "idle" : "failed" },
    });
    if (!res.headersSent) return res.status(500).json({ error: "Agent run failed" });
    return res.end();
  }
});

// Every session the user owns, newest first — powers the /s sidebar.
app.get("/api/sessions", async (req, res) => {
  const session = await currentUser(req);
  if (!session) return res.status(401).json({ error: "Sign in required" });
  const sessions = await prisma.projectSession.findMany({
    where: { project: { userId: session.user.id } },
    include: { project: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return res.json(sessions);
});

app.get("/api/sessions/:id/diff", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const persisted = found.owner.lastDiff || "";
  const persistedAt = (found.owner as { lastDiffAt?: Date | null }).lastDiffAt || null;
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
    const cwd = found.owner.workspacePath || WORKSPACE_PATH;
    const result = await sandbox.commands.run(`git -C ${shellQuote(cwd)} diff HEAD --no-color`, {
      timeoutMs: 30_000,
    });
    if (result.exitCode !== 0) {
      if (persisted)
        return res.json({ diff: persisted, truncated: false, persisted: true, persistedAt });
      return res.status(409).json({
        error: `Changes unavailable: ${(result.stderr || result.stdout || "git diff failed").slice(0, 500)}`,
      });
    }
    const output = result.stdout || "";
    const truncated = output.length > 100_000;
    const diff = output.slice(0, 100_000);
    // Snapshot so the tab survives sandbox expiry/refresh.
    void prisma.projectSession
      .update({ where: { id: found.owner.id }, data: { lastDiff: diff, lastDiffAt: new Date() } })
      .catch(() => undefined);
    return res.json({ diff, truncated, persisted: false });
  } catch {
    if (persisted)
      return res.json({ diff: persisted, truncated: false, persisted: true, persistedAt });
    return res
      .status(503)
      .json({
        error: "Changes unavailable: sandbox is unreachable. Reconnect the sandbox and retry.",
      });
  }
});

app.get("/api/sessions/:id/preview", async (req, res) => {
  const found = await ownedSession(req, req.params.id);
  if (!found.auth) return res.status(401).json({ error: "Sign in required" });
  if (!found.owner) return res.status(404).json({ error: "Session not found" });
  const port = Number(req.query.port || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
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
    const url = `https://${sandbox.getHost(port)}${path}`;
    return res.json({ url, host: sandbox.getHost(port), port, path });
  } catch {
    return res
      .status(503)
      .json({
        error: "Preview unavailable: sandbox is unreachable. Reconnect the sandbox and retry.",
      });
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
    return res
      .status(400)
      .json({
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
  const headerArg = `-c ${shellQuote(`http.extraHeader=AUTHORIZATION: bearer ${token}`)}`;
  try {
    const sandbox = await Sandbox.connect(owner.sandboxId);
    const cwd = owner.workspacePath || WORKSPACE_PATH;
    const run = (command: string) => sandbox.commands.run(command, { cwd, timeoutMs: 120_000 });
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
      return res
        .status(409)
        .json({
          error: `Publish failed: ${(commit.stderr || commit.stdout || "git commit failed").slice(0, 500)}`,
        });
    }
    const push = await run(`git ${headerArg} push -u origin ${shellQuote(branch)}`);
    if (push.exitCode !== 0) {
      return res
        .status(409)
        .json({
          error: `Publish failed: ${(push.stderr || push.stdout || "git push failed").slice(0, 500)}`,
        });
    }
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
      return res
        .status(409)
        .json({
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

app.get("/", (_req, res) => res.json({ name: "OpenDevin API", ok: true }));

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
    let owner;
    try {
      const session = await auth.api.getSession({ headers: req.headers as unknown as Headers });
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
