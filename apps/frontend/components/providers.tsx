"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConvexAuth } from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { IconBrandGithub } from "@tabler/icons-react";
import { convex } from "@/lib/convex";
import { Button } from "@/components/ui/button";

export type Session = {
  id: string;
  git: string;
  baseBranch?: string;
  status: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  sandbox?: string;
  cwd?: string;
  parts?: string;
  projectId?: string;
  // Linked after the first message reaches the eve runtime.
  eveSessionId?: string;
  title?: string;
  diff?: string;
  PRNumber?: number;
  prUrl?: string;
  publishRepository?: string;
  agentBranch?: string;
  commitSha?: string;
};

export type Project = {
  id: string;
  name: string;
  git: string;
  createdAt: string;
  updatedAt: string;
};

type StoredMessagePart = { type?: string; text?: string };
type StoredMessage = { role?: string; parts?: StoredMessagePart[] };

function firstMessageText(value: unknown): string | undefined {
  // Legacy rows store an array of UIMessage-like objects.
  if (Array.isArray(value)) {
    for (const message of value as StoredMessage[]) {
      if (message.role !== "user") continue;
      const text = message.parts
        ?.filter((part) => part.type === "text")
        .map((part) => part.text?.trim())
        .find(Boolean);
      if (text) return text;
    }
    return undefined;
  }
  // eve snapshots store { events, session }.
  const events = (value as { events?: unknown[] })?.events;
  if (!Array.isArray(events)) return undefined;
  for (const event of events) {
    const data = (event as { data?: { message?: unknown } })?.data;
    if ((event as { type?: string }).type === "message.received" && data) {
      if (typeof data.message === "string" && data.message.trim())
        return data.message.trim();
    }
  }
  return undefined;
}

export function sessionTitle(session: Session) {
  if (session.title?.trim()) return session.title;
  try {
    const text = firstMessageText(JSON.parse(session.parts ?? "[]"));
    if (text) return text;
  } catch {
    // A malformed stored transcript should not prevent the session list rendering.
  }
  return (
    session.git.split("/").pop()?.replace(/\.git$/, "") ||
    "Untitled session"
  );
}

function normalizeRecord(value: Record<string, unknown>, fallbackId: string) {
  const id = String(value.id ?? value._id ?? fallbackId);
  return {
    ...value,
    id,
    createdAt: new Date(Number(value.createdAt)).toISOString(),
    updatedAt: new Date(Number(value.updatedAt)).toISOString(),
  };
}

export function mapSessions(raw: unknown[] | undefined): Session[] {
  return (raw ?? []).map((session, index) =>
    normalizeRecord(session as Record<string, unknown>, `s-${index}`),
  ) as Session[];
}

export function mapProjects(raw: unknown[] | undefined): Project[] {
  return (raw ?? []).map((project, index) =>
    normalizeRecord(project as Record<string, unknown>, `p-${index}`),
  ) as Project[];
}

const SessionSelectionContext = createContext<{
  activeSessionId: string | null;
  selectSession: (id: string | null) => void;
} | null>(null);

function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  if (isLoading) return <div className="grid min-h-screen place-items-center text-[13px] text-muted-foreground">Loading workspace…</div>;
  if (isAuthenticated) return <>{children}</>;
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <div className="w-full max-w-sm rounded-xl border bg-surface-1 p-6 shadow-2xl shadow-black/10">
        <p className="eyebrow">OpenDevin</p>
        <h1 className="mt-2 text-xl font-medium tracking-[-0.02em]">Sign in to your workspace</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">Projects and sessions are private to your GitHub account.</p>
        <Button className="mt-5 w-full" onClick={() => void signIn("github")}>
          <IconBrandGithub /> Continue with GitHub
        </Button>
      </div>
    </div>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() =>
      setActiveSessionId(window.localStorage.getItem("opendevin:active-session")),
    );
  }, []);

  const selectSession = useCallback((id: string | null) => {
    setActiveSessionId(id);
    if (id) window.localStorage.setItem("opendevin:active-session", id);
    else window.localStorage.removeItem("opendevin:active-session");
  }, []);

  return (
    <ConvexAuthProvider client={convex}>
      <QueryClientProvider client={queryClient}>
        <SessionSelectionContext.Provider value={{ activeSessionId, selectSession }}>
          <AuthGate>{children}</AuthGate>
        </SessionSelectionContext.Provider>
      </QueryClientProvider>
    </ConvexAuthProvider>
  );
}

export function useSessionSelection() {
  const value = useContext(SessionSelectionContext);
  if (!value) throw new Error("useSessionSelection must be used inside AppProviders");
  return value;
}
