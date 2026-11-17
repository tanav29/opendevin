import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { Sandbox } from "e2b";
import { CHECKPOINT_SCRIPT } from "../src/checkpoint-script.js";

const testUrl = process.env.CHECKPOINT_TEST_DATABASE_URL;
const exec = promisify(execFile);

test(
  "durable PostgreSQL checkpoints survive source loss, release leases, and retain recovery on capture failure",
  { skip: !testUrl },
  async (t) => {
    // Explicit opt-in: never run storage tests against the application's configured database.
    process.env.DATABASE_URL = testUrl;
    const { prisma } = await import("../src/db/prisma.js");
    const { automaticCheckpoint, findCheckpoint, lockWorkspace, saveCheckpoint } =
      await import("../src/checkpoints.js");
    const dir = await mkdtemp(join(tmpdir(), "checkpoint-storage-"));
    const root = join(dir, "workspace");
    await mkdir(root);
    t.after(() => rm(dir, { recursive: true, force: true }));
    const git = async (...args: string[]) => (await exec("git", args, { cwd: root })).stdout.trim();
    await git("init", "--initial-branch=feature");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Checkpoint storage test");
    await writeFile(join(root, "work.txt"), "committed work");
    await git("add", ".");
    await git("commit", "-m", "Unpushed commit");
    const head = await git("rev-parse", "HEAD");
    await writeFile(join(root, "work.txt"), "unsaved work");
    const user = await prisma.user.create({
      data: { id: randomUUID(), name: "Checkpoint test", email: `${randomUUID()}@example.com` },
    });
    t.after(async () => {
      try {
        await prisma.user.delete({ where: { id: user.id } });
      } finally {
        await prisma.$disconnect();
      }
    });
    const project = await prisma.project.create({
      data: { userId: user.id, repo: "https://github.com/example/repo" },
    });
    const owner = await prisma.projectSession.create({
      data: {
        projectId: project.id,
        title: "Storage test",
        sandboxId: "local-test",
        sandboxStatus: "ready",
        status: "idle",
      },
      include: { project: true },
    });
    const localPath = (path: string) => join(dir, basename(path));
    const sandbox = {
      files: {
        write: (path: string, data: string) => writeFile(localPath(path), data),
        read: async (path: string) => new Uint8Array(await readFile(localPath(path))),
      },
      commands: {
        run: async (command: string) => {
          if (!command.startsWith("python3 -c")) return { exitCode: 0, stdout: "", stderr: "" };
          const match = command.match(/ capture '[^']+' '([^']+)' '([^']+)'$/)!;
          try {
            const { stdout } = await exec("python", [
              "-c",
              CHECKPOINT_SCRIPT,
              "capture",
              root,
              localPath(match[1]),
              localPath(match[2]),
            ]);
            return { exitCode: 0, stdout, stderr: "" };
          } catch (error) {
            return { exitCode: 1, stdout: (error as { stdout: string }).stdout, stderr: "" };
          }
        },
      },
    } as unknown as Sandbox;

    const unlock = await lockWorkspace(owner);
    const locked = await prisma.projectSession.findUniqueOrThrow({ where: { id: owner.id } });
    assert.ok(locked.workspaceOperation);
    await assert.rejects(lockWorkspace({ ...owner, ...locked }), /idle, unarchived/);
    const saved = await saveCheckpoint(owner, sandbox, "Durable recovery");
    assert.equal(saved.sourceCommit, head);
    assert.equal("payload" in saved, false);
    await unlock();
    assert.equal(
      (await prisma.projectSession.findUniqueOrThrow({ where: { id: owner.id } }))
        .workspaceOperation,
      null,
    );
    await writeFile(join(root, ".env"), "PRIVATE=not captured");
    await git("add", ".env");
    await automaticCheckpoint(owner, sandbox);
    assert.equal(await prisma.workspaceCheckpoint.count({ where: { sessionId: owner.id } }), 1);
    assert.match(
      (await prisma.projectSession.findUniqueOrThrow({ where: { id: owner.id } })).checkpointError!,
      /history\/index contains/,
    );
    const durable = await findCheckpoint(owner.id, saved.id);
    assert.ok(durable);
    await rm(root, { recursive: true });
    const archive = join(dir, "restore.gz");
    await writeFile(archive, durable.payload);
    const restored = join(dir, "restored");
    await exec("python", ["-c", CHECKPOINT_SCRIPT, "restore", restored, archive]);
    assert.equal((await exec("git", ["rev-parse", "HEAD"], { cwd: restored })).stdout.trim(), head);
    assert.equal(await readFile(join(restored, "work.txt"), "utf8"), "unsaved work");
  },
);
