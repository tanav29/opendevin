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
import { ArrowUpRight, Command, GitBranch, LockKeyhole } from "lucide-react";
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
  envVars?: string;
  devCommand?: string;
  buildCommand?: string;
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
    <div className="relative min-h-screen overflow-hidden bg-background px-5 py-5 sm:px-8 sm:py-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,color-mix(in_oklab,var(--brand)_12%,transparent),transparent_30%),radial-gradient(circle_at_85%_82%,color-mix(in_oklab,var(--brand)_7%,transparent),transparent_28%)]" />
      <div className="relative mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-5xl flex-col justify-between rounded-2xl border border-white/[0.08] bg-surface-1/55 p-5 shadow-2xl shadow-black/20 backdrop-blur-sm sm:min-h-[calc(100vh-4rem)] sm:p-8">
        <header className="flex items-center justify-between">
          <button type="button" className="flex items-center gap-2 text-left" aria-label="OpenDevin home">
            <span className="grid size-7 place-items-center rounded-lg bg-foreground text-background shadow-sm">
              <Command className="size-3.5" />
            </span>
            <span className="text-[13px] font-semibold tracking-[-0.02em]">OpenDevin</span>
          </button>
          <span className="eyebrow hidden sm:block">Autonomous development workspace</span>
        </header>

        <main className="grid gap-12 py-16 lg:grid-cols-[1fr_360px] lg:items-center lg:gap-20 lg:py-20">
          <section className="max-w-xl animate-rise">
            <p className="eyebrow text-brand">Ship from intent</p>
            <h1 className="mt-4 max-w-lg text-4xl font-medium leading-[1.02] tracking-[-0.055em] sm:text-6xl">
              Your repository, with a second pair of hands.
            </h1>
            <p className="mt-6 max-w-md text-[15px] leading-7 text-muted-foreground sm:text-base">
              Give an agent a task. Review the work as it happens. Keep every session, diff, and decision close to the code.
            </p>
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-2"><GitBranch className="size-3.5 text-brand" /> Isolated sessions</span>
              <span className="inline-flex items-center gap-2"><LockKeyhole className="size-3.5 text-brand" /> Private by default</span>
            </div>
          </section>

          <section className="animate-rise rounded-xl border border-white/[0.1] bg-background/80 p-6 shadow-xl shadow-black/20 [animation-delay:100ms] sm:p-7">
            <p className="eyebrow">Open your workspace</p>
            <h2 className="mt-3 text-xl font-medium tracking-[-0.03em]">Sign in with GitHub</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">Your repositories and sessions stay tied to your GitHub account.</p>
            <Button className="mt-6 h-10 w-full justify-between px-3.5" onClick={() => void signIn("github")}>
              <span className="flex items-center gap-2"><IconBrandGithub className="size-4" /> Continue with GitHub</span>
              <ArrowUpRight className="size-3.5 opacity-60" />
            </Button>
            <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground/70">No password to remember. You can sign out any time.</p>
          </section>
        </main>

        <footer className="flex items-center justify-between border-t border-white/[0.08] pt-4 text-[11px] text-muted-foreground/65">
          <span>Build with focus.</span>
          <span className="mono">v0.1</span>
        </footer>
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
