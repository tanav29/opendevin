"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconFolder,
  IconPlus,
  IconSearch,
  IconTerminal,
  IconGitBranch,
  IconClock,
  IconArrowUpRight,
} from "@tabler/icons-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader, PageShell, PageContainer } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
import { timeAgo, repoName } from "@/lib/format";
import NewProjectForm from "@/components/new-project-dialog";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Project = {
  id: string;
  repo: string;
  updatedAt?: string;
  createdAt?: string;
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

function SignedOut({ onNewProject }: { onNewProject: () => void }) {
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
        <div className="mt-7 flex flex-wrap gap-2">
          <Button onClick={() => (window.location.href = "/login")}>Continue with GitHub</Button>
          <Button variant="outline" onClick={onNewProject}>Choose a repository</Button>
        </div>
      </div>
    </PageContainer>
  );
}

export default function Home() {
  const [q, setQ] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);

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
  const loading = projectsQuery.isPending;
  const signedIn = projectsQuery.isPending ? null : projectsQuery.isSuccess;

  const filteredProjects = useMemo(() => {
    if (!q.trim()) return projects;
    const needle = q.toLowerCase();
    return projects.filter(
      (p) => p.repo.toLowerCase().includes(needle),
    );
  }, [projects, q]);

  const filteredSessions = useMemo(() => {
    if (!q.trim()) return sessions.slice(0, 6);
    const needle = q.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(needle));
  }, [sessions, q]);

  const activeSessions = sessions.filter((s) => s.status === "running").length;

  if (signedIn === false) {
    return (
      <AppShell>
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
          <SignedOut onNewProject={() => setNewProjectOpen(true)} />
        </PageShell>
        <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a workspace</DialogTitle>
              <DialogDescription>Choose the repository for this workspace.</DialogDescription>
            </DialogHeader>
            <NewProjectForm onClose={() => setNewProjectOpen(false)} />
          </DialogContent>
        </Dialog>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageShell
        header={
          <PageHeader
            title="Dashboard"
            description={
              signedIn ? `${projects.length} projects · ${activeSessions} active` : "Loading…"
            }
            actions={
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden sm:inline-flex"
                  onClick={() => setNewProjectOpen(true)}
                >
                  <IconPlus className="size-4" /> New project
                </Button>
                <Button size="sm" className="sm:hidden" onClick={() => setNewProjectOpen(true)}>
                  <IconPlus className="size-4" />
                </Button>
              </div>
            }
          />
        }
      >
        <PageContainer size="wide" className="py-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-sm flex-1">
              <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter projects and sessions…"
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {loading ? "Loading workspace…" : `${projects.length} projects · ${activeSessions} active`}
            </p>
          </div>

          <div className="mt-10">
            {loading ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <Card key={i} className="p-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-2 h-3 w-48" />
                    <Skeleton className="mt-4 h-3 w-24" />
                  </Card>
                ))}
              </div>
            ) : filteredProjects.length === 0 ? (
              <Card className="mt-3">
                <EmptyState
                  icon={<IconFolder className="size-4" />}
                  title={projects.length === 0 ? "No projects yet" : "No matches"}
                  description={
                    projects.length === 0
                      ? "Choose a repository to create a workspace."
                      : `No projects match “${q}”.`
                  }
                  action={
                    projects.length === 0
                      ? {
                          label: "New project",
                          onClick: () => (window.location.href = "/new"),
                          icon: <IconPlus className="size-4" />,
                        }
                      : undefined
                  }
                />
              </Card>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {filteredProjects.map((p) => {
                  const count = sessions.filter((s) => s.projectId === p.id).length;
                  return (
                    <Link
                      key={p.id}
                      href={`/p/${p.id}`}
                      className="group rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="flex size-7 items-center justify-center rounded-md bg-muted">
                              <IconFolder className="size-3.5 text-muted-foreground" />
                            </span>
                            <h3 className="truncate text-[13px] font-medium">{repoName(p.repo)}</h3>
                          </div>
                          <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
                            {p.repo}
                          </p>
                        </div>
                        <IconArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                          <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                            <IconClock className="size-3" />
                          {p.updatedAt
                            ? timeAgo(p.updatedAt)
                            : p.createdAt
                              ? timeAgo(p.createdAt)
                              : "just now"}
                          </span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {count} {count === 1 ? "session" : "sessions"}
                        </span>
                        {p.repo && (
                          <span className="hidden items-center gap-1 font-mono text-[11px] text-muted-foreground sm:inline-flex">
                            <IconGitBranch className="size-3" />
                            repo
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-muted-foreground">
                Recent sessions
              </h2>
              <span className="font-mono text-[11px] text-muted-foreground">
                {sessions.length} total
              </span>
            </div>

            {loading ? (
              <div className="divide-y">
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
            ) : sessions.length === 0 ? (
              <div>
                <EmptyState
                  icon={<IconTerminal className="size-4" />}
                  title="No sessions yet"
                  description="Open a project and give the agent a first task."
                />
              </div>
            ) : (
              <div className="my-3 overflow-hidden rounded-lg border">
                {filteredSessions.map((s) => (
                  <Link
                    key={s.id}
                    href={`/s/${s.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
                  >
                    <StatusDot status={s.status} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{s.title}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {s.project?.repo ? repoName(s.project.repo) : "Repository"} {s.branch ? `· ${s.branch}` : ""} ·{" "}
                        {timeAgo(s.updatedAt)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="hidden font-mono text-[11px] sm:inline-flex"
                    >
                      {s.sandboxStatus}
                    </Badge>
                    <IconArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
                {filteredSessions.length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No sessions match “{q}”.
                  </div>
                )}
              </div>
            )}
          </div>
        </PageContainer>
      </PageShell>
      <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a workspace</DialogTitle>
            <DialogDescription>Choose the repository for this workspace.</DialogDescription>
          </DialogHeader>
          <NewProjectForm onClose={() => setNewProjectOpen(false)} />
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
