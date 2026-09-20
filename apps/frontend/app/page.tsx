"use client";

import { useQuery } from "@tanstack/react-query";
import { IconTerminal } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { PageHeader, PageShell, PageContainer } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import TaskForm from "@/components/task-form";
import { api } from "@/lib/api";
import { SessionSummary } from "@/components/session-summary";

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
    <PageContainer size="wide" className="py-12 sm:py-20">
      <div className="max-w-xl">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Developer workspace
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
          Ship from the first prompt.
        </h1>
        <p className="mt-4 max-w-md text-[15px] leading-6 text-muted-foreground">
          OpenDevin reads, edits, and runs your code in an isolated session.
        </p>
        <div className="mt-7">
          <Button onClick={() => (window.location.href = "/login")}>Continue with GitHub</Button>
        </div>
      </div>
    </PageContainer>
  );
}

export default function Home() {
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/api/projects"),
    retry: false,
  });
  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<Session[]>("/api/sessions"),
    retry: false,
  });
  const projects = projectsQuery.data ?? EMPTY_PROJECTS;
  const sessions = sessionsQuery.data ?? EMPTY_SESSIONS;
  const loading = projectsQuery.isPending || sessionsQuery.isPending;
  const signedIn = projectsQuery.isPending ? null : projectsQuery.isSuccess;
  const recent = sessions.slice(0, 5);

  if (signedIn === false) {
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

  return (
    <PageShell header={<PageHeader title="Home" />}>
      <PageContainer size="wide" className="py-8">
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
                <SessionSummary key={s.id} href={`/s/${s.id}`} showRepo session={s} />
              ))}
            </div>
          )}
        </div>
      </PageContainer>
    </PageShell>
  );
}
