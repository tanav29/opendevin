import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Express } from "express";
import { prisma } from "../db/prisma.js";
import { runInitialTurn } from "../chat.js";
import { LIMITS, resolveChatModel, WORKSPACE_PATH } from "../config.js";
import { githubHeaders, githubTokenForUser } from "../github.js";
import { asyncRoute, currentUser, ownedProject, routeParam } from "../http.js";
import { dropPty } from "../pty.js";
import { isRepoUrl, parseGitHubRepo, sanitizeBranch } from "../sanitize.js";
import { killSandbox, provisionSandbox } from "../sandbox.js";

export function registerProjectRoutes(app: Express): void {
  app.get(
    "/api/projects",
    asyncRoute(async (req, res) => {
      const session = await currentUser(req);
      if (!session) return res.status(401).json({ error: "Sign in required" });
      const projects = await prisma.project.findMany({
        where: { userId: session.user.id },
        orderBy: { updatedAt: "desc" },
      });
      return res.json(projects);
    }),
  );

  app.get(
    "/api/projects/:id",
    asyncRoute(async (req, res) => {
      const session = await currentUser(req);
      if (!session) return res.status(401).json({ error: "Sign in required" });
      const project = await prisma.project.findFirst({
        where: { id: routeParam(req, "id"), userId: session.user.id },
      });
      return project ? res.json(project) : res.status(404).json({ error: "Project not found" });
    }),
  );

  app.post(
    "/api/projects",
    asyncRoute(async (req, res) => {
      const session = await currentUser(req);
      if (!session) return res.status(401).json({ error: "Sign in required" });
      const { repo } = req.body as { repo?: string };
      if (!repo?.trim()) return res.status(400).json({ error: "Repository is required" });
      const project = await prisma.project.create({
        data: { repo: repo.trim(), userId: session.user.id },
      });
      return res.status(201).json(project);
    }),
  );

  app.put(
    "/api/projects/:id",
    asyncRoute(async (req, res) => {
      const session = await currentUser(req);
      if (!session) return res.status(401).json({ error: "Sign in required" });
      const project = await prisma.project.findFirst({
        where: { id: routeParam(req, "id"), userId: session.user.id },
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
      if (
        typeof devPort === "number" &&
        Number.isInteger(devPort) &&
        devPort >= 1 &&
        devPort <= 65535
      )
        data.devPort = devPort;
      if (envVars && typeof envVars === "object" && !Array.isArray(envVars)) {
        const cleanEnvVars = Object.fromEntries(
          Object.entries(envVars)
            .map(
              ([key, value]) => [key.trim().slice(0, 100), String(value).slice(0, 2000)] as const,
            )
            .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
            .slice(0, 50),
        );
        data.envVars = JSON.stringify(cleanEnvVars);
      }
      if (Object.keys(data).length === 0)
        return res.status(400).json({ error: "Nothing to update" });
      return res.json(await prisma.project.update({ where: { id: project.id }, data }));
    }),
  );

  app.delete(
    "/api/projects/:id",
    asyncRoute(async (req, res) => {
      const session = await currentUser(req);
      if (!session) return res.status(401).json({ error: "Sign in required" });
      const project = await prisma.project.findFirst({
        where: { id: routeParam(req, "id"), userId: session.user.id },
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
    }),
  );

  app.get(
    "/api/projects/:projectId/sessions",
    asyncRoute(async (req, res) => {
      const found = await ownedProject(req, routeParam(req, "projectId"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.project) return res.status(404).json({ error: "Project not found" });
      return res.json(
        await prisma.projectSession.findMany({
          where: { projectId: found.project.id, archivedAt: null },
          omit: { toolLog: true, lastDiff: true },
          orderBy: { updatedAt: "desc" },
        }),
      );
    }),
  );

  app.get(
    "/api/projects/:projectId/branches",
    asyncRoute(async (req, res) => {
      const found = await ownedProject(req, routeParam(req, "projectId"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.project) return res.status(404).json({ error: "Project not found" });
      const project = found.project;
      const sessionUserId = found.user.id;
      const repo = project.repo?.trim() || "";
      if (!isRepoUrl(repo)) return res.json({ branches: [], defaultBranch: "" });
      try {
        const githubRepo = parseGitHubRepo(repo);
        if (githubRepo) {
          const token = await githubTokenForUser(sessionUserId);
          const headers = githubHeaders(token);

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

          return res.json({
            branches,
            defaultBranch: repoData.default_branch || branches[0] || "",
          });
        }

        const execFileAsync = promisify(execFile);
        let extraHeader: string[] = [];
        try {
          const token = await githubTokenForUser(sessionUserId);
          if (token && /^https:\/\/github\.com\//i.test(repo)) {
            extraHeader = ["-c", `http.extraHeader=Authorization: Bearer ${token}`];
          }
        } catch {
          // Fall back to unauthenticated ls-remote for public repos.
        }
        const lsRemote = (args: string[], timeout: number) =>
          execFileAsync("git", [...extraHeader, ...args, "--", repo], { timeout });
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
        return res.json({ branches, defaultBranch });
      } catch (error) {
        const safe = String(error instanceof Error ? error.message : error)
          .replace(/Bearer [^\s]+/g, "Bearer [redacted]")
          .slice(0, 300);
        console.error("List branches failed", safe);
        return res.status(502).json({
          error: `Could not list repository branches: ${safe}`,
          branches: [],
          defaultBranch: "",
        });
      }
    }),
  );

  app.get(
    "/api/projects/:projectId/issues",
    asyncRoute(async (req, res) => {
      const found = await ownedProject(req, routeParam(req, "projectId"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.project) return res.status(404).json({ error: "Project not found" });
      const githubRepo = parseGitHubRepo(found.project.repo || "");
      if (!githubRepo) return res.json({ issues: [] });

      const token = await githubTokenForUser(found.user.id);
      const headers = githubHeaders(token);
      const url = `https://api.github.com/repos/${encodeURIComponent(githubRepo.owner)}/${encodeURIComponent(githubRepo.name)}/issues?state=open&per_page=100`;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        return res.status(response.status === 404 ? 404 : 502).json({
          error: `Could not fetch GitHub issues (${response.status})`,
          issues: [],
        });
      }
      const items = (await response.json()) as Array<{
        number?: number;
        title?: string;
        html_url?: string;
        pull_request?: unknown;
      }>;
      return res.json({
        issues: items.flatMap((item) =>
          item.number && item.title && item.html_url && !item.pull_request
            ? [{ number: item.number, title: item.title, htmlUrl: item.html_url }]
            : [],
        ),
      });
    }),
  );

  // Cursor-like: creating a session immediately returns a record, then a cloud
  // sandbox spins up in the background and clones the project's repo on the
  // requested branch (empty = repo default branch). Once ready, the opening
  // prompt runs automatically so the agent answers without a second message.
  app.post(
    "/api/projects/:projectId/sessions",
    asyncRoute(async (req, res) => {
      const found = await ownedProject(req, routeParam(req, "projectId"));
      if (!found.auth) return res.status(401).json({ error: "Sign in required" });
      if (!found.project) return res.status(404).json({ error: "Project not found" });
      const project = found.project;
      const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
      if (!message) return res.status(400).json({ error: "A first message is required" });
      if (message.length > LIMITS.messageChars) {
        return res.status(413).json({
          error: `Message is too long: max ${LIMITS.messageChars.toLocaleString()} characters.`,
        });
      }
      const branch = sanitizeBranch(req.body.branch);
      if (!branch) return res.status(400).json({ error: "A source branch is required." });

      const created = await prisma.projectSession.create({
        data: {
          projectId: project.id,
          title: message.slice(0, 60),
          status: "queued",
          sandboxId: "",
          sandboxStatus: "creating",
          workspacePath: WORKSPACE_PATH,
          branch,
          model: resolveChatModel().modelId,
          toolLog: JSON.stringify([{ role: "user", content: message }]),
          messages: { create: { role: "user", content: message } },
        },
        include: { messages: true },
      });

      void provisionSandbox(created.id)
        .then((ready) => (ready ? runInitialTurn(created.id) : undefined))
        .catch((error) => console.error("Sandbox provisioning failed", error));
      return res.status(201).json(created);
    }),
  );
}
