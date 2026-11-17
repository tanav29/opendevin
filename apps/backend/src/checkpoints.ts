import { randomUUID } from "node:crypto";
import { Sandbox } from "e2b";
import { prisma } from "./db/prisma.js";
import { SANDBOX_TIMEOUT_MS, WORKSPACE_PATH } from "./config.js";
import { CHECKPOINT_SCRIPT } from "./checkpoint-script.js";
import { ensureRipgrep, killSandbox, provisionSandbox, runSandbox } from "./sandbox.js";
import { projectEnvVars, shellQuote } from "./sanitize.js";
import { HttpError } from "./http.js";
import type { ownedSession } from "./http.js";
import { CHECKPOINT_LEASE_MS, workspaceLocked, workspaceOperations } from "./lifecycle.js";

type Owner = Awaited<ReturnType<typeof ownedSession>>;
export const CHECKPOINT_MAX_BYTES = 20 * 1024 * 1024;
export const checkpointMetadata = {
  id: true,
  label: true,
  kind: true,
  sourceCommit: true,
  branch: true,
  fileCount: true,
  byteSize: true,
  exclusions: true,
  createdAt: true,
} as const;

// A database compare-and-swap also excludes requests handled by another process.
export async function lockWorkspace(owner: Owner): Promise<() => Promise<void>> {
  if (
    owner.archivedAt ||
    !["idle", "stopped", "failed", "interrupted"].includes(owner.status) ||
    !["ready", "error"].includes(owner.sandboxStatus) ||
    workspaceLocked(owner) ||
    workspaceOperations.has(owner.id)
  ) {
    throw new HttpError(409, "Wait for an idle, unarchived session before changing checkpoints.");
  }
  const operation = randomUUID();
  workspaceOperations.add(owner.id);
  try {
    const claimed = await prisma.projectSession.updateMany({
      where: {
        id: owner.id,
        updatedAt: owner.updatedAt,
        archivedAt: null,
        OR: [
          { workspaceOperation: null },
          { workspaceOperationAt: { lt: new Date(Date.now() - CHECKPOINT_LEASE_MS) } },
        ],
      },
      data: { workspaceOperation: operation, workspaceOperationAt: new Date() },
    });
    if (claimed.count !== 1) throw new HttpError(409, "Session changed. Refresh and retry.");
  } catch (error) {
    workspaceOperations.delete(owner.id);
    throw error;
  }
  return async () => {
    try {
      await prisma.projectSession.updateMany({
        where: { id: owner.id, workspaceOperation: operation },
        data: { workspaceOperation: null, workspaceOperationAt: null },
      });
    } finally {
      workspaceOperations.delete(owner.id);
    }
  };
}

async function runCheckpoint(
  sandbox: Sandbox,
  mode: "capture" | "restore",
  archive: string,
  secretsFile = "",
) {
  const out = await runSandbox(
    sandbox,
    `python3 -c ${shellQuote(CHECKPOINT_SCRIPT)} ${mode} ${shellQuote(WORKSPACE_PATH)} ${shellQuote(archive)} ${shellQuote(secretsFile)}`,
    "/tmp",
    180_000,
  );
  let result: {
    error?: string;
    sourceCommit: string;
    branch: string;
    fileCount: number;
    byteSize: number;
    exclusions: string[];
  };
  try {
    result = JSON.parse(out.stdout.trim());
  } catch {
    throw new HttpError(422, "Checkpoint failed. Python 3 and Git are required in the sandbox.");
  }
  if (out.exitCode !== 0 || result.error)
    throw new HttpError(422, result.error || "Checkpoint operation failed.");
  return result;
}

export async function saveCheckpoint(
  owner: Owner,
  sandbox: Sandbox,
  label: string,
  kind = "manual",
) {
  if (owner.workspacePath !== WORKSPACE_PATH)
    throw new HttpError(422, "Only the managed workspace path supports checkpoints.");
  if (
    kind === "manual" &&
    (await prisma.workspaceCheckpoint.count({ where: { sessionId: owner.id, kind } })) >= 20
  ) {
    throw new HttpError(
      409,
      "This session has 20 manual checkpoints. Delete one before capturing another.",
    );
  }
  const temp = `/tmp/opendevin-checkpoint-${randomUUID()}`;
  try {
    // Values travel through a private temporary file, never command text, logs, or the archive.
    await sandbox.files.write(
      `${temp}.secrets`,
      JSON.stringify(Object.values(projectEnvVars(owner.project.envVars))),
    );
    await runSandbox(sandbox, `chmod 600 -- ${shellQuote(`${temp}.secrets`)}`, "/tmp");
    const metadata = await runCheckpoint(sandbox, "capture", temp, `${temp}.secrets`);
    const payload = await sandbox.files.read(temp, { format: "bytes" });
    if (payload.length > CHECKPOINT_MAX_BYTES)
      throw new HttpError(422, "Checkpoint exceeds 20 MiB.");
    const saved = await prisma.workspaceCheckpoint.create({
      data: {
        sessionId: owner.id,
        label: label.slice(0, 100),
        kind,
        ...metadata,
        exclusions: JSON.stringify(metadata.exclusions),
        payload: new Uint8Array(payload),
      },
      select: checkpointMetadata,
    });
    await prisma.projectSession.update({
      where: { id: owner.id },
      data: { checkpointError: null },
    });
    if (kind === "automatic") {
      const old = await prisma.workspaceCheckpoint.findMany({
        where: { sessionId: owner.id, kind },
        orderBy: { createdAt: "desc" },
        skip: 10,
        select: { id: true },
      });
      if (old.length)
        await prisma.workspaceCheckpoint.deleteMany({
          where: { id: { in: old.map((c) => c.id) } },
        });
    }
    return saved;
  } finally {
    await runSandbox(
      sandbox,
      `rm -f -- ${shellQuote(temp)} ${shellQuote(`${temp}.secrets`)}`,
      "/tmp",
    ).catch(() => undefined);
  }
}

