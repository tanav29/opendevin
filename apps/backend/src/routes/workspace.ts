import { Sandbox } from "e2b";
import type { Express } from "express";
import { prisma } from "../db/prisma.js";
import { WORKSPACE_PATH } from "../config.js";
import { LIMITS } from "../config.js";
import { githubIdentityForToken, githubTokenForUser } from "../github.js";
import {
  asyncRoute,
  currentUser,
  ownedSession,
  sandboxNotReadyReason,
  routeParam,
} from "../http.js";
import {
  parseGitHubRepo,
  projectEnvVars,
  sanitizeBranch,
  sanitizeRel,
  shellQuote,
} from "../sanitize.js";
import { probePort, runSandbox, waitForPort } from "../sandbox.js";
import { listWorkspaceTree, readWorkspaceDiff } from "../workspace.js";

export function registerWorkspaceRoutes(app: Express): void {
  app.get(
    "/api/sessions/:id/diff",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      const persisted = found.owner.lastDiff || "";
      const persistedAt = found.owner.lastDiffAt || null;
      if (!found.owner.sandboxId) {
        if (persisted)
          return res.json({ diff: persisted, truncated: false, persisted: true, persistedAt });
        const reason = sandboxNotReadyReason(found.owner.sandboxStatus, found.owner.lastError);
        return res.status(409).json({ error: `Changes unavailable: ${reason}` });
      }
      try {
        const sandbox = await Sandbox.connect(found.owner.sandboxId);
        const { diff, truncated } = await readWorkspaceDiff(
          sandbox,
          found.owner.workspacePath || WORKSPACE_PATH,
        );
        if (diff) {
          void prisma.projectSession
            .update({
              where: { id: found.owner.id },
              data: { lastDiff: diff, lastDiffAt: new Date() },
            })
            .catch(() => undefined);
          return res.json({ diff, truncated, persisted: false });
        }
        if (persisted)
          return res.json({ diff: persisted, truncated: false, persisted: true, persistedAt });
        return res.json({ diff: "", truncated: false, persisted: false });
      } catch (error) {
        console.error("Could not read workspace diff", error);
        if (persisted)
          return res.json({ diff: persisted, truncated: false, persisted: true, persistedAt });
        const message = error instanceof Error ? error.message : "unknown error";
        return res.status(503).json({ error: `Changes unavailable: ${message}` });
      }
    }),
  );

  app.get(
    "/api/sessions/:id/preview",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
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
    }),
  );

  app.get(
    "/api/sessions/:id/files",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      if (!found.owner.sandboxId) {
        const reason = sandboxNotReadyReason(found.owner.sandboxStatus, found.owner.lastError);
        return res.status(409).json({ error: `Files unavailable: ${reason}` });
      }
      try {
        const sandbox = await Sandbox.connect(found.owner.sandboxId);
        const cwd = found.owner.workspacePath || WORKSPACE_PATH;
        const { paths, truncated } = await listWorkspaceTree(sandbox, cwd);
        return res.json({ paths, truncated });
      } catch (error) {
        console.error("Could not list workspace files", error);
        const message = error instanceof Error ? error.message : "unknown error";
        return res.status(503).json({ error: `Files unavailable: ${message}` });
      }
    }),
  );

  app.get(
    "/api/sessions/:id/file",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      const rel = sanitizeRel(req.query.path);
      if (!rel)
        return res
          .status(400)
          .json({ error: "File unavailable: path must be a workspace-relative file." });
      if (!found.owner.sandboxId) {
        return res.status(409).json({
          error: "File unavailable: sandbox is still provisioning. Retry once it is ready.",
        });
      }
      try {
        const sandbox = await Sandbox.connect(found.owner.sandboxId);
        const cwd = found.owner.workspacePath || WORKSPACE_PATH;
        const content = await sandbox.files.read(`${cwd}/${rel}`);
        const text = typeof content === "string" ? content : "";
        const truncated = text.length > LIMITS.fileReadChars;
        return res.json({ path: rel, content: text.slice(0, LIMITS.fileReadChars), truncated });
      } catch (error) {
        console.error("Could not read workspace file", error);
        const message = error instanceof Error ? error.message : "unknown error";
        return res.status(404).json({ error: `File unavailable: ${message.slice(0, 200)}` });
      }
    }),
  );

  app.put(
    "/api/sessions/:id/file",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      const rel = sanitizeRel(req.body.path ?? req.query.path);
      const content = typeof req.body.content === "string" ? req.body.content : null;
      if (!rel) return res.status(400).json({ error: "path must be workspace-relative." });
      if (content === null) return res.status(400).json({ error: "content is required." });
      if (content.length > LIMITS.fileWriteChars)
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
    }),
  );

  app.post(
    "/api/sessions/:id/revert",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
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
    }),
  );

  app.post(
    "/api/sessions/:id/devserver",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
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
        let command =
          typeof req.body.command === "string" ? req.body.command.trim().slice(0, 500) : "";
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
    }),
  );

  app.post(
    "/api/sessions/:id/commit",
    asyncRoute(async (req, res) => {
      const found = await ownedSession(req, routeParam(req, "id"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.owner) return res.status(404).json({ error: "Session not found" });
      const owner = found.owner;
      const repo = owner.project.repo?.trim() || "";
      const slug = parseGitHubRepo(repo);
      if (!slug)
        return res
          .status(400)
          .json({ error: "Commit unavailable: project repo is not a GitHub https URL." });
      const token = await githubTokenForUser(owner.project.userId);
      if (!token) {
        return res.status(400).json({
          error: "Commit unavailable: no GitHub access token. Sign in with GitHub and retry.",
        });
      }
      const message =
        typeof req.body.message === "string" ? req.body.message.trim().slice(0, 500) : "";
      if (!owner.sandboxId) {
        return res
          .status(409)
          .json({ error: "Commit unavailable: sandbox is still provisioning." });
      }
      try {
        const sandbox = await Sandbox.connect(owner.sandboxId);
        const cwd = owner.workspacePath || WORKSPACE_PATH;
        const run = (command: string) => runSandbox(sandbox, command, cwd, 120_000);
        const sessionBranch = sanitizeBranch(owner.branch);
        let branch = sessionBranch;
        if (branch) {
          await run(`git checkout -B ${shellQuote(branch)}`);
        } else {
          const current = await run("git rev-parse --abbrev-ref HEAD");
          branch = sanitizeBranch((current.stdout || "").trim()) || "HEAD";
        }
        const authedPushUrl = `https://oauth2:${token}@github.com/${slug.owner}/${slug.name}.git`;
        const status = await run("git status --porcelain=v1 -uall");
        const treeDirty = !!status.stdout.trim();
        const headOut = await run("git rev-parse HEAD");
        const localSha = headOut.exitCode === 0 ? headOut.stdout.trim().split(/\s+/)[0] || "" : "";
        let remoteSha = "";
        if (localSha) {
          const ls = await run(
            `git ls-remote ${shellQuote(authedPushUrl)} ${shellQuote(`refs/heads/${branch}`)}`,
          );
          if (ls.exitCode === 0) remoteSha = ls.stdout.trim().split(/\s+/)[0] || "";
        }
        const unpushed = !!localSha && localSha !== remoteSha;
        if (!treeDirty && !unpushed) {
          return res
            .status(400)
            .json({ error: "Nothing to commit: the workspace has no changes." });
        }
        const who = await currentUser(req);
        const gh = await githubIdentityForToken(token);
        const name = gh?.name || gh?.login || who?.user.name || "OpenDevin";
        const email =
          gh?.email || who?.user.email || `${gh?.login || "opendevin"}@users.noreply.github.com`;
        if (treeDirty) {
          if (!message) return res.status(400).json({ error: "A commit message is required." });
          const commit = await run(
            `git add -A && git -c ${shellQuote(`user.name=${name}`)} -c ${shellQuote(`user.email=${email}`)} commit -m ${shellQuote(message)}`,
          );
          if (commit.exitCode !== 0) {
            return res.status(409).json({
              error: `Commit failed: ${(commit.stderr || commit.stdout || "git commit failed").slice(0, 500)}`,
            });
          }
        }
        const push = await run(`git push ${shellQuote(authedPushUrl)} HEAD:${shellQuote(branch)}`);
        if (push.exitCode !== 0) {
          const detail = (push.stderr || push.stdout || "git push failed").slice(0, 500);
          if (/403|permission[^.]*denied|denied[^.]*permission/i.test(detail)) {
            return res.status(403).json({
              error: `GitHub denied the push: ${detail.slice(0, 200)} The stored GitHub token lacks repository push access — sign out and sign in with GitHub again to grant it, then retry.`,
            });
          }
          return res.status(409).json({
            error: `Push failed: ${detail}`,
          });
        }
        await run(
          `git remote set-url origin ${shellQuote(repo)} && git config --unset-all credential.helper`,
        ).then(
          (r) => {
            if (r.exitCode !== 0)
              console.warn("Could not scrub commit token from git config", r.stderr);
          },
          () => undefined,
        );
        await prisma.projectSession
          .update({ where: { id: owner.id }, data: { lastDiff: "", lastDiffAt: null } })
          .catch(() => undefined);
        return res.json({ branch });
      } catch (error) {
        console.error("Commit failed", error);
        return res
          .status(503)
          .json({ error: "Commit failed: sandbox is unreachable. Reconnect and retry." });
      }
    }),
  );
}
