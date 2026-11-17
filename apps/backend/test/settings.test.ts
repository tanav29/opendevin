import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

test("settings are owned and recorded usage is honest", async (t) => {
  let signedIn = false;
  let model = "";
  let records = [
    { usage: '{"totalTokens":12}' },
    { usage: '{"totalTokens":8}' },
    { usage: "{}" },
    { usage: "bad" },
  ];
  const globals = globalThis as unknown as { prisma?: unknown };
  const original = globals.prisma;
  globals.prisma = {
    user: {
      findUniqueOrThrow: async ({ where }: any) => {
        assert.equal(where.id, "user");
        return { defaultModel: model };
      },
      findUnique: async ({ where }: any) => {
        assert.equal(where.id, "user");
        return { defaultModel: model };
      },
      update: async ({ where, data }: any) => {
        assert.equal(where.id, "user");
        model = data.defaultModel;
      },
    },
    project: {
      count: async ({ where }: any) => {
        assert.equal(where.userId, "user");
        return 2;
      },
      findFirst: async ({ where }: any) => {
        assert.equal(where.userId, "user");
        return { id: "project" };
      },
    },
    projectSession: {
      findMany: async ({ where }: any) => {
        assert.equal(where.project.userId, "user");
        return records;
      },
      create: async ({ data }: any) => {
        assert.equal(data.model, "anthropic/claude-sonnet-4");
        throw Object.assign(new Error("stop before provisioning"), { status: 409 });
      },
    },
    account: { findFirst: async () => null },
  };
  t.after(() => {
    globals.prisma = original;
  });
  const { createApp } = await import("../src/application.js");
  const { auth } = await import("../src/auth/auth.js");
  const descriptor = Object.getOwnPropertyDescriptor(auth, "api")!;
  Object.defineProperty(auth, "api", {
    configurable: true,
    value: { getSession: async () => (signedIn ? { user: { id: "user" } } : null) },
  });
  t.after(() => Object.defineProperty(auth, "api", descriptor));
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (path: string) => fetch(base + path);
  assert.equal((await get("/api/settings")).status, 401);
  assert.equal((await get("/api/settings/usage")).status, 401);
  signedIn = true;
  const save = (defaultModel: unknown) =>
    fetch(base + "/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultModel }),
    });
  assert.equal((await save("invalid")).status, 400);
  assert.equal((await save("anthropic/claude-sonnet-4")).status, 200);
  assert.equal(
    (await (await get("/api/settings")).json()).defaultModel,
    "anthropic/claude-sonnet-4",
  );
  assert.equal(
    (
      await fetch(base + "/api/projects/project/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Build", branch: "main" }),
      })
    ).status,
    409,
  );
  assert.deepEqual(await (await get("/api/settings/usage")).json(), {
    projects: 2,
    sessions: 4,
    recordedSessions: 2,
    tokens: 20,
  });
  records = [];
  assert.deepEqual(await (await get("/api/settings/usage")).json(), {
    projects: 2,
    sessions: 0,
    recordedSessions: 0,
    tokens: null,
  });
  assert.deepEqual(await (await get("/api/settings/github")).json(), { status: "disconnected" });
});
