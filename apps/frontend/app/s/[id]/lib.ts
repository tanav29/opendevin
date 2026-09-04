export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
export const WS_API = API.replace(/^http/, "ws");

export type SessionDetail = {
  id: string;
  title: string;
  status: string;
  sandboxId: string;
  sandboxStatus: string;
  workspacePath: string;
  branch: string;
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
  repo: string | null;
  branch: string;
  createdAt: string;
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
  project: { id: string; name: string };
};

export const PROVISIONING_SANDBOX = new Set(["pending", "creating", "cloning"]);

export function isWorking(status: string, sandboxStatus: string) {
  return status === "running" || PROVISIONING_SANDBOX.has(sandboxStatus);
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
