"use client";

import { useQuery } from "@tanstack/react-query";
import { IconTerminal } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { PageHeader, PageShell, PageContainer } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import TaskForm from "@/components/task-form";
import { ApiErrorState } from "@/components/api-error-state";
import { api } from "@/lib/api";
import { useSession } from "@/hooks/use-session";
import { SessionSummary } from "@/components/session-summary";
import Link from "next/link";
import {
  IconArrowUpRight,
  IconBrandGithub,
  IconCheck,
  IconCode,
  IconCommand,
  IconFileCode,
  IconGitBranch,
  IconRefresh,
  IconSparkles,
  IconTerminal2,
} from "@tabler/icons-react";

type Project = {
  id: string;
  repo: string;
};
type Session = {
  id: string;
  title: string;
  status: string;
  sandboxStatus: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  project?: { id: string; repo: string };
};

const EMPTY_PROJECTS: Project[] = [];
const EMPTY_SESSIONS: Session[] = [];

function SignedOut() {
  return (
    <main className="landing fixed inset-0 z-50 overflow-y-auto">
      <div className="landing-grid" aria-hidden="true" />
      <nav className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="OpenDevin home">
          <span className="landing-mark">
            <IconCode size={18} stroke={2.3} />
          </span>
          <span>
            opendevin<span className="brand-period">.</span>
          </span>
        </Link>
        <div className="hidden items-center gap-8 text-[13px] font-medium text-[#66665f] sm:flex">
          <a href="#workflow">How it works</a>
          <a href="#workspace">The workspace</a>
        </div>
        <Link className="landing-nav-cta" href="/login">
          Sign in <IconArrowUpRight size={15} />
        </Link>
      </nav>

      <section className="landing-hero">
        <div className="hero-copy">
          <div className="landing-eyebrow">
            <span className="eyebrow-dot" /> YOUR NEXT PAIR PROGRAMMER
          </div>
          <h1>
            Make your repo
            <br />
            the <em>starting point.</em>
          </h1>
          <p className="hero-description">
            Give an agent a task. OpenDevin gets to know your code, makes the change, and runs it in
            a real development environment.
          </p>
          <div className="hero-actions">
            <Link href="/login" className="primary-cta">
              <IconBrandGithub size={17} /> Get started with GitHub <IconArrowUpRight size={16} />
            </Link>
            <a href="#workflow" className="text-cta">
              Take a look around <span>↓</span>
            </a>
          </div>
          <div className="hero-note">
            <IconCheck size={14} /> Your code stays in an isolated workspace
          </div>
        </div>

        <div className="workspace-wrap" id="workspace">
          <div className="workspace-glow" />
          <div className="workspace-window">
            <div className="window-bar">
              <div className="window-dots">
                <i />
                <i />
                <i />
              </div>
              <div className="window-path">
                <IconGitBranch size={13} /> feature/checkout-flow
              </div>
              <div className="window-live">
                <span /> LIVE SESSION
              </div>
            </div>
            <div className="workspace-body">
              <aside className="workspace-rail">
                <div className="rail-logo">
                  <IconCode size={15} />
                </div>
                <span className="rail-item active">
                  <IconSparkles size={16} />
                </span>
                <span className="rail-item">
                  <IconFileCode size={16} />
                </span>
                <span className="rail-item">
                  <IconTerminal2 size={16} />
                </span>
              </aside>
              <div className="workspace-main">
                <div className="session-heading">
                  <div>
                    <span className="session-kicker">SESSION / 04</span>
                    <h3>Add a checkout confirmation</h3>
                  </div>
                  <span className="running-pill">
                    <span /> Running
                  </span>
                </div>
                <div className="task-card">
                  <span className="task-label">
                    <IconCommand size={13} /> YOUR TASK
                  </span>
                  <p>
                    Show a clear confirmation after checkout, including the order number and a link
                    back to the shop.
                  </p>
                </div>
                <div className="agent-row">
                  <div className="agent-avatar">
                    <IconSparkles size={14} />
                  </div>
                  <div>
                    <b>OpenDevin</b>
                    <span>
                      Found the checkout route. I’m adding a confirmation view and checking the
                      existing order flow.
                    </span>
                  </div>
                </div>
                <div className="change-card">
                  <div className="change-head">
                    <span>CHANGES</span>
                    <span className="change-count">2 files</span>
                  </div>
                  <div className="file-row">
                    <IconFileCode size={14} />
                    <span>app/checkout/success.tsx</span>
                    <b>+38</b>
                  </div>
                  <div className="file-row">
                    <IconFileCode size={14} />
                    <span>app/checkout/page.tsx</span>
                    <b>+6</b>
                  </div>
                </div>
                <div className="terminal-line">
                  <span className="terminal-prompt">›</span>
                  <span>pnpm test checkout</span>
                  <span className="terminal-ok">
                    <IconCheck size={12} /> 12 passed
                  </span>
                </div>
                <div className="composer">
                  <span>Ask for a change or give a follow-up task...</span>
                  <span className="composer-send">↑</span>
                </div>
              </div>
            </div>
            <div className="window-footer">
              <span>
                <i /> Environment ready
              </span>
              <span>
                ~/storefront <span className="footer-divider">·</span> main
              </span>
            </div>
          </div>
          <div className="preview-caption">
            <span className="caption-line" /> A real workspace, from first prompt to passing tests
          </div>
        </div>
      </section>

      <section className="workflow" id="workflow">
        <div className="workflow-intro">
          <span>FROM IDEA TO PATCH</span>
          <p>One focused workspace for the work between “what if” and “it works.”</p>
        </div>
        <div className="workflow-steps">
          <article>
            <span className="step-icon">
              <IconBrandGithub size={17} />
            </span>
            <div>
              <h2>Bring your repo</h2>
              <p>Connect a GitHub project and start in a clean, isolated environment.</p>
            </div>
          </article>
          <article>
            <span className="step-icon">
              <IconCommand size={17} />
            </span>
            <div>
              <h2>Describe the change</h2>
              <p>
                Talk through the task in plain language. Keep the context and decisions together.
              </p>
            </div>
          </article>
          <article>
            <span className="step-icon">
              <IconTerminal2 size={17} />
            </span>
            <div>
              <h2>Run it, review it</h2>
              <p>Inspect the code, use the terminal, and see the app as it comes together.</p>
            </div>
          </article>
        </div>
      </section>
      <footer className="landing-footer">
        <Link href="/" className="landing-brand">
          <span className="landing-mark">
            <IconCode size={15} />
          </span>
          <span>
            opendevin<span className="brand-period">.</span>
          </span>
        </Link>
        <span>Built for the messy middle of making software.</span>
        <Link href="/login">
          Start a session <IconArrowUpRight size={14} />
        </Link>
      </footer>
    </main>
  );
}

