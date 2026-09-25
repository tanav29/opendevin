import { Sandbox } from "e2b";
import { prisma } from "./db/prisma.js";
import { DIFF_MAX_BYTES, MAX_UNTRACKED_FILES, WORKSPACE_PATH } from "./config.js";
import { runSandbox } from "./sandbox.js";
import { shellQuote } from "./sanitize.js";

export const FRESH_CLONE_WARNING =
  "Fresh sandbox created; the previous workspace was not restored. Review the saved patch before continuing.";

export function hasUnrestoredWorkspace(lastError: string | null | undefined): boolean {
  return typeof lastError === "string" && lastError.startsWith(FRESH_CLONE_WARNING);
}

export function withContinuityWarning(
  previous: string | null | undefined,
  message: string,
): string {
  return hasUnrestoredWorkspace(previous) ? `${FRESH_CLONE_WARNING}\n${message}` : message;
}

function truncateAtFileBoundary(diff: string): string {
  if (diff.length <= DIFF_MAX_BYTES) return diff;
  const cut = diff.lastIndexOf("\ndiff --git ", DIFF_MAX_BYTES);
  return cut <= 0 ? diff.slice(0, DIFF_MAX_BYTES) : diff.slice(0, cut);
}

// Full workspace diff: tracked changes (`git diff HEAD`) plus untracked new
// files, which `git diff HEAD` silently omits. Each untracked file is diffed
// against /dev/null so the result stays a parseable unified patch.
export async function readWorkspaceDiff(
  sandbox: Sandbox,
  cwd: string,
): Promise<{ diff: string; truncated: boolean }> {
  const run = (command: string) => runSandbox(sandbox, command, cwd);

  try {
    const rev = await run("git rev-parse --git-dir");
    if (rev.exitCode !== 0) throw new Error("Workspace is not a Git repository.");
  } catch (error) {
    throw error instanceof Error ? error : new Error("Could not inspect the Git workspace.");
  }

  let tracked = "";
  const head = await run("git diff HEAD --no-color");
  if (head.exitCode === 0 || head.exitCode === 1) {
    tracked = head.stdout || "";
  } else {
    const [staged, unstaged] = await Promise.all([
      run("git diff --cached --no-color"),
      run("git diff --no-color"),
    ]);
    if (staged.exitCode <= 1 && unstaged.exitCode <= 1) {
      tracked = [staged.stdout || "", unstaged.stdout || ""].filter(Boolean).join("\n");
    } else {
      throw new Error((head.stderr || head.stdout || "git diff failed").slice(0, 500));
    }
  }

  let untrackedNames: string[] = [];
  const listed = await run("git ls-files --others --exclude-standard -z");
  if (listed.exitCode === 0) {
    untrackedNames = (listed.stdout || "").split("\0").filter((name) => name.length > 0);
  }
  let truncated = untrackedNames.length > MAX_UNTRACKED_FILES;
  untrackedNames = untrackedNames.slice(0, MAX_UNTRACKED_FILES);

  const patches: string[] = [];
  if (tracked) patches.push(tracked.endsWith("\n") ? tracked : `${tracked}\n`);
  for (const name of untrackedNames) {
    const out = await run(`git diff --no-index --no-color -- /dev/null ${shellQuote(name)}`);
    let patch = out.stdout || "";
    if (!patch) {
      patch = `new file mode 100644\n--- /dev/null\n+++ b/${name}\n`;
    }
    const lines = patch.split("\n");
    if (lines[0]?.startsWith("diff --git ")) lines[0] = `diff --git a/${name} b/${name}`;
    else lines.unshift(`diff --git a/${name} b/${name}`);
    for (let i = 1; i < lines.length && i <= 6; i++) {
      if (lines[i]?.startsWith("--- ")) lines[i] = "--- /dev/null";
      else if (lines[i]?.startsWith("+++ ")) lines[i] = `+++ b/${name}`;
    }
    patches.push(`${lines.join("\n").trimEnd()}\n`);
    if (patches.join("").length > DIFF_MAX_BYTES) {
      truncated = true;
      break;
    }
  }

  const combined = patches.join("");
  if (combined.length <= DIFF_MAX_BYTES && !truncated) return { diff: combined, truncated: false };
  return { diff: truncateAtFileBoundary(combined), truncated: true };
}

// Best-effort diff snapshot so the Changes tab survives sandbox expiry. The
// caller owns the final lifecycle status; failures must not silently become idle.
export async function snapshotWorkspaceDiff(sessionId: string): Promise<void> {
  const session = await prisma.projectSession.findUnique({ where: { id: sessionId } });
  if (!session?.sandboxId) return;
  // A confirmed replacement leaves the previous review-only patch authoritative
  // until the user explicitly acts on it. Never overwrite it with fresh-clone state.
  if (hasUnrestoredWorkspace(session.lastError)) return;
  try {
    const sandbox = await Sandbox.connect(session.sandboxId);
    const { diff } = await readWorkspaceDiff(sandbox, session.workspacePath || WORKSPACE_PATH);
    await prisma.projectSession.update({
      where: { id: sessionId },
      data: { lastDiff: diff, lastDiffAt: new Date() },
    });
  } catch {
    // Unreachable sandbox: keep the last known diff and let the caller set state.
  }
}

export async function snapshotDiffAndIdle(sessionId: string): Promise<void> {
  await snapshotWorkspaceDiff(sessionId);
  await prisma.projectSession.update({ where: { id: sessionId }, data: { status: "idle" } });
}

const TREE_SKIP_DIRS: Record<string, true> = { ".git": true, node_modules: true };

export async function listWorkspaceTree(
  sandbox: Sandbox,
  cwd: string,
  limit = 5000,
): Promise<{ paths: string[]; truncated: boolean }> {
  const paths: string[] = [];
  const queue: string[] = [""];
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
        if (paths.length >= limit) {
          truncated = true;
          break;
        }
      }
    }
    if (truncated) break;
  }
  if (queue.length > DIR_LIMIT) truncated = true;
  paths.sort();
  return { paths, truncated };
}
