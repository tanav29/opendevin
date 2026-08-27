"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery as useConvexQuery } from "convex/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConvexAuth } from "convex/react";
import { ConvexAuthProvider, useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { IconBrandGithub } from "@tabler/icons-react";
import { convex } from "@/lib/convex";
import { Button } from "@/components/ui/button";
import { api } from "@convex/_generated/api";

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
    // malformed transcript shouldn't break list
  }
  return session.git.split("/").pop()?.replace(/\.git$/, "") || "Untitled session";
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

// Centralized data hooks — single subscription per query, shared across the app.
// Consumers read from the same cache instead of opening duplicate Convex streams.
export function useSessions() {
  const raw = useConvexQuery(api.sessions.list, {});
  const sessions = useMemo(() => mapSessions(raw as unknown[] | undefined), [raw]);
  return { sessions, raw, loading: raw === undefined };
}

export function useProjects() {
  const raw = useConvexQuery(api.projects.list, {});
  const projects = useMemo(() => mapProjects(raw as unknown[] | undefined), [raw]);
  return { projects, raw, loading: raw === undefined };
}

export function useWorkspaceData() {
  const { sessions, loading: sessionsLoading } = useSessions();
  const { projects, loading: projectsLoading } = useProjects();
  return {
    sessions,
    projects,
    loading: sessionsLoading || projectsLoading,
    live: useMemo(() => sessions.filter((s) => !s.archived), [sessions]),
    archived: useMemo(() => sessions.filter((s) => s.archived), [sessions]),
  };
}

const SessionSelectionContext = createContext<{
  activeSessionId: string | null;
  selectSession: (id: string | null) => void;
} | null>(null);

function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  if (isLoading)
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
          <span className="size-3 animate-pulse rounded-full bg-brand" />
          Loading workspace…
        </div>
      </div>
    );
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
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => setActiveSessionId(window.localStorage.getItem("opendevin:active-session")));
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

export function useGitHubFetch() {
  const token = useAuthToken();
  return useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },
    [token],
  );
}

// Cached GitHub connection state — avoids firing /api/github/session on every mount.
export function useGitHubSession() {
  const githubFetch = useGitHubFetch();
  const [state, setState] = useState<{ connected: boolean; login?: string } | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void githubFetch("/api/github/session")
      .then((r) => r.json())
      .then((v) => {
        if (alive) setState(v as { connected: boolean; login?: string });
      })
      .catch(() => {
        if (alive) setState({ connected: false });
      });
    const params = new URLSearchParams(window.location.search);
    const status = params.get("github");
    if (status) window.history.replaceState({}, "", window.location.pathname);
    return () => {
      alive = false;
    };
  }, [githubFetch]);

  return state;
}

export function useSessionSelection() {
  const value = useContext(SessionSelectionContext);
  if (!value) throw new Error("useSessionSelection must be used inside AppProviders");
  return value;
}
