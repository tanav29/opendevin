"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  IconFolder,
  IconPlus,
  IconSearch,
  IconTerminal,
  IconGitBranch,
  IconClock,
  IconArrowUpRight,
  IconCode,
  IconSparkles,
  IconBolt,
  IconEye,
} from "@tabler/icons-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader, PageShell, PageContainer } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { StatusDot } from "@/components/ui/status-dot";
import { timeAgo, repoName } from "@/lib/format";
import NewProjectForm from "@/components/new-project-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type Project = { id: string; name: string; repo: string | null; updatedAt?: string; createdAt?: string };
type Session = {
  id: string;
  title: string;
  status: string;
  sandboxStatus: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  project?: { id: string; name: string };
};

function SignedOut({ onNewProject }: { onNewProject: () => void }) {
  return (
    <PageContainer size="wide" className="py-8">
      <div className="relative overflow-hidden rounded-2xl border bg-card">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,theme(colors.border)_1px,transparent_1px),linear-gradient(to_bottom,theme(colors.border)_1px,transparent_1px)] bg-[size:24px_24px] opacity-30 [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]" />
        <div className="relative px-6 py-12 sm:px-10 sm:py-16">
          <Badge variant="secondary" className="font-mono text-[11px]">
            <IconSparkles className="size-3" /> OpenDevin · sandboxed workspace
          </Badge>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
            Turn any repo into a working session.
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-6 text-muted-foreground">
            Chat with an agent that can read, edit, run, and preview. Every session gets an isolated sandbox — inspect the diff, run the tests, ship the patch.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={() => (window.location.href = "/login")}>Continue with GitHub</Button>
             <Button variant="outline" onClick={onNewProject}>
              Create local project
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap gap-2 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1">
              <IconCode className="size-3.5" /> Public GitHub · GitLab · Bitbucket
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1">
              <IconBolt className="size-3.5" /> Minimal tools · no second backend
            </span>
          </div>
        </div>

        <div className="grid gap-px border-t bg-border sm:grid-cols-3">
          <div className="bg-card p-6">
            <div className="flex size-8 items-center justify-center rounded-md border bg-background">
              <IconFolder className="size-4 text-muted-foreground" />
            </div>
            <h3 className="mt-3 text-sm font-medium">Start from any repo</h3>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Paste a URL, pick a branch, open a sandbox that clones it.</p>
          </div>
          <div className="bg-card p-6">
            <div className="flex size-8 items-center justify-center rounded-md border bg-background">
              <IconTerminal className="size-4 text-muted-foreground" />
            </div>
            <h3 className="mt-3 text-sm font-medium">Work in the open</h3>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Chat + terminal + diff + preview side by side. No hidden state.</p>
          </div>
          <div className="bg-card p-6">
            <div className="flex size-8 items-center justify-center rounded-md border bg-background">
              <IconGitBranch className="size-4 text-muted-foreground" />
            </div>
            <h3 className="mt-3 text-sm font-medium">Ship cleanly</h3>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Download a patch or push a branch and open the PR.</p>
          </div>
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Why minimal</p>
        <Separator className="ml-4 flex-1" />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px]">Productive by default</CardTitle>
            <CardDescription className="text-[13px] leading-5">Keyboard-first, dense without being noisy. Every pixel earns its keep.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px]">Own the loop</CardTitle>
            <CardDescription className="text-[13px] leading-5">Human-in-the-loop. You inspect files, approve plans, and decide when to publish.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </PageContainer>
  );
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [q, setQ] = useState("");
   const [newProjectOpen, setNewProjectOpen] = useState(false);

  useEffect(() => {
    const cancelled = false;
    async function load() {
      try {
        const pr = await fetch(`${API}/api/projects`, { credentials: "include" });
        if (pr.status === 401) {
          if (!cancelled) {
            setSignedIn(false);
            setLoading(false);
          }
          return;
        }
        if (pr.ok) {
          const data = (await pr.json()) as Project[];
          if (!cancelled) {
            setProjects(data);
            setSignedIn(true);
          }
        } else if (!cancelled) setSignedIn(false);
      } catch {
        if (!cancelled) setSignedIn(false);
      } finally {
        if (!cancelled) setLoading(false);
      }

      try {
        const sr = await fetch(`${API}/api/sessions`, { credentials: "include" });
        if (sr.ok && !cancelled) setSessions((await sr.json()) as Session[]);
      } catch {}
    }
    void load();
  }, []);

  const filteredProjects = useMemo(() => {
    if (!q.trim()) return projects;
    const needle = q.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(needle) || (p.repo || "").toLowerCase().includes(needle));
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
              actions={<Button size="sm" onClick={() => (window.location.href = "/login")}>Sign in</Button>}
            />
          }
         >
             <SignedOut onNewProject={() => setNewProjectOpen(true)} />
         </PageShell>
         <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
           <DialogContent>
             <DialogHeader>
               <DialogTitle>Create a workspace</DialogTitle>
               <DialogDescription>Start from a GitHub repository or create a blank workspace.</DialogDescription>
             </DialogHeader>
             <NewProjectForm />
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
            description={signedIn ? `${projects.length} projects · ${activeSessions} active` : "Loading…"}
            actions={
              <div className="flex items-center gap-1.5">
                 <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => setNewProjectOpen(true)}>
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
        <PageContainer size="wide" className="py-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Projects</p>
                  <IconFolder className="size-3.5 text-muted-foreground" />
                </div>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.02em]">{loading ? "—" : projects.length}</p>
                <p className="text-[12px] text-muted-foreground">Across {new Set(sessions.map((s) => s.projectId)).size} workspaces</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Active sessions</p>
                  <StatusDot status={activeSessions > 0 ? "running" : "idle"} />
                </div>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.02em]">{loading ? "—" : activeSessions}</p>
                <p className="text-[12px] text-muted-foreground">{sessions.length} total · working now</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Quick start</p>
                  <IconBolt className="size-3.5 text-muted-foreground" />
                </div>
                <p className="mt-2 text-sm font-medium">Paste a repo URL</p>
                <p className="text-[12px] text-muted-foreground">GitHub, GitLab, Bitbucket — any public repo.</p>
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-sm flex-1">
              <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter projects and sessions…"
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">Press</span>
              <span className="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] sm:inline">n</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">for new project</span>
              <Button variant="ghost" size="sm" className="ml-1" onClick={() => (window.location.href = "/settings")}>
                <IconEye className="size-4" /> Settings
              </Button>
            </div>
          </div>

          <div className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Projects</h2>
              <Link href="/new" className="text-xs text-muted-foreground hover:text-foreground">
                Add project →
              </Link>
            </div>

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
                  description={projects.length === 0 ? "Create a project from a repo or start blank. The agent works inside an isolated sandbox." : `No projects match “${q}”.`}
                  action={projects.length === 0 ? { label: "New project", onClick: () => (window.location.href = "/new"), icon: <IconPlus className="size-4" /> } : undefined}
                />
              </Card>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {filteredProjects.map((p) => {
                  const count = sessions.filter((s) => s.projectId === p.id).length;
                  return (
                    <Link key={p.id} href={`/p/${p.id}`} className="group rounded-xl border bg-card p-4 hover:bg-muted/50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="flex size-7 items-center justify-center rounded-md border bg-background">
                              <IconFolder className="size-3.5 text-muted-foreground" />
                            </span>
                            <h3 className="truncate text-[13px] font-medium">{p.name}</h3>
                          </div>
                          <p className="mt-2 truncate font-mono text-xs text-muted-foreground">{p.repo ? repoName(p.repo) : "Local workspace · no remote"}</p>
                        </div>
                        <IconArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono text-[11px]">
                          <IconClock className="size-3" />
                          {p.updatedAt ? timeAgo(p.updatedAt) : p.createdAt ? timeAgo(p.createdAt) : "just now"}
                        </Badge>
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {count} {count === 1 ? "session" : "sessions"}
                        </Badge>
                        {p.repo && (
                          <Badge variant="outline" className="hidden font-mono text-[11px] sm:inline-flex">
                            <IconGitBranch className="size-3" />
                            repo
                          </Badge>
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
              <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Recent sessions</h2>
              <span className="font-mono text-[11px] text-muted-foreground">{sessions.length} total</span>
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
                  description="Open a project and give the agent a first task. It will read the repo and start planning right away."
                />
              </div>
            ) : (
              <div className="divide-y my-3 border rounded-xl overflow-hidden">
                {filteredSessions.map((s) => (
                  <Link key={s.id} href={`/s/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                    <StatusDot status={s.status} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{s.title}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {s.project?.name || "Project"} {s.branch ? `· ${s.branch}` : ""} · {timeAgo(s.updatedAt)}
                      </p>
                    </div>
                    <Badge variant="outline" className="hidden font-mono text-[11px] sm:inline-flex">
                      {s.sandboxStatus}
                    </Badge>
                    <IconArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
                {filteredSessions.length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">No sessions match “{q}”.</div>
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
             <DialogDescription>Start from a GitHub repository or create a blank workspace.</DialogDescription>
           </DialogHeader>
           <NewProjectForm />
         </DialogContent>
       </Dialog>
     </AppShell>
  );
}
