export type ReconnectPatch = {
  available: boolean;
  capturedAt: string | null;
  reviewOnly: boolean;
  bytes: number;
};

export type ReconnectDecision =
  | { action: "reuse"; reason: "sandbox_available" }
  | {
      action: "replace";
      reason: "confirmed_clean" | "confirmed_dirty" | "confirmed_setup_failure";
      continuity: "fresh-clone";
    }
  | {
      action: "conflict";
      code: "agent_busy" | "sandbox_reconnect_dirty";
      error: string;
      recoverable: boolean;
      patch: ReconnectPatch | null;
      recovery: string;
    };

export function decideReconnect(input: {
  sandboxAvailable: boolean;
  sandboxStatus?: string;
  lastDiff: string | null;
  lastDiffAt: string | Date | null;
  activeTurn: boolean;
  confirmReplace?: boolean;
}): ReconnectDecision {
  const patchBytes = input.lastDiff?.trim().length ?? 0;
  const patch: ReconnectPatch = {
    available: patchBytes > 0,
    capturedAt: input.lastDiffAt ? new Date(input.lastDiffAt).toISOString() : null,
    reviewOnly: patchBytes > 0,
    bytes: patchBytes,
  };

  // The in-memory reservation is authoritative. Persisted queued/running values
  // can be stale after a restart and must not deadlock recovery.
  if (input.activeTurn) {
    return {
      action: "conflict",
      code: "agent_busy",
      error: "Stop the active agent turn before reconnecting the sandbox.",
      recoverable: false,
      patch: patch.available ? patch : null,
      recovery: "Stop the agent turn, then retry reconnect.",
    };
  }

  const setupFailed = input.sandboxStatus === "error";
  if (input.sandboxAvailable && !setupFailed) {
    return { action: "reuse", reason: "sandbox_available" };
  }

  if (input.confirmReplace !== true) {
    return {
      action: "conflict",
      code: "sandbox_reconnect_dirty",
      error: setupFailed
        ? "The sandbox setup failed. A fresh sandbox is required; the previous workspace will not be restored."
        : patch.available
          ? "The sandbox is unavailable and this session has a saved patch. Review or download it before replacing the workspace."
          : "The sandbox is unavailable. A fresh sandbox cannot restore the previous workspace, so replacement requires confirmation.",
      recoverable: true,
      patch: patch.available ? patch : null,
      recovery: patch.available
        ? "Open Changes to review or download the review-only patch, then explicitly create a fresh sandbox."
        : "Explicitly create a fresh sandbox to continue.",
    };
  }

  return {
    action: "replace",
    reason: setupFailed
      ? "confirmed_setup_failure"
      : patch.available
        ? "confirmed_dirty"
        : "confirmed_clean",
    continuity: "fresh-clone",
  };
}