export async function automaticCheckpoint(owner: Owner, sandbox: Sandbox): Promise<void> {
  if (workspaceLocked(owner) || owner.archivedAt) return;
  try {
    await saveCheckpoint(owner, sandbox, "Automatic recovery", "automatic");
  } catch (error) {
    await prisma.projectSession.update({
      where: { id: owner.id },
      data: {
        checkpointError:
          error instanceof HttpError
            ? error.message
            : "Automatic checkpoint failed. Previous checkpoints are retained.",
      },
    });
  }
}

export async function findCheckpoint(sessionId: string, checkpointId?: unknown) {
  if (checkpointId !== undefined && typeof checkpointId !== "string")
    throw new HttpError(400, "Invalid checkpoint ID.");
  const checkpoint = await prisma.workspaceCheckpoint.findFirst({
    where: { sessionId, ...(typeof checkpointId === "string" ? { id: checkpointId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (!checkpoint && checkpointId !== undefined)
    throw new HttpError(404, "Checkpoint not found in this session.");
  return checkpoint;
}

// Never publish the replacement sandbox ID until the complete checkpoint has restored.
export async function createCheckpointSandbox(
  owner: Owner,
  checkpoint: NonNullable<Awaited<ReturnType<typeof findCheckpoint>>>,
) {
  let sandbox: Sandbox | undefined;
  try {
    sandbox = await Sandbox.create({ timeoutMs: SANDBOX_TIMEOUT_MS });
    const temp = `/tmp/opendevin-checkpoint-${randomUUID()}`;
    try {
      await sandbox.files.write(temp, new Uint8Array(checkpoint.payload).buffer);
      const restored = await runCheckpoint(sandbox, "restore", temp);
      if (
        restored.sourceCommit !== checkpoint.sourceCommit ||
        restored.branch !== checkpoint.branch
      )
        throw new HttpError(
          422,
          "Checkpoint metadata does not match its payload. Recovery data was retained.",
        );
    } finally {
      await runSandbox(sandbox, `rm -f -- ${shellQuote(temp)}`, "/tmp").catch(() => undefined);
    }
    // Only the clean project URL is configured; authentication is supplied at publish time.
    const url = owner.project.repo.trim();
    if (
      /^https?:\/\//.test(url) &&
      !new URL(url).username &&
      !new URL(url).password &&
      !new URL(url).search &&
      !new URL(url).hash
    ) {
      const out = await runSandbox(
        sandbox,
        `git remote add origin ${shellQuote(url)}`,
        WORKSPACE_PATH,
      );
      if (out.exitCode !== 0) throw new Error("origin configuration failed");
    }
    await ensureRipgrep(sandbox);
    return sandbox;
  } catch (error) {
    if (sandbox) await killSandbox(sandbox.sandboxId);
    throw error instanceof HttpError
      ? error
      : new HttpError(
          503,
          "Checkpoint restore failed. Existing sandbox and recovery data were retained.",
        );
  }
}

export async function createFreshSessionSandbox(owner: Owner): Promise<string> {
  // Reuse normal provisioning/setup without changing the original session on failure.
  const candidate = await prisma.projectSession.create({
    data: {
      projectId: owner.projectId,
      title: "Preparing replacement sandbox",
      archivedAt: new Date(),
      sandboxStatus: "creating",
      status: "queued",
      workspacePath: WORKSPACE_PATH,
      branch: owner.branch,
    },
  });
  let sandboxId = "";
  try {
    const ready = await provisionSandbox(candidate.id);
    const result = await prisma.projectSession.findUniqueOrThrow({ where: { id: candidate.id } });
    sandboxId = result.sandboxId;
    if (!ready || !sandboxId)
      throw new HttpError(
        503,
        "Fresh sandbox provisioning failed. The previous workspace and recovery data were retained.",
      );
    await prisma.projectSession.delete({ where: { id: candidate.id } });
    return sandboxId;
  } catch (error) {
    if (sandboxId) await killSandbox(sandboxId);
    await prisma.projectSession.delete({ where: { id: candidate.id } }).catch(() => undefined);
    throw error;
  }
}
