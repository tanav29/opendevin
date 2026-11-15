import { CommandExitError, Sandbox } from "e2b";
import { prisma } from "./db/prisma.js";
import { SANDBOX_TIMEOUT_MS, WORKSPACE_PATH } from "./config.js";
import { githubTokenForUser } from "./github.js";
import { isRepoUrl, projectEnvVars, shellQuote } from "./sanitize.js";
import { canTransition } from "./lifecycle.js";

export type SandboxResult = { exitCode: number; stdout: string; stderr: string };

const activeProvisioning = new Set<string>();
const canceledProvisioning = new Set<string>();

export function cancelSandboxProvisioning(sessionId: string): void {
  canceledProvisioning.add(sessionId);
}

function provisioningCanceled(sessionId: string): boolean {
  return canceledProvisioning.has(sessionId);
}

// E2B's `commands.run` throws CommandExitError on any non-zero exit, but git
// signals "differences found" via exit 1 — the normal case for a diff. The
// thrown error still carries stdout/stderr, so unwrap it instead of losing
// the output. Genuine transport failures still throw.
export async function runSandbox(
  sandbox: Sandbox,
  command: string,
  cwd: string,
  timeoutMs = 30_000,
  envs?: Record<string, string>,
): Promise<SandboxResult> {
  try {
    const result = await sandbox.commands.run(command, { cwd, timeoutMs, envs });
    return { exitCode: result.exitCode, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (error) {
    if (error instanceof CommandExitError) {
      return {
        exitCode: error.exitCode,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      };
    }
    throw error;
  }
}

export async function killSandbox(sandboxId: string): Promise<void> {
  if (!sandboxId) return;
  try {
    await Sandbox.kill(sandboxId);
  } catch {
    // Best-effort: sandbox may already be gone or expired.
  }
}

export async function cloneRepo(
  sandbox: Sandbox,
  repo: string,
  workspacePath: string,
  branch = "",
  token: string | null = null,
): Promise<void> {
  const url = repo.trim();
  const isGitHub = /^https:\/\/github\.com\//i.test(url);
  const cleanWorkspace = () =>
    sandbox.commands.run(
      `rm -rf ${shellQuote(workspacePath)} && mkdir -p ${shellQuote(workspacePath)}`,
    );
  const authedUrl =
    token && isGitHub
      ? url.replace(/^https:\/\/github\.com\//i, `https://oauth2:${token}@github.com/`)
      : null;

  async function tryClone(targetUrl: string, targetBranch: string) {
    const branchArg = targetBranch ? ` --branch ${shellQuote(targetBranch)}` : "";
    return runSandbox(
      sandbox,
      `git clone --depth 1${branchArg} ${shellQuote(targetUrl)} ${shellQuote(workspacePath)}`,
      "/tmp",
      120_000,
    );
  }

  async function scrubOrigin() {
    await sandbox.commands
      .run(`git -C ${shellQuote(workspacePath)} remote set-url origin ${shellQuote(url)}`)
      .catch(() => undefined);
  }

  await cleanWorkspace();
  let result = await tryClone(url, branch);
  if (result.exitCode !== 0 && authedUrl) {
    await cleanWorkspace();
    result = await tryClone(authedUrl, branch);
    if (result.exitCode === 0) await scrubOrigin();
  }
  if (result.exitCode === 0) return;

  // Branch may be new (not on remote): clone default then checkout -B.
  if (branch) {
    await cleanWorkspace();
    result = await tryClone(url, "");
    if (result.exitCode !== 0 && authedUrl) {
      await cleanWorkspace();
      result = await tryClone(authedUrl, "");
    }
    if (result.exitCode === 0) {
      await scrubOrigin();
      const cwd = workspacePath;
      const fetchOut = await runSandbox(
        sandbox,
        `git fetch origin ${shellQuote(branch)} --depth 1`,
        cwd,
      ).catch(() => ({ exitCode: 128, stdout: "", stderr: "" }));
      if (fetchOut.exitCode === 0) {
        const co = await runSandbox(sandbox, `git checkout ${shellQuote(branch)}`, cwd).catch(
          () => ({ exitCode: 128, stdout: "", stderr: "" }),
        );
        if (co.exitCode === 0) return;
      }
      const create = await runSandbox(sandbox, `git checkout -B ${shellQuote(branch)}`, cwd).catch(
        () => ({ exitCode: 128, stdout: "", stderr: "" }),
      );
      if (create.exitCode === 0) return;
    }
  }
  if (result.exitCode !== 0) {
    const raw = (result.stderr || result.stdout || "git clone failed").slice(0, 2000);
    const hint =
      !token && isGitHub ? " The repository may be private — sign in with GitHub and retry." : "";
    throw new Error(`${raw}${hint}`);
  }
}

export async function ensureRipgrep(sandbox: Sandbox): Promise<void> {
  // Best-effort: E2B base images don't ship rg. Search falls back to grep,
  // so never fail provisioning when the install fails (offline, no apt, ...).
  try {
    await runSandbox(
      sandbox,
      "command -v rg >/dev/null 2>&1 || { sudo apt-get update -qq && sudo apt-get install -y -qq ripgrep || { apt-get update -qq && apt-get install -y -qq ripgrep; }; }",
      "/tmp",
      120_000,
    );
  } catch {
    // Ignore — search tool falls back to grep.
  }
}

export async function provisionSandbox(sessionId: string): Promise<boolean> {
  if (activeProvisioning.has(sessionId)) {
    if (!canceledProvisioning.has(sessionId)) return false;
    const deadline = Date.now() + 10_000;
    while (activeProvisioning.has(sessionId) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (activeProvisioning.has(sessionId)) return false;
  }
  canceledProvisioning.delete(sessionId);
  activeProvisioning.add(sessionId);
  try {
    return await provisionSandboxUnlocked(sessionId);
  } finally {
    activeProvisioning.delete(sessionId);
  }
}

async function provisionSandboxUnlocked(sessionId: string): Promise<boolean> {
  const existing = await prisma.projectSession.findUnique({
    where: { id: sessionId },
    include: { project: true },
  });
  if (!existing) return false;
  if (!canTransition("provisioning", existing.sandboxStatus, "creating")) return false;

  await prisma.projectSession.update({
    where: { id: sessionId },
    data: { sandboxStatus: "creating", status: "queued", lastError: null },
  });

  try {
    if (!process.env.E2B_API_KEY) {
      throw new Error("E2B_API_KEY is not configured");
    }
    const sandbox = await Sandbox.create({ timeoutMs: SANDBOX_TIMEOUT_MS });
    if (provisioningCanceled(sessionId)) {
      await killSandbox(sandbox.sandboxId);
      return false;
    }
    await ensureRipgrep(sandbox);
    await prisma.projectSession.update({
      where: { id: sessionId },
      data: {
        sandboxId: sandbox.sandboxId,
        sandboxStatus: existing.project.repo?.trim() ? "cloning" : "setting-up",
        status: "queued",
      },
    });
    if (provisioningCanceled(sessionId)) {
      await killSandbox(sandbox.sandboxId);
      return false;
    }

    const repo = existing.project.repo?.trim();
    if (isRepoUrl(repo)) {
      try {
        const token = await githubTokenForUser(existing.project.userId);
        await cloneRepo(
          sandbox,
          repo,
          existing.workspacePath || WORKSPACE_PATH,
          existing.branch || "",
          token,
        );
      } catch (error) {
        await killSandbox(sandbox.sandboxId);
        await prisma.projectSession.update({
          where: { id: sessionId },
          data: {
            sandboxId: "",
            sandboxStatus: "error",
            status: "failed",
            lastError: error instanceof Error ? error.message : "Repository clone failed",
          },
        });
        return false;
      }
    }
    if (provisioningCanceled(sessionId)) {
      await killSandbox(sandbox.sandboxId);
      return false;
    }
    if (isRepoUrl(repo)) {
      await prisma.projectSession.update({
        where: { id: sessionId },
        data: { sandboxStatus: "setting-up", status: "queued" },
      });
    }

    // Project setup script (env install, e.g. `pnpm install`). Runs once after
    // clone so preview/dev and agent tools work without manual terminal steps.
    const setup = (existing.project as { setupScript?: string }).setupScript?.trim();
    const envs = projectEnvVars((existing.project as { envVars?: string }).envVars);
    if (setup) {
      try {
        const out = await runSandbox(
          sandbox,
          setup.slice(0, 2000),
          existing.workspacePath || WORKSPACE_PATH,
          300_000,
          envs,
        );
        if (out.exitCode !== 0) {
          await killSandbox(sandbox.sandboxId);
          await prisma.projectSession.update({
            where: { id: sessionId },
            data: {
              sandboxId: "",
              sandboxStatus: "error",
              status: "failed",
              lastError: `Setup script exited ${out.exitCode}: ${(out.stderr || out.stdout).slice(0, 500)}`,
            },
          });
          return false;
        }
      } catch (error) {
        await killSandbox(sandbox.sandboxId);
        await prisma.projectSession.update({
          where: { id: sessionId },
          data: {
            sandboxId: "",
            sandboxStatus: "error",
            status: "failed",
            lastError:
              error instanceof Error
                ? `Setup failed: ${error.message}`.slice(0, 500)
                : "Setup failed",
          },
        });
        return false;
      }
    }

    if (provisioningCanceled(sessionId)) {
      await killSandbox(sandbox.sandboxId);
      return false;
    }
    await prisma.projectSession.update({
      where: { id: sessionId },
      data: { sandboxStatus: "ready", status: "queued", lastError: null },
    });
    return true;
  } catch (error) {
    await prisma.projectSession.update({
      where: { id: sessionId },
      data: {
        sandboxStatus: "error",
        status: "failed",
        lastError: error instanceof Error ? error.message : "Sandbox creation failed",
      },
    });
    return false;
  }
}

export async function checkSandboxAvailable(sandboxId: string): Promise<boolean> {
  if (!sandboxId) return false;
  try {
    const sandbox = await Sandbox.connect(sandboxId);
    await sandbox.commands.run("pwd", { timeoutMs: 15_000 });
    return true;
  } catch {
    return false;
  }
}

// Preview readiness: E2B's getHost() yields a URL for any port, even when
// nothing listens there — the iframe then shows a dead page. Probe from inside
// the sandbox so /preview and /devserver only hand out URLs that serve.
export async function probePort(
  sandbox: Sandbox,
  port: number,
  timeoutMs = 10_000,
): Promise<{ listening: boolean; httpCode: number }> {
  const out = await runSandbox(
    sandbox,
    `curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:${port}/ || true`,
    "/tmp",
    timeoutMs,
  ).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
  const code = Number((out.stdout || "").trim().slice(-3));
  if (Number.isInteger(code) && code > 0) return { listening: true, httpCode: code };
  return { listening: false, httpCode: 0 };
}

export async function waitForPort(
  sandbox: Sandbox,
  port: number,
  timeoutMs = 25_000,
): Promise<{ listening: boolean; httpCode: number }> {
  const start = Date.now();
  let last = { listening: false, httpCode: 0 };
  for (;;) {
    last = await probePort(sandbox, port);
    if (last.listening || Date.now() - start > timeoutMs) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
