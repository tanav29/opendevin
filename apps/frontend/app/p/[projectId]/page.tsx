"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  IconArrowLeft,
  IconPlus,
  IconGitBranch,
  IconTrash,
  IconFolder,
  IconClock,
  IconTerminal,
  IconBrandGithub,
} from "@tabler/icons-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, PageShell, PageContainer } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { StatusDot } from "@/components/ui/status-dot";
import { ConfirmProvider, useConfirm } from "@/components/ui/confirm";
import { timeAgo, repoName } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";


const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type Project = { id: string; name: string; repo: string | null };
type ProjectSession = {
  id: string;
  title: string;
  status: string;
  sandboxStatus: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
};

const PROVISIONING_SANDBOX = new Set(["pending", "creating", "cloning"]);

function isProvisioning(session: ProjectSession) {
  return session.status === "running" || PROVISIONING_SANDBOX.has(session.sandboxStatus);
}

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <ConfirmProvider>
      <ProjectPageInner params={params} />
    </ConfirmProvider>
  );
}

function ProjectPageInner({ params }: { params: Promise<{ projectId: string }> }) {
  const confirm = useConfirm();
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [customBranch, setCustomBranch] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadSessions = useCallback(async (id: string) => {
    const response = await fetch(`${API}/api/projects/${id}/sessions`, { credentials: "include" });
    if (response.ok) setSessions((await response.json()) as ProjectSession[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void params.then(({ projectId: id }) => {
      setProjectId(id);
      void Promise.all([
        fetch(`${API}/api/projects/${id}`, { credentials: "include" })
          .then((r) => {
            if (r.status === 404) return null;
            return r.ok ? r.json() : null;
          })
          .catch(() => null),
        fetch(`${API}/api/projects/${id}/sessions`, { credentials: "include" })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
        fetch(`${API}/api/projects/${id}/branches`, { credentials: "include" })
          .then((r) => (r.ok ? r.json() : { branches: [], defaultBranch: "" }))
          .catch(() => ({ branches: [], defaultBranch: "" })),
      ]).then(([nextProject, nextSessions, nextBranches]) => {
        if (cancelled) return;
        if (!nextProject) setNotFound(true);
        setProject(nextProject);
        setSessions(nextSessions);
        const list = Array.isArray(nextBranches.branches) ? nextBranches.branches : [];
        setBranches(list);
        setBranch(nextBranches.defaultBranch || "");
        setLoading(false);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  const hasProvisioning = sessions.some(isProvisioning);
  useEffect(() => {
    if (!projectId || !hasProvisioning) return;
    const timer = setInterval(() => void loadSessions(projectId), 3000);
    return () => clearInterval(timer);
  }, [projectId, hasProvisioning, loadSessions]);

  async function createSession(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || !projectId || creating) return;
    const activeBranch = customBranch.trim() || branch;
    setCreating(true);
    setError("");
    const response = await fetch(`${API}/api/projects/${projectId}/sessions`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt.trim(), branch: activeBranch }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "Could not create session");
      setCreating(false);
      return;
    }
    window.location.href = `/s/${data.id}`;
  }

  async function deleteProject() {
    if (!projectId || deleting) return;
    const ok = await confirm({
      title: "Delete project?",
      description: "This removes the project, all sessions, and their sandboxes. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    const response = await fetch(`${API}/api/projects/${projectId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      setError("Could not delete project.");
      setDeleting(false);
      return;
    }
    window.location.href = "/";
  }

  if (loading) {
    return (
      <AppShell>
        <PageShell header={<PageHeader title="Loading…" description="Workspace" />}>
          <PageContainer size="wide" className="py-8">
            <div className="animate-pulse space-y-6">
              <div className="h-9 w-48 rounded bg-muted" />
              <div className="h-4 w-64 rounded bg-muted" />
              <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
                <Skeleton className="h-64" />
              </div>
            </div>
          </PageContainer>
        </PageShell>
      </AppShell>
    );
  }

  if (notFound || !project) {
    return (
      <AppShell>
        <PageShell header={<PageHeader title="Not found" />}>
          <PageContainer className="py-16 text-center">
            <EmptyState
              icon={<IconFolder className="size-4" />}
              title="Project not found"
              description="It may have been deleted or you don't have access."
              action={{ label: "Back to dashboard", onClick: () => (window.location.href = "/") }}
            />
          </PageContainer>
        </PageShell>
      </AppShell>
    );
  }

  const showBranchPicker = Boolean(project.repo);

  return (
    <AppShell>
      <PageShell
        header={
          <PageHeader
            title={project.name}
            description={project.repo ? repoName(project.repo) : "Local workspace"}
            icon={<IconFolder className="size-4" />}
            actions={
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => void deleteProject()} disabled={deleting} className="text-muted-foreground hover:text-destructive">
                  <IconTrash className="size-4" /> <span className="hidden sm:inline">{deleting ? "Deleting…" : "Delete"}</span>
                </Button>
              </div>
            }
          />
        }
      >
        <PageContainer size="wide" className="py-6">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground">
              Dashboard
            </Link>
            <span>·</span>
            {project.repo && (
                <a href={project.repo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                  <IconBrandGithub className="size-3" /> {repoName(project.repo)} ↗
                </a>
            )}
          </div>

          <div className="mt-6">
            {/* New session */}
            <div className="lg:sticky lg:top-6 lg:self-start">

                  <form onSubmit={createSession} className="space-y-3">
                    <div>
                      <Textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Inspect the repo and propose a plan…"
                        rows={5}
                        className="mt-2 min-h-[110px] resize-none"
                      />
                    </div>

                    <div>
                    <Label className="mb-2 mt-4">Branch</Label>
                    {showBranchPicker && (
                      <div className="space-x-2 flex">
                          {branches.length > 0 ? (
                          <NativeSelect value={branch} onChange={(e) => setBranch(e.target.value)}>
                            <NativeSelectOption value="">Select a branch</NativeSelectOption>
                            {branches.map((b) => (
                              <NativeSelectOption key={b} value={b}>{b}</NativeSelectOption>
                            ))}
                          </NativeSelect>
                        ) : (
                          <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Default branch (e.g. main)" />
                        )}
                        <Input value={customBranch} onChange={(e) => setCustomBranch(e.target.value)} placeholder="Or type a new branch name" />
                      </div>
                      )}
                      </div>

                    {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

                    <Button type="submit" disabled={creating || !prompt.trim()} className="w-full">
                      {creating ? "Opening sandbox…" : "New session"}
                    </Button>
                  </form>
            </div>

            {/* Sessions */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-muted-foreground">Sessions</h2>
                <span className="font-mono text-[11px] text-muted-foreground">{sessions.length} total</span>
              </div>

              <div className="rounded-xl border overflow-hidden my-3">
                {sessions.length === 0 ? (
                  <EmptyState
                    icon={<IconTerminal className="size-4" />}
                    title="No sessions yet"
                    description="Give the agent a first task. It will clone the repo (if any) and start reading the codebase."
                  />
                ) : (
                  <div className="divide-y">
                    {sessions.map((session) => {
                      const provisioning = isProvisioning(session);
                      return (
                        <Link key={session.id} href={`/s/${session.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                          <StatusDot status={session.status} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium">{session.title}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {session.branch && (
                                <Badge variant="outline" className="h-5 px-1.5 font-mono text-[11px]">
                                  <IconGitBranch className="size-3" /> {session.branch}
                                </Badge>
                              )}
                              {provisioning ? (
                                <Badge variant="secondary" className="gap-1 text-[11px]">
                                  <span className="size-2 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
                                  Provisioning
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="font-mono text-[11px] capitalize">
                                  {session.status}
                                </Badge>
                              )}
                              <span className="font-mono text-[11px] text-muted-foreground">· {timeAgo(session.updatedAt)}</span>
                            </div>
                          </div>
                          <Badge variant="outline" className="hidden shrink-0 font-mono text-[11px] sm:inline-flex">
                            {session.sandboxStatus}
                          </Badge>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </PageContainer>
      </PageShell>
    </AppShell>
  );
}
