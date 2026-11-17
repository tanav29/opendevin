import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Sandbox } from "e2b";

test("Express routes handle errors, ownership, and sandbox reconnects", async (t) => {
  let signedIn = false;
  let sandboxAvailable = false;
  let owner: Record<string, unknown> | null = null;
  let killed = 0;
  const updates: unknown[] = [];
  const prisma = {
    projectSession: {
      findFirst: async ({ where }: { where: { project: { userId: string } } }) => {
        assert.equal(where.project.userId, "user");
        return owner;
      },
      findUnique: async () => null,
      update: async ({ data }: { data: unknown }) => {
        updates.push(data);
        return owner;
      },
      updateMany: async () => ({ count: 1 }),
      create: async () => ({ id: "candidate" }),
      findUniqueOrThrow: async () => ({ sandboxId: "" }),
      delete: async () => ({}),
    },
    workspaceCheckpoint: { findFirst: async () => null },
    project: { findFirst: async () => null },
  };
  const globals = globalThis as unknown as { prisma?: unknown };
  const originalPrisma = globals.prisma;
  globals.prisma = prisma;
  t.after(() => {
    globals.prisma = originalPrisma;
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
    if (!sandboxAvailable) throw new Error("Sandbox unavailable");
    return { commands: { run: async () => ({ stdout: "/workspace" }) } };
  });
  t.mock.method(Sandbox, "kill", async () => {
    killed++;
  });

  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${base}${path}`, init);
    return { status: response.status, body: await response.json() };
  };
  const reconnect = (confirmReplace = false) =>
    request("/api/sessions/session/reconnect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmReplace }),
    });

  await t.test("keeps health public and removes the Bot API", async () => {
    assert.deepEqual(await request("/api/health"), { status: 200, body: { ok: true } });
    for (const path of ["/api/bot", "/api/bot/chat", "/api/bot/stop"]) {
      assert.equal(
        (await request(path, { method: path === "/api/bot" ? "GET" : "POST" })).status,
        404,
      );
    }
  });
  await t.test("returns JSON for malformed and oversized request bodies", async () => {
    for (const [body, status] of [
      ["{", 400],
      [JSON.stringify({ value: "x".repeat(1_100_000) }), 413],
    ] as const) {
      assert.equal(
        (
          await request("/api/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          })
        ).status,
        status,
      );
    }
  });
  await t.test("forwards rejected async ownership checks to JSON error middleware", async () => {
    assert.deepEqual(await request("/api/sessions/session"), {
      status: 401,
      body: { error: "Sign in required" },
    });
    signedIn = true;
    assert.deepEqual(await request("/api/sessions/session"), {
      status: 404,
      body: { error: "Session not found" },
    });
    assert.deepEqual(await request("/api/projects/project/sessions"), {
      status: 404,
      body: { error: "Project not found" },
    });
  });

  owner = {
    id: "session",
    sandboxId: "sandbox",
    sandboxStatus: "ready",
    status: "running",
    updatedAt: new Date(),
    projectId: "project",
    lastDiff: "diff --git a/file b/file",
    lastDiffAt: new Date("2026-09-25"),
  };
  await t.test(
    "requires confirmation before replacing a workspace with a saved patch",
    async () => {
      const response = await reconnect();
      assert.equal(response.status, 409);
      assert.equal(response.body.code, "sandbox_reconnect_dirty");
      assert.equal(response.body.patch.available, true);
      assert.equal(killed, 0);
    },
  );
  await t.test("also requires confirmation for a clean workspace", async () => {
    owner!.lastDiff = "";
    const response = await reconnect();
    assert.equal(response.status, 409);
    assert.equal(response.body.patch, null);
  });
  await t.test("reuses an available sandbox", async () => {
    sandboxAvailable = true;
    const response = await reconnect();
    assert.equal(response.status, 200);
    assert.equal(response.body.reattached, true);
    assert.equal(killed, 0);
  });
  await t.test("does not reuse a sandbox whose setup failed", async () => {
    owner!.sandboxStatus = "error";
    assert.equal((await reconnect()).status, 409);
  });
  await t.test("blocks replacement while an agent turn is active", async () => {
    const controller = claimAgentTurn("session", "chat")!;
    try {
      const response = await reconnect(true);
      assert.equal(response.status, 409);
      assert.equal(response.body.code, "agent_busy");
    } finally {
      releaseAgentTurn("session", controller);
    }
  });
  await t.test(
    "retains the old sandbox and recovery data when confirmed fresh provisioning fails",
    async () => {
      const response = await reconnect(true);
      assert.equal(response.status, 503);
      assert.equal(killed, 0);
      assert.equal(
        updates.some((data) => (data as { sandboxId?: string }).sandboxId === ""),
        false,
      );
    },
  );
});
