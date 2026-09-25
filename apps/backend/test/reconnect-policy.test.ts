import assert from "node:assert/strict";
import test from "node:test";
import { decideReconnect } from "../src/reconnect-policy.js";

test("reuses a healthy available sandbox even when a patch is saved", () => {
  assert.deepEqual(
    decideReconnect({
      sandboxAvailable: true,
      sandboxStatus: "ready",
      lastDiff: "diff --git a/file b/file",
      lastDiffAt: new Date("2026-09-25T00:00:00.000Z"),
      activeTurn: false,
    }),
    { action: "reuse", reason: "sandbox_available" },
  );
});

test("requires confirmation before replacing an unavailable clean workspace", () => {
  const decision = decideReconnect({
    sandboxAvailable: false,
    sandboxStatus: "ready",
    lastDiff: "  ",
    lastDiffAt: null,
    activeTurn: false,
  });
  assert.equal(decision.action, "conflict");
  if (decision.action !== "conflict") return;
  assert.equal(decision.code, "sandbox_reconnect_dirty");
  assert.equal(decision.patch, null);
});

test("replaces an unavailable clean workspace after explicit confirmation", () => {
  assert.deepEqual(
    decideReconnect({
      sandboxAvailable: false,
      sandboxStatus: "ready",
      lastDiff: "",
      lastDiffAt: null,
      activeTurn: false,
      confirmReplace: true,
    }),
    { action: "replace", reason: "confirmed_clean", continuity: "fresh-clone" },
  );
});

test("blocks replacement when a saved patch needs review", () => {
  const decision = decideReconnect({
    sandboxAvailable: false,
    sandboxStatus: "ready",
    lastDiff: "diff --git a/file b/file",
    lastDiffAt: new Date("2026-09-25T00:00:00.000Z"),
    activeTurn: false,
  });
  assert.equal(decision.action, "conflict");
  if (decision.action !== "conflict") return;
  assert.equal(decision.code, "sandbox_reconnect_dirty");
  assert.equal(decision.patch?.available, true);
  assert.equal(decision.patch?.reviewOnly, true);
  assert.match(decision.recovery, /Open Changes/);
});

test("allows an explicitly confirmed dirty replacement", () => {
  assert.deepEqual(
    decideReconnect({
      sandboxAvailable: false,
      sandboxStatus: "ready",
      lastDiff: "diff --git a/file b/file",
      lastDiffAt: null,
      activeTurn: false,
      confirmReplace: true,
    }),
    { action: "replace", reason: "confirmed_dirty", continuity: "fresh-clone" },
  );
});

test("does not reuse a reachable sandbox whose setup failed", () => {
  const decision = decideReconnect({
    sandboxAvailable: true,
    sandboxStatus: "error",
    lastDiff: "",
    lastDiffAt: null,
    activeTurn: false,
  });
  assert.equal(decision.action, "conflict");
  if (decision.action !== "conflict") return;
  assert.match(decision.error, /setup failed/i);
});

test("does not bypass the guard for an active turn", () => {
  const decision = decideReconnect({
    sandboxAvailable: false,
    sandboxStatus: "ready",
    lastDiff: "",
    lastDiffAt: null,
    activeTurn: true,
    confirmReplace: true,
  });
  assert.equal(decision.action, "conflict");
  if (decision.action !== "conflict") return;
  assert.equal(decision.code, "agent_busy");
});

test("does not deadlock on stale queued or running status", () => {
  const decision = decideReconnect({
    sandboxAvailable: false,
    sandboxStatus: "ready",
    lastDiff: "",
    lastDiffAt: null,
    activeTurn: false,
    confirmReplace: true,
  });
  assert.equal(decision.action, "replace");
});
