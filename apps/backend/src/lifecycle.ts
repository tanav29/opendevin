export const PROVISIONING_PHASES = [
  "pending",
  "creating",
  "cloning",
  "setting-up",
  "ready",
  "error",
] as const;
export type PersistedProvisioningPhase = (typeof PROVISIONING_PHASES)[number];
export type ProvisioningPhase = PersistedProvisioningPhase | "unavailable";

export const AGENT_PHASES = [
  "queued",
  "running",
  "idle",
  "stopped",
  "failed",
  "interrupted",
] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];

export const VERIFICATION_PHASES = ["pending", "available", "failed", "stopped"] as const;
export type VerificationPhase = (typeof VERIFICATION_PHASES)[number];

export type TurnKind = "initial" | "chat";

export type LifecycleState = {
  provisioning: ProvisioningPhase;
  agent: AgentPhase;
  verification: VerificationPhase;
  activeTurn: boolean;
  turnKind: TurnKind | null;
};

const PROVISIONING_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["creating", "error"],
  creating: ["creating", "cloning", "setting-up", "ready", "error"],
  cloning: ["setting-up", "ready", "error"],
  "setting-up": ["ready", "error"],
  ready: ["creating", "error"],
  error: ["creating"],
};

const AGENT_TRANSITIONS: Record<string, readonly string[]> = {
  queued: ["running", "stopped", "failed"],
  running: ["idle", "stopped", "failed"],
  idle: ["queued", "running", "stopped", "failed"],
  stopped: ["queued", "running"],
  failed: ["queued", "running"],
  interrupted: ["queued", "running", "failed"],
};

export function canTransition(kind: "provisioning" | "agent", from: string, to: string): boolean {
  const transitions = kind === "provisioning" ? PROVISIONING_TRANSITIONS : AGENT_TRANSITIONS;
  return transitions[from]?.includes(to) ?? false;
}

export function getProvisioningPhase(
  sandboxStatus: string,
  sandboxAvailable: boolean,
): ProvisioningPhase {
  if (sandboxStatus === "error") return "error";
  if (sandboxStatus === "ready") return sandboxAvailable ? "ready" : "unavailable";
  if ((PROVISIONING_PHASES as readonly string[]).includes(sandboxStatus)) {
    return sandboxStatus as PersistedProvisioningPhase;
  }
  return "error";
}

export function getAgentPhase(status: string, activeTurn: boolean): AgentPhase {
  if (activeTurn) return "running";
  if (status === "running") return "interrupted";
  if ((AGENT_PHASES as readonly string[]).includes(status)) return status as AgentPhase;
  return "failed";
}

export function getVerificationPhase(agent: AgentPhase, hasAssistant: boolean): VerificationPhase {
  if (agent === "stopped") return "stopped";
  if (agent === "failed" || agent === "interrupted") return "failed";
  if (hasAssistant) return "available";
  return "pending";
}

export function getLifecycle(input: {
  sandboxStatus: string;
  sandboxAvailable: boolean;
  status: string;
  activeTurn: boolean;
  turnKind?: TurnKind | null;
  hasAssistant: boolean;
}): LifecycleState {
  const provisioning = getProvisioningPhase(input.sandboxStatus, input.sandboxAvailable);
  const agent = getAgentPhase(input.status, input.activeTurn);
  return {
    provisioning,
    agent,
    verification: getVerificationPhase(agent, input.hasAssistant),
    activeTurn: input.activeTurn,
    turnKind: input.turnKind ?? null,
  };
}
