import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransition,
  getLifecycle,
  getProvisioningPhase,
  getVerificationPhase,
} from "../src/lifecycle.js";

test("reports an unreachable ready sandbox as unavailable", () => {
  assert.equal(getProvisioningPhase("ready", false), "unavailable");
  assert.equal(getProvisioningPhase("ready", true), "ready");
});

test("does not treat a stale running status as an active turn", () => {
  const lifecycle = getLifecycle({
    sandboxStatus: "ready",
    sandboxAvailable: true,
    status: "running",
    activeTurn: false,
    hasAssistant: false,
  });
  assert.equal(lifecycle.agent, "interrupted");
  assert.equal(lifecycle.activeTurn, false);
});

test("keeps continuity warnings out of verification failure", () => {
  assert.equal(getVerificationPhase("idle", false), "pending");
  assert.equal(getVerificationPhase("failed", false), "failed");
  assert.equal(getVerificationPhase("idle", true), "available");
});

test("allows the documented provisioning recovery transitions", () => {
  assert.equal(canTransition("provisioning", "pending", "creating"), true);
  assert.equal(canTransition("provisioning", "error", "creating"), true);
  assert.equal(canTransition("provisioning", "ready", "creating"), true);
  assert.equal(canTransition("provisioning", "ready", "cloning"), false);
});
