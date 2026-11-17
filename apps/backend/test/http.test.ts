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
    account: { findFirst: async () => ({ accessToken: "test-token" }) },
  };
  const globals = globalThis as unknown as { prisma?: unknown };
  const originalPrisma = globals.prisma;
  globals.prisma = prisma;
  t.after(() => {
    globals.prisma = originalPrisma;
  });
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalFrontendOrigins = process.env.FRONTEND_ORIGINS;
  process.env.FRONTEND_URL = "https://frontend.example/";
  process.env.FRONTEND_ORIGINS = "https://other.example";
  t.after(() => {
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
    if (originalFrontendOrigins === undefined) delete process.env.FRONTEND_ORIGINS;
    else process.env.FRONTEND_ORIGINS = originalFrontendOrigins;
  });
  const originalVercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  const { default: app } = await import("../src/index.js");
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
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

  const server = app.listen(0, "127.0.0.1");
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

  await t.test("accepts both configured frontend origins", async () => {
    for (const origin of ["https://frontend.example", "https://other.example"]) {
      const response = await fetch(`${base}/api/health`, { headers: { origin } });
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
    }
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
  await t.test("reports unavailable generation without preventing manual entry", async () => {
    const key = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const response = await request("/api/sessions/session/publish-metadata", { method: "POST" });
      assert.equal(response.status, 503);
      assert.match(response.body.error, /manually/);
    } finally {
      if (key !== undefined) process.env.OPENROUTER_API_KEY = key;
    }
  });
  await t.test(
    "publishes manual pull request details to the chosen base without a model",
    async () => {
      owner!.project = { repo: "https://github.com/example/repo", userId: "user" };
      owner!.branch = "feature";
      const originalFetch = globalThis.fetch;
      let posted: any;
      const fetchMock = t.mock.method(globalThis, "fetch", async (input, init) => {
        const url = String(input);
        if (!url.startsWith("https://api.github.com/")) return originalFetch(input, init);
        if (init?.method === "POST") {
          posted = JSON.parse(String(init.body));
          return Response.json(
            { html_url: "https://github.com/example/repo/pull/1", number: 1 },
            { status: 201 },
          );
        }
        assert.match(url, /base=release%2Fnext/);
        return Response.json([]);
      });
      const post = (body: unknown) =>
        request("/api/sessions/session/pull-request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      assert.equal(
        (await post({ title: "Manual title", body: "Manual body", base: "release/next" })).status,
        201,
      );
      assert.equal(posted.title, "Manual title");
      assert.match(posted.body, /^Manual body/);
      assert.equal(posted.base, "release/next");
      assert.equal((await post({ title: "x", body: "", base: "bad..branch" })).status, 400);
      assert.equal((await post({ title: "x\ny", body: "", base: "main" })).status, 400);
      fetchMock.mock.restore();
    },
  );
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
