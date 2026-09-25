export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
export const WS_API = API.replace(/^http/, "ws");

export type ProvisioningPhase =
  | "pending"
  | "creating"
  | "cloning"
  | "setting-up"
  | "ready"
  | "error"
  | "unavailable";
export type AgentPhase = "queued" | "running" | "idle" | "stopped" | "failed" | "interrupted";
export type VerificationPhase = "pending" | "available" | "failed" | "stopped";
export type LifecycleState = {
  provisioning: ProvisioningPhase;
  agent: AgentPhase;
  verification: VerificationPhase;
  activeTurn: boolean;
  turnKind: "initial" | "chat" | null;
};

export type SessionDetail = {
  id: string;
  title: string;
  status: string;
  sandboxId: string;
  sandboxStatus: string;
  workspacePath: string;
  branch: string;
  model: string;
  plan: string;
  usage: string;
  lastError: string | null;
  projectId: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionStatus = {
  sandboxStatus: string;
  sandboxAvailable: boolean;
  sandboxId: string;
  workspacePath: string;
  lastError: string | null;
  status: string;
  lifecycle: LifecycleState;
  repo: string | null;
  branch: string;
  createdAt: string;
  model: string;
  plan: { title: string; status: string }[];
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  devCommand?: string;
  devPort?: number;
};

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string };

export type SidebarSession = {
  id: string;
  title: string;
  status: string;
  sandboxStatus: string;
  branch: string;
  updatedAt: string;
  projectId: string;
  project: { id: string; repo: string };
};

export const PROVISIONING_SANDBOX = new Set(["pending", "creating", "cloning", "setting-up"]);

export function isWorking(status: string, sandboxStatus: string, agent?: AgentPhase) {
  return (
    status === "running" ||
    status === "queued" ||
    agent === "running" ||
    agent === "queued" ||
    PROVISIONING_SANDBOX.has(sandboxStatus)
  );
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