function AuthChecking() {
  return (
    <main className="fixed inset-0 z-50 flex items-center justify-center bg-background px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-5 flex size-11 items-center justify-center rounded-xl border bg-card shadow-sm">
          <IconCode className="size-5 text-muted-foreground" />
        </div>
        <p className="font-serif text-lg font-medium">OpenDevin</p>
        <p className="mt-2 text-sm text-muted-foreground">Checking your session…</p>
        <div className="mt-5 h-1 w-24 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-foreground" />
        </div>
      </div>
    </main>
  );
}

function AuthUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="fixed inset-0 z-50 flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm text-center">
        <div className="mb-5 flex size-11 items-center justify-center rounded-xl border bg-card shadow-sm">
          <IconCode className="size-5 text-muted-foreground" />
        </div>
        <h1 className="font-serif text-lg font-medium">OpenDevin is temporarily unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          We couldn&apos;t verify your session. Check your connection and try again.
        </p>
        <Button className="mt-5" size="sm" variant="outline" onClick={onRetry}>
          <IconRefresh className="size-4" /> Try again
        </Button>
      </div>
    </main>
  );
}

export default function Home() {
  const auth = useSession();
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/api/projects"),
    enabled: auth.status === "signed-in",
    retry: false,
  });
  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<Session[]>("/api/sessions"),
    enabled: auth.status === "signed-in",
    retry: false,
  });
  const projects = projectsQuery.data ?? EMPTY_PROJECTS;
  const sessions = sessionsQuery.data ?? EMPTY_SESSIONS;
  const loading =
    auth.status === "signed-in" && (projectsQuery.isPending || sessionsQuery.isPending);
  const hasWorkspaceData = projectsQuery.data !== undefined || sessionsQuery.data !== undefined;
  const workspaceError = projectsQuery.error || sessionsQuery.error;
  const recent = sessions.slice(0, 5);

  if (auth.status === "checking") return <AuthChecking />;
  if (auth.status === "unavailable") {
    return <AuthUnavailable onRetry={() => void auth.refetch()} />;
  }
  if (auth.status === "signed-out") {
    return (
      <PageShell
        header={
          <PageHeader
            title="OpenDevin"
            description="Developer workspace"
            actions={
              <Button size="sm" onClick={() => (window.location.href = "/login")}>
                Sign in
              </Button>
            }
          />
        }
      >
        <SignedOut />
      </PageShell>
    );
  }

  if ((projectsQuery.isError || sessionsQuery.isError) && !hasWorkspaceData) {
    return (
      <PageShell header={<PageHeader title="Home" />}>
        <PageContainer size="wide" className="py-8">
          <ApiErrorState
            error={workspaceError}
            title="Your workspace could not be loaded"
            description="The API is unavailable or the request failed. Retry before starting another task."
            onRetry={() => {
              void projectsQuery.refetch();
              void sessionsQuery.refetch();
            }}
          />
        </PageContainer>
      </PageShell>
    );
  }

  return (
    <PageShell header={<PageHeader title="Home" />}>
      <PageContainer size="wide" className="py-8">
        {(projectsQuery.isError || sessionsQuery.isError) && (
          <ApiErrorState
            error={workspaceError}
            title="Workspace data could not be refreshed"
            description="The last loaded data is shown. Retry before starting another task."
            onRetry={() => {
              void projectsQuery.refetch();
              void sessionsQuery.refetch();
            }}
            className="mb-6"
          />
        )}
        <TaskForm projects={projects} />

        <div className="mt-8">
          <h2 className="text-xs font-medium text-muted-foreground">Recent</h2>
          {loading ? (
            <div className="mt-3 divide-y rounded-lg border">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center justify-between p-4">
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          ) : recent.length === 0 ? (
            <div className="mt-3 rounded-lg border">
              <EmptyState
                icon={<IconTerminal className="size-4" />}
                title="No sessions yet"
                description="Run your first task above."
              />
            </div>
          ) : (
            <div className="mt-3 divide-y overflow-hidden rounded-lg border">
              {recent.map((s) => (
                <SessionSummary
                  key={s.id}
                  href={`/s/${s.id}`}
                  showRepo
                  session={{ ...s, repo: s.project?.repo }}
                />
              ))}
            </div>
          )}
        </div>
      </PageContainer>
    </PageShell>
  );
}
