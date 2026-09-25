"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconTrash, IconFolder, IconTerminal, IconSettings } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { ApiErrorState, isNotFoundError } from "@/components/api-error-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, PageShell, PageContainer } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmProvider, useConfirm } from "@/components/ui/confirm";
import { repoName } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import TaskForm from "@/components/task-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { SessionSummary } from "@/components/session-summary";
import { toast } from "sonner";

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

const PROVISIONING_SANDBOX = new Set(["pending", "creating", "cloning", "setting-up"]);

function isProvisioning(session: ProjectSession) {
  return (
    session.status === "running" ||
    session.status === "queued" ||
    PROVISIONING_SANDBOX.has(session.sandboxStatus)
  );
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

  useEffect(() => {
    if (projectQuery.isError) setNotFound(isNotFoundError(projectQuery.error));
    if (projectQuery.data) {
      setNotFound(false);
      setProject(projectQuery.data);
      if (projectQuery.data.setupScript) setSetupScript(projectQuery.data.setupScript);
      if (projectQuery.data.devCommand) setDevCommand(projectQuery.data.devCommand);
      if (typeof projectQuery.data.devPort === "number")
        setDevPort(String(projectQuery.data.devPort));
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
    if (!projectQuery.isPending && !sessionsQuery.isPending) {
      setLoading(false);
    }
  }, [
    projectQuery.data,
    projectQuery.error,
    projectQuery.isError,
    projectQuery.isPending,
    sessionsQuery.data,
    sessionsQuery.isPending,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
      toast.error(error instanceof Error ? error.message : "Could not reach server.");
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
      toast.error(error instanceof Error ? error.message : "Could not reach server.");
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
      toast.error("Could not delete project.");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <PageShell header={<PageHeader title="Loading…" />}>
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
    );
  }

  if (projectQuery.isError && !notFound && !project) {
    return (
      <PageShell header={<PageHeader title="Project unavailable" />}>
        <PageContainer size="wide" className="py-8">
          <ApiErrorState
            error={projectQuery.error}
            title="Project could not be loaded"
            description="The API is unavailable or the request failed. Retry before starting a task."
            onRetry={() => {
              void projectQuery.refetch();
              void sessionsQuery.refetch();
            }}
          />
        </PageContainer>
      </PageShell>
    );
  }

  if (notFound || !project) {
    return (
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
    );
  }

  return (
    <PageShell
      header={
        <PageHeader
          title={repoName(project.repo)}
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
        {projectQuery.isError && (
          <ApiErrorState
            error={projectQuery.error}
            title="Project data could not be refreshed"
            description="The last loaded configuration is shown. Retry before starting a task."
            onRetry={() => {
              void projectQuery.refetch();
              void sessionsQuery.refetch();
            }}
            className="mb-6"
          />
        )}
        <div className="mt-6">
          <TaskForm
            projects={[{ id: project.id, repo: project.repo }]}
            initialProjectId={project.id}
          />

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
                    <p className="text-xs text-muted-foreground">
                      Saved globally for this project.
                    </p>
                  </div>
                  <div>
                    <Label>Setup script</Label>
                    <Textarea
                      value={setupScript}
                      onChange={(e) => setSetupScript(e.target.value)}
                      placeholder="pnpm install"
                      rows={2}
                      className="mt-2 font-mono text-xs"
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <Label>Dev command</Label>
                      <Input
                        value={devCommand}
                        onChange={(e) => setDevCommand(e.target.value)}
                        placeholder="pnpm dev"
                        className="mt-2 font-mono text-xs"
                      />
                    </div>
                    <div className="w-24 shrink-0">
                      <Label>Port</Label>
                      <Input
                        value={devPort}
                        onChange={(e) => setDevPort(e.target.value)}
                        inputMode="numeric"
                        className="mt-2 font-mono text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void saveProjectSetup()}
                      disabled={savingSetup}
                    >
                      {savingSetup ? "Saving…" : "Save project setup"}
                    </Button>
                    {setupSaved && (
                      <span className="text-xs text-muted-foreground">{setupSaved}</span>
                    )}
                  </div>
                </section>

                <section className="space-y-3 border-t pt-4">
                  <div>
                    <h3 className="text-sm font-medium">Environment variables</h3>
                    <p className="text-xs text-muted-foreground">
                      Available to setup scripts and dev servers in new sessions.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {envVars.map((item, index) => (
                      <div key={index} className="flex gap-2">
                        <Input
                          value={item.key}
                          onChange={(e) =>
                            setEnvVars((items) =>
                              items.map((current, i) =>
                                i === index ? { ...current, key: e.target.value } : current,
                              ),
                            )
                          }
                          placeholder="KEY"
                          className="font-mono text-xs"
                        />
                        <Input
                          value={item.value}
                          onChange={(e) =>
                            setEnvVars((items) =>
                              items.map((current, i) =>
                                i === index ? { ...current, value: e.target.value } : current,
                              ),
                            )
                          }
                          placeholder="value"
                          className="font-mono text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEnvVars((items) => items.filter((_, i) => i !== index))}
                          aria-label="Remove variable"
                        >
                          <IconTrash className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEnvVars((items) => [...items, { key: "", value: "" }])}
                    >
                      ＋ Add variable
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void saveEnvironment()}
                      disabled={savingEnv}
                    >
                      {savingEnv ? "Saving…" : "Save variables"}
                    </Button>
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
              {sessionsQuery.isError ? (
                <ApiErrorState
                  error={sessionsQuery.error}
                  title="Sessions could not be loaded"
                  description="Retry the project session list before relying on it."
                  onRetry={() => void sessionsQuery.refetch()}
                  compact
                />
              ) : sessions.length === 0 ? (
                <EmptyState
                  icon={<IconTerminal className="size-4" />}
                  title="No sessions yet"
                  description="Give the agent a first task."
                />
              ) : (
                <div className="divide-y">
                  {sessions.map((session) => (
                    <SessionSummary
                      key={session.id}
                      href={`/s/${session.id}`}
                      showRepo
                      session={{ ...session, repo: project.repo }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </PageContainer>
    </PageShell>
  );
}
