import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Sandbox } from "e2b";

test("checkpoint APIs enforce ownership, idle lifecycle, intentional replacement and recovery on reconnect", async (t) => {
  let signedIn = true;
  let ownsSession = true;
  let live = false;
  let restoreFails = false;
  let updateFails = false;
  let claimSucceeds = true;
  let checkpointExists = true;
  const killed: string[] = [];
  const commands: string[] = [];
  const updates: Record<string, unknown>[] = [];
  let checkpointWrites = 0;
  let owner = {
    id: "session",
    title: "Task",
    projectId: "project",
    branch: "feature",
    model: "test",
    sandboxId: "old-sandbox",
    sandboxStatus: "ready",
    workspacePath: "/home/user/workspace",
    status: "idle",
    archivedAt: null as Date | null,
    updatedAt: new Date(),
    workspaceOperation: null as string | null,
    workspaceOperationAt: null as Date | null,
    project: {
      id: "project",
      repo: "https://github.com/example/repo",
      userId: "user",
      envVars: "{}",
    },
    lastDiff: "saved recovery patch",
    lastDiffAt: new Date(),
    checkpointError: null,
  };
  const checkpoint = {
    id: "checkpoint",
    sessionId: "session",
    label: "Saved work",
    kind: "manual",
    sourceCommit: "a".repeat(40),
    branch: "feature",
    fileCount: 3,
    byteSize: 10,
    exclusions: "[]",
    payload: new Uint8Array([1]),
    createdAt: new Date(),
  };
  const globals = globalThis as unknown as { prisma?: unknown };
  const previousPrisma = globals.prisma;
  globals.prisma = {
    projectSession: {
      findFirst: async ({ where }: { where: { id: string; project: { userId: string } } }) => {
        assert.equal(where.project.userId, "user");
        return ownsSession ? { ...owner } : null;
      },
      updateMany: async ({ data }: { data: Partial<typeof owner> }) => {
        if (!claimSucceeds) return { count: 0 };
        Object.assign(owner, data);
        return { count: 1 };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        if (updateFails && data.sandboxId) throw new Error("Simulated database failure");
        updates.push(data);
        Object.assign(owner, data);
        return owner;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        assert.ok(data.checkpoints);
        checkpointWrites++;
        return { id: "fork-session", ...data };
      },
      delete: async () => ({}),
    },
    workspaceCheckpoint: {
      findFirst: async ({ where }: { where: { sessionId: string; id?: string } }) => {
        assert.equal(where.sessionId, "session");
        return checkpointExists && (!where.id || where.id === checkpoint.id) ? checkpoint : null;
      },
      findMany: async ({ select }: { select: { payload?: boolean } }) => {
        assert.equal(select.payload, undefined);
        const { payload: _payload, ...metadata } = checkpoint;
        return [metadata];
      },
      count: async () => 0,
      create: async () => {
        checkpointWrites++;
        return checkpoint;
      },
    },
  };
  t.after(() => {
    globals.prisma = previousPrisma;
  });
  const { createApp } = await import("../src/application.js");
  const { auth } = await import("../src/auth/auth.js");
  const { claimAgentTurn, releaseAgentTurn } = await import("../src/chat.js");
  const apiDescriptor = Object.getOwnPropertyDescriptor(auth, "api")!;
  Object.defineProperty(auth, "api", {
    configurable: true,
    value: { getSession: async () => (signedIn ? { user: { id: "user" } } : null) },
  });
  t.after(() => Object.defineProperty(auth, "api", apiDescriptor));
  t.mock.method(Sandbox, "connect", async () => {
    if (!live) throw new Error("expired");
    return { commands: { run: async () => ({ stdout: "/home/user/workspace", exitCode: 0 }) } };
  });
  t.mock.method(Sandbox, "create", async () => ({
    sandboxId: "replacement-sandbox",
    files: { write: async () => ({}) },
    commands: {
      run: async (command: string) => {
        commands.push(command);
        if (command.includes("python3 -c") && restoreFails)
          return {
            exitCode: 1,
            stdout: JSON.stringify({ error: "Checkpoint restore failed safely" }),
          };
        return {
          exitCode: 0,
          stdout: command.includes("python3 -c")
            ? JSON.stringify({ sourceCommit: checkpoint.sourceCommit, branch: checkpoint.branch })
            : "",
        };
      },
    },
  }));
  t.mock.method(Sandbox, "kill", async (id: string) => {
    killed.push(id);
  });
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (path: string, method = "POST", body: object = {}) => {
    const response = await fetch(`${base}/api/sessions/session${path}`, {
      method,
      ...(method !== "GET"
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const original = { ...owner };
  function reset() {
    owner = { ...original };
    updates.length = 0;
    killed.length = 0;
    commands.length = 0;
  }

  await t.test("requires authentication and ownership for every checkpoint action", async () => {
    for (const [path, method] of [
      ["/checkpoints", "GET"],
      ["/checkpoints", "POST"],
      ["/checkpoints/checkpoint/restore", "POST"],
      ["/checkpoints/checkpoint/fork", "POST"],
      ["/checkpoints/checkpoint", "DELETE"],
    ]) {
      signedIn = false;
      assert.equal((await request(path, method)).status, 401);
      signedIn = true;
      ownsSession = false;
      assert.equal((await request(path, method)).status, 404);
      ownsSession = true;
    }
  });
  await t.test(
    "lists metadata without payload and rejects checkpoint IDs from another session",
    async () => {
      assert.equal((await request("/checkpoints", "GET")).body.checkpoints[0].payload, undefined);
      assert.equal((await request("/checkpoints/other/fork")).status, 404);
    },
  );
  await t.test(
    "requires explicit confirmation before restoring, and blocks archived, queued, active and locked sessions",
    async () => {
      assert.equal((await request("/checkpoints/checkpoint/restore")).status, 409);
      owner.archivedAt = new Date();
      assert.equal((await request("/checkpoints/checkpoint/fork")).status, 409);
      reset();
      owner.status = "queued";
      assert.equal((await request("/checkpoints/checkpoint/fork")).status, 409);
      reset();
      owner.workspaceOperation = "other";
      owner.workspaceOperationAt = new Date();
      assert.equal((await request("/checkpoints/checkpoint/fork")).status, 409);
      reset();
      const controller = claimAgentTurn(owner.id, "chat")!;
      try {
        assert.equal((await request("/checkpoints/checkpoint/fork")).status, 409);
      } finally {
        releaseAgentTurn(owner.id, controller);
      }
      claimSucceeds = false;
      assert.equal((await request("/checkpoints/checkpoint/fork")).status, 409);
      claimSucceeds = true;
      assert.equal(commands.length, 0);
    },
  );
  await t.test(
    "expired reconnect restores the latest checkpoint instead of cloning, then replaces the old sandbox",
    async () => {
      reset();
      const response = await request("/reconnect");
      assert.equal(response.status, 200);
      assert.equal(response.body.continuity, "checkpoint");
      assert.equal(response.body.checkpoint.id, checkpoint.id);
      assert.ok(commands.some((c) => c.includes("python3 -c") && c.includes(" restore ")));
      assert.equal(
        commands.some((c) => c.includes("git clone")),
        false,
      );
      assert.equal(owner.sandboxId, "replacement-sandbox");
      assert.equal(owner.lastDiff, "saved recovery patch");
      assert.deepEqual(killed, ["old-sandbox"]);
    },
  );
  await t.test("live reconnect reattaches without restoring or cloning", async () => {
    reset();
    live = true;
    assert.equal((await request("/reconnect")).body.continuity, "existing-sandbox");
    assert.equal(commands.length, 0);
    live = false;
  });
  await t.test(
    "restore failure keeps the existing sandbox, checkpoint, and patch and releases the lease",
    async () => {
      reset();
      restoreFails = true;
      assert.equal((await request("/reconnect")).status, 422);
      assert.equal(owner.sandboxId, "old-sandbox");
      assert.equal(owner.lastDiff, original.lastDiff);
      assert.equal(owner.workspaceOperation, null);
      assert.deepEqual(killed, ["replacement-sandbox"]);
      assert.equal(checkpointWrites, 0);
      restoreFails = false;
    },
  );
  await t.test("database failure during adoption kills only the candidate sandbox", async () => {
    reset();
    updateFails = true;
    assert.equal(
      (await request("/checkpoints/checkpoint/restore", "POST", { confirmReplace: true })).status,
      500,
    );
    assert.equal(owner.sandboxId, "old-sandbox");
    assert.deepEqual(killed, ["replacement-sandbox"]);
    updateFails = false;
  });
  await t.test(
    "explicit restore adopts the selected checkpoint and fork creates its own session and durable copy",
    async () => {
      reset();
      assert.equal(
        (await request("/checkpoints/checkpoint/restore", "POST", { confirmReplace: true })).status,
        200,
      );
      assert.deepEqual(killed, ["old-sandbox"]);
      reset();
      const response = await request("/checkpoints/checkpoint/fork");
      assert.equal(response.status, 201);
      assert.equal(response.body.sessionId, "fork-session");
      assert.equal(owner.sandboxId, "old-sandbox");
      assert.equal(checkpointWrites, 1);
      assert.deepEqual(killed, []);
    },
  );
  await t.test("missing recovery checkpoint requires intentional fresh replacement", async () => {
    reset();
    checkpointExists = false;
    const response = await request("/reconnect");
    assert.equal(response.status, 409);
    assert.equal(response.body.code, "sandbox_reconnect_dirty");
    assert.equal(commands.length, 0);
    assert.deepEqual(killed, []);
  });
});
