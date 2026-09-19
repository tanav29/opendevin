"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconPlus,
  IconGitBranch,
  IconTrash,
  IconFolder,
  IconTerminal,
  IconSettings,
} from "@tabler/icons-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, PageShell, PageContainer } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
import { ConfirmProvider, useConfirm } from "@/components/ui/confirm";
import { timeAgo, repoName } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GitBranch, Loader2 } from "lucide-react";

type Project = {
  id: string;
  repo: string;
  setupScript?: string;
  devCommand?: string;
  devPort?: number;
  envVars?: string;
};
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
  const [branchSearch, setBranchSearch] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [setupScript, setSetupScript] = useState("");
  const [devCommand, setDevCommand] = useState("");
  const [devPort, setDevPort] = useState("3000");
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [savingSetup, setSavingSetup] = useState(false);
  const [setupSaved, setSetupSaved] = useState("");
  const [savingEnv, setSavingEnv] = useState(false);
  const [envSaved, setEnvSaved] = useState("");
  const [configOpen, setConfigOpen] = useState(false);

  // Query data initializes the editable project form state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void params.then(({ projectId: id }) => {
      setProjectId(id);
    });
  }, [params]);

  const hasProvisioning = sessions.some(isProvisioning);
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<Project>(`/api/projects/${projectId}`),
    enabled: Boolean(projectId),
    retry: false,
  });
  const sessionsQuery = useQuery({
    queryKey: ["project-sessions", projectId],
    queryFn: () => api<ProjectSession[]>(`/api/projects/${projectId}/sessions`),
    enabled: Boolean(projectId),
    refetchInterval: hasProvisioning ? 3000 : false,
    retry: false,
  });
  const branchesQuery = useQuery({
    queryKey: ["project-branches", projectId],
    queryFn: () =>
      api<{ branches: string[]; defaultBranch: string }>(`/api/projects/${projectId}/branches`),
    enabled: Boolean(projectId),
    retry: false,
  });

  useEffect(() => {
    if (projectQuery.isError) setNotFound(true);
    if (projectQuery.data) {
      setProject(projectQuery.data);
      if (projectQuery.data.setupScript) setSetupScript(projectQuery.data.setupScript);
      if (projectQuery.data.devCommand) setDevCommand(projectQuery.data.devCommand);
      if (typeof projectQuery.data.devPort === "number") setDevPort(String(projectQuery.data.devPort));
      if (projectQuery.data.envVars) {
        try {
          const parsed = JSON.parse(projectQuery.data.envVars) as Record<string, string>;
          setEnvVars(Object.entries(parsed).map(([key, value]) => ({ key, value })));
        } catch {
          setEnvVars([]);
        }
      }
    }
    if (sessionsQuery.data) setSessions(sessionsQuery.data);
    if (branchesQuery.data) {
      setBranches(branchesQuery.data.branches);
      setBranch(branchesQuery.data.defaultBranch || "");
    }
    if (!projectQuery.isPending && !sessionsQuery.isPending && !branchesQuery.isPending) {
      setLoading(false);
    }
  }, [projectQuery.data, projectQuery.isError, projectQuery.isPending, sessionsQuery.data, sessionsQuery.isPending, branchesQuery.data, branchesQuery.isPending]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const filteredBranches = branches.filter((item) =>
    item.toLowerCase().includes(branchSearch.trim().toLowerCase()),
  );
  const branchToCreate = branchSearch.trim();
  const canCreateBranch =
    branchToCreate.length > 0 &&
    !branches.some((item) => item.toLowerCase() === branchToCreate.toLowerCase());

  async function createSession(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || !projectId || creating) return;
    const activeBranch = branch;
    setCreating(true);
    setError("");
    try {
      const data = await api<{ id: string }>(`/api/projects/${projectId}/sessions`, {
        method: "POST",
        body: JSON.stringify({ message: prompt.trim(), branch: activeBranch }),
      });
      window.location.href = `/s/${data.id}`;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create session");
      setCreating(false);
    }
  }

  async function saveEnvironment() {
    if (!projectId || savingEnv) return;
    setSavingEnv(true);
    setEnvSaved("");
    try {
      const data = await api<Project>(`/api/projects/${projectId}`, {
        method: "PUT",
        body: JSON.stringify({
          envVars: Object.fromEntries(
            envVars
              .map(({ key, value }) => [key.trim(), value] as const)
              .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)),
          ),
        }),
      });
      setProject(data);
      setEnvSaved("Saved for new sessions.");
    } catch (error) {
      setEnvSaved(error instanceof Error ? error.message : "Could not reach server.");
    } finally {
      setSavingEnv(false);
    }
  }

  async function saveProjectSetup() {
    if (!projectId || savingSetup) return;
    setSavingSetup(true);
    setSetupSaved("");
    try {
      const data = await api<Project>(`/api/projects/${projectId}`, {
        method: "PUT",
        body: JSON.stringify({ setupScript, devCommand, devPort: Number(devPort) || 3000 }),
      });
      setProject(data);
      setSetupSaved("Saved for new sessions.");
    } catch (error) {
      setSetupSaved(error instanceof Error ? error.message : "Could not reach server.");
    } finally {
      setSavingSetup(false);
    }
  }

  async function deleteProject() {
    if (!projectId || deleting) return;
    const ok = await confirm({
      title: "Delete project?",
      description:
        "This removes the project, all sessions, and their sandboxes. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api(`/api/projects/${projectId}`, { method: "DELETE" });
      window.location.href = "/";
    } catch {
      setError("Could not delete project.");
      setDeleting(false);
    }
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
            title={repoName(project.repo)}
            description={project.repo}
            actions={
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
                  <IconSettings className="size-4" /> Config
                </Button>
                <Button
                  variant="destructive"
                  size="icon-sm"
                  onClick={() => void deleteProject()}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="animate-spin" /> : <IconTrash />}
                </Button>
              </div>
            }
          />
        }
      >
        <PageContainer size="wide" className="py-6">
          <div className="mt-6">
            <form onSubmit={createSession} className="space-y-3 relative">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Inspect the repo and propose a plan…"
                rows={5}
                className="min-h-36 resize-none p-4"
              />
              <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 pb-3">
              {showBranchPicker && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center ">
                  <div className="min-w-0 flex-1">
                    <Select
                      value={branch}
                      onValueChange={(value) => {
                        if (!value) {
                          setBranch("");
                          setBranchSearch("");
                          return;
                        }
                        if (value.startsWith("__create__:")) {
                          const newBranch = value.slice("__create__:".length);
                          setBranch(newBranch);
                          setBranches((current) =>
                            current.includes(newBranch) ? current : [...current, newBranch],
                          );
                          setBranchSearch("");
                          return;
                        }
                        setBranch(value);
                        setBranchSearch("");
                      }}
                    >
                      <SelectTrigger className="border-0">
                        <GitBranch className="size-3" />
                        <SelectValue placeholder="Select a branch" />
                      </SelectTrigger>
                      <SelectContent>
                        <div className="p-1" onKeyDown={(event) => event.stopPropagation()}>
                          <Input
                            value={branchSearch}
                            onChange={(event) => setBranchSearch(event.target.value)}
                            placeholder="Search branches…"
                            className="h-7 text-xs"
                            onClick={(event) => event.stopPropagation()}
                          />
                        </div>
                        {filteredBranches.map((item) => (
                          <SelectItem key={item} value={item}>
                            {item}
                          </SelectItem>
                        ))}
                        {canCreateBranch && (
                          <SelectItem value={`__create__:${branchToCreate}`}>
                            <IconPlus className="size-3.5" />
                            Create branch “{branchToCreate}”
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              {error && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={creating || !prompt.trim()} variant={"outline"} size="sm">
                {creating ? <Loader2 className="animate-spin" /> : "New"}
              </Button>
              </div>
            </form>

            <Dialog open={configOpen} onOpenChange={setConfigOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Project config</DialogTitle>
                  <DialogDescription>Setup and environment used by new sessions.</DialogDescription>
                </DialogHeader>
                <div className="space-y-6">
                  <section className="space-y-3">
                    <div>
                      <h3 className="text-sm font-medium">Project setup</h3>
                      <p className="text-xs text-muted-foreground">Saved globally for this project.</p>
                    </div>
                    <div>
                      <Label>Setup script</Label>
                      <Textarea value={setupScript} onChange={(e) => setSetupScript(e.target.value)} placeholder="pnpm install" rows={2} className="mt-2 font-mono text-xs" />
                    </div>
                    <div className="flex gap-2">
                      <div className="min-w-0 flex-1"><Label>Dev command</Label><Input value={devCommand} onChange={(e) => setDevCommand(e.target.value)} placeholder="pnpm dev" className="mt-2 font-mono text-xs" /></div>
                      <div className="w-24 shrink-0"><Label>Port</Label><Input value={devPort} onChange={(e) => setDevPort(e.target.value)} inputMode="numeric" className="mt-2 font-mono text-xs" /></div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => void saveProjectSetup()} disabled={savingSetup}>
                        {savingSetup ? "Saving…" : "Save project setup"}
                      </Button>
                      {setupSaved && <span className="text-xs text-muted-foreground">{setupSaved}</span>}
                    </div>
                  </section>

                  <section className="space-y-3 border-t pt-4">
                    <div>
                      <h3 className="text-sm font-medium">Environment variables</h3>
                      <p className="text-xs text-muted-foreground">Available to setup scripts and dev servers in new sessions.</p>
                    </div>
                    <div className="space-y-2">
                      {envVars.map((item, index) => (
                        <div key={index} className="flex gap-2">
                          <Input value={item.key} onChange={(e) => setEnvVars((items) => items.map((current, i) => i === index ? { ...current, key: e.target.value } : current))} placeholder="KEY" className="font-mono text-xs" />
                          <Input value={item.value} onChange={(e) => setEnvVars((items) => items.map((current, i) => i === index ? { ...current, value: e.target.value } : current))} placeholder="value" className="font-mono text-xs" />
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEnvVars((items) => items.filter((_, i) => i !== index))} aria-label="Remove variable"><IconTrash className="size-3.5" /></Button>
                        </div>
                      ))}
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEnvVars((items) => [...items, { key: "", value: "" }])}>＋ Add variable</Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => void saveEnvironment()} disabled={savingEnv}>{savingEnv ? "Saving…" : "Save variables"}</Button>
                      {envSaved && <span className="text-xs text-muted-foreground">{envSaved}</span>}
                    </div>
                  </section>
                </div>
              </DialogContent>
            </Dialog>

            {/* Sessions */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-muted-foreground">Sessions</h2>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {sessions.length} total
                </span>
              </div>

              <div className="rounded-xl border overflow-hidden my-3">
                {sessions.length === 0 ? (
                  <EmptyState
                    icon={<IconTerminal className="size-4" />}
                    title="No sessions yet"
                    description="Give the agent a first task."
                  />
                ) : (
                  <div className="divide-y">
                    {sessions.map((session) => {
                      const provisioning = isProvisioning(session);
                      return (
                        <Link
                          key={session.id}
                          href={`/s/${session.id}`}
                          prefetch
                          className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
                        >
                          <StatusDot status={session.status} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium">{session.title}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {session.branch && (
                                <Badge
                                  variant="outline"
                                  className="h-5 px-1.5 font-mono text-[11px]"
                                >
                                  <IconGitBranch className="size-3" /> {session.branch}
                                </Badge>
                              )}
                              {provisioning ? (
                                <Badge variant="secondary" className="gap-1 text-[11px]">
                                  <span className="size-2 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
                                  Provisioning
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="font-mono text-[11px] capitalize"
                                >
                                  {session.status}
                                </Badge>
                              )}
                              <span className="font-mono text-[11px] text-muted-foreground">
                                · {timeAgo(session.updatedAt)}
                              </span>
                            </div>
                          </div>
                          <Badge
                            variant="outline"
                            className="hidden shrink-0 font-mono text-[11px] sm:inline-flex"
                          >
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
