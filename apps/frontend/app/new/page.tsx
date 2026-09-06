"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconFolder,
  IconGitBranch,
  IconPlus,
  IconCode,
  IconBrandGithub,
  IconLock,
  IconStar,
  IconSearch,
  IconChevronDown,
  IconCheck,
  IconRefresh,
  IconAlertCircle,
  IconExternalLink,
} from "@tabler/icons-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader, PageShell, PageContainer } from "@/components/ui/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type Repo = {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  private: boolean;
  description: string;
  language: string | null;
  stars: number;
  fork: boolean;
  updatedAt: string;
  owner: string;
};

export default function NewProject() {
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  // repo picker state
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [reposError, setReposError] = useState("");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [filter, setFilter] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  async function fetchRepos() {
    setReposLoading(true);
    setReposError("");
    setNeedsAuth(false);
    try {
      const res = await fetch(`${API}/api/github/repos`, { credentials: "include" });
      const data = (await res.json().catch(() => ({}))) as {
        repos?: Repo[];
        error?: string;
        needsAuth?: boolean;
      };
      if (res.status === 401 && data.needsAuth !== false) {
        setNeedsAuth(true);
        setReposError(data.error || "Sign in with GitHub to browse your repositories.");
        setRepos([]);
        return;
      }
      if (!res.ok && !data.repos) {
        setReposError(data.error || "Could not load GitHub repos.");
        setRepos([]);
        return;
      }
      setRepos(data.repos || []);
      if (data.needsAuth) {
        setNeedsAuth(true);
        setReposError(data.error || "Sign in with GitHub to browse your repositories.");
      } else if (data.error) {
        setReposError(data.error);
      }
    } catch {
      setReposError("Could not reach GitHub. Check your connection.");
    } finally {
      setReposLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchRepos();
  }, []);

  // close picker on outside click / escape
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPickerOpen(false);
    }
    if (pickerOpen) {
      document.addEventListener("mousedown", onDocClick);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("mousedown", onDocClick);
        document.removeEventListener("keydown", onKey);
      };
    }
  }, [pickerOpen]);

  const filteredRepos = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.owner.toLowerCase().includes(q),
    );
  }, [repos, filter]);

  const selectedRepo = useMemo(() => {
    const url = repo.trim();
    if (!url) return null;
    return repos.find((r) => r.htmlUrl === url || r.cloneUrl === url || url.includes(r.fullName)) || null;
  }, [repos, repo]);

  function handleSelect(r: Repo) {
    setRepo(r.htmlUrl);
    if (!name.trim()) setName(r.name);
    setPickerOpen(false);
    setFilter("");
    setError("");
  }

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/projects`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), repo: repo.trim() || null }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not create project.");
        setCreating(false);
        return;
      }
      const data = (await response.json()) as { id: string };
      window.location.href = `/p/${data.id}`;
    } catch {
      setError("Could not reach the server. Check that the backend is running.");
      setCreating(false);
    }
  }

  return (
    <AppShell>
      <PageShell
        header={
          <PageHeader
            title="New project"
            description="From repo or blank"
            icon={<IconFolder className="size-4" />}
            actions={
              <Button variant="ghost" size="sm" onClick={() => (window.location.href = "/")}>
                <IconArrowLeft className="size-4" /> Back
              </Button>
            }
          />
        }
      >
        <PageContainer size="sm" className="py-8">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-md border bg-muted">
                  <IconPlus className="size-4" />
                </span>
                <div>
                  <CardTitle>Create a workspace</CardTitle>
                  <CardDescription>A project groups sessions. Start from a Git URL or an empty directory.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={createProject} className="space-y-5">
                <label className="block">
                  <span className="text-sm font-medium">Project name</span>
                  <Input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. opendevin, landing-page, api-refactor"
                    className="mt-2"
                    autoFocus
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">Shown in the sidebar and on the dashboard.</span>
                </label>

                {/* Repo select */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Repository</span>
                    <span className="text-xs text-muted-foreground">(optional)</span>
                  </div>

                  {/* GitHub repo picker */}
                  <div ref={pickerRef} className="relative">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPickerOpen((o) => !o)}
                      disabled={reposLoading && repos.length === 0}
                      className={cn(
                        "w-full justify-between font-normal h-8 px-2.5 text-sm",
                        !repo && "text-muted-foreground",
                        pickerOpen && "ring-2 ring-ring/20 border-ring/40",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2 truncate">
                        <IconBrandGithub className="size-4 shrink-0 text-muted-foreground" />
                        {reposLoading && repos.length === 0 ? (
                          <span className="truncate">Loading repositories…</span>
                        ) : selectedRepo ? (
                          <span className="truncate font-medium text-foreground">{selectedRepo.fullName}</span>
                        ) : repo ? (
                          <span className="truncate font-mono text-[13px] text-foreground">{repo}</span>
                        ) : (
                          <span className="truncate">
                            {needsAuth ? "Connect GitHub to browse" : `Select a repository${repos.length ? ` — ${repos.length} found` : ""}`}
                          </span>
                        )}
                      </span>
                      <IconChevronDown
                        className={cn("size-4 shrink-0 text-muted-foreground transition-transform", pickerOpen && "rotate-180")}
                      />
                    </Button>

                    {pickerOpen && (
                      <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
                        {/* search */}
                        <div className="border-b p-2">
                          <div className="relative">
                            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              autoFocus
                              value={filter}
                              onChange={(e) => setFilter(e.target.value)}
                              placeholder="Filter by name or description…"
                              className="h-8 pl-8 text-sm"
                            />
                          </div>
                        </div>

                        {/* content */}
                        <div className="max-h-72 overflow-hidden">
                          {reposLoading ? (
                            <div className="space-y-2 p-2">
                              {[0, 1, 2].map((i) => (
                                <div key={i} className="flex gap-3 rounded-md border p-2.5">
                                  <Skeleton className="size-7 rounded-md" />
                                  <div className="flex-1 space-y-2">
                                    <Skeleton className="h-3 w-32" />
                                    <Skeleton className="h-3 w-full" />
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : needsAuth ? (
                            <div className="p-6 text-center">
                              <div className="mx-auto flex size-9 items-center justify-center rounded-full border bg-muted">
                                <IconBrandGithub className="size-5 text-muted-foreground" />
                              </div>
                              <p className="mt-3 text-sm font-medium">GitHub not connected</p>
                              <p className="mx-auto mt-1 max-w-[28ch] text-xs leading-5 text-muted-foreground">
                                Sign in with GitHub to browse your private and org repos. You can still paste any public URL below.
                              </p>
                              <Button size="sm" className="mt-3" onClick={() => (window.location.href = "/login")}>
                                <IconBrandGithub className="size-4" /> Continue with GitHub
                              </Button>
                            </div>
                          ) : reposError && repos.length === 0 ? (
                            <div className="p-6 text-center">
                              <div className="mx-auto flex size-9 items-center justify-center rounded-full border bg-destructive/10">
                                <IconAlertCircle className="size-5 text-destructive" />
                              </div>
                              <p className="mt-3 text-sm font-medium">Couldn’t load repos</p>
                              <p className="mt-1 text-xs text-muted-foreground">{reposError}</p>
                              <Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchRepos()}>
                                <IconRefresh className="size-4" /> Try again
                              </Button>
                            </div>
                          ) : filteredRepos.length === 0 ? (
                            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                              No repositories match “{filter}”.
                            </div>
                          ) : (
                            <ScrollArea className="max-h-64">
                              <div className="p-1">
                                {filteredRepos.map((r) => {
                                  const isSelected = selectedRepo?.id === r.id || repo === r.htmlUrl || repo === r.cloneUrl;
                                  return (
                                    <button
                                      key={r.id}
                                      type="button"
                                      onClick={() => handleSelect(r)}
                                      className={cn(
                                        "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground",
                                        isSelected && "bg-accent text-accent-foreground",
                                      )}
                                    >
                                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-background">
                                        <IconBrandGithub className="size-4 text-muted-foreground" />
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-1.5">
                                          <span className="truncate text-[13px] font-medium leading-none">{r.fullName}</span>
                                          {r.private && (
                                            <Badge variant="secondary" className="h-4 gap-1 px-1.5 text-[10px] font-medium">
                                              <IconLock className="size-3" /> Private
                                            </Badge>
                                          )}
                                          {r.fork && (
                                            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                                              Fork
                                            </Badge>
                                          )}
                                        </span>
                                        {r.description ? (
                                          <span className="mt-1 line-clamp-1 block text-xs leading-4 text-muted-foreground">
                                            {r.description}
                                          </span>
                                        ) : (
                                          <span className="mt-1 block text-xs text-muted-foreground/60">No description</span>
                                        )}
                                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                          {r.language && (
                                            <span className="inline-flex items-center gap-1">
                                              <span className="size-2 rounded-full bg-primary/60" />
                                              {r.language}
                                            </span>
                                          )}
                                          {r.stars > 0 && (
                                            <span className="inline-flex items-center gap-0.5">
                                              <IconStar className="size-3" />
                                              {r.stars}
                                            </span>
                                          )}
                                          <span className="inline-flex items-center gap-1">
                                            <IconGitBranch className="size-3" />
                                            {timeAgo(r.updatedAt)}
                                          </span>
                                        </span>
                                      </span>
                                      {isSelected && <IconCheck className="mt-1 size-4 shrink-0 text-primary" />}
                                    </button>
                                  );
                                })}
                              </div>
                            </ScrollArea>
                          )}
                        </div>

                        {/* footer */}
                        <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          <span className="font-mono text-[11px]">
                            {filteredRepos.length !== repos.length
                              ? `${filteredRepos.length} of ${repos.length} repos`
                              : `${repos.length} repos • sorted by updated`}
                          </span>
                          <button
                            type="button"
                            onClick={() => void fetchRepos()}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-background hover:text-foreground"
                          >
                            <IconRefresh className="size-3" /> Refresh
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {reposError && !needsAuth && repos.length > 0 && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <IconAlertCircle className="size-3" /> {reposError}
                    </p>
                  )}

                  <div className="flex items-center gap-2 py-1">
                    <Separator className="flex-1" />
                    <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">or paste URL</span>
                    <Separator className="flex-1" />
                  </div>

                  <div className="relative">
                    <Input
                      value={repo}
                      onChange={(e) => setRepo(e.target.value)}
                      placeholder="https://github.com/vercel/next.js"
                      className="pr-8 font-mono text-[13px]"
                      spellCheck={false}
                    />
                    {repo && (
                      <a
                        href={repo}
                        target="_blank"
                        rel="noreferrer"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Open repo"
                      >
                        <IconExternalLink className="size-4" />
                      </a>
                    )}
                  </div>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <IconGitBranch className="size-3" /> Supports GitHub, GitLab, Bitbucket — any public repo. Private GitHub repos work when you’re signed in.
                  </span>

                  {selectedRepo && (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
                      <Badge variant="secondary" className="font-mono text-[11px]">
                        <IconBrandGithub className="size-3" /> {selectedRepo.fullName}
                      </Badge>
                      {selectedRepo.private && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <IconLock className="size-3" /> Private
                        </span>
                      )}
                      <span className="ml-auto text-muted-foreground">{selectedRepo.language || "repo"} · {selectedRepo.stars} ★</span>
                    </div>
                  )}
                </div>

                {repo.trim() && !/^https?:\/\//.test(repo.trim()) && (
                  <p className="rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-xs text-warning">
                    The URL should start with https:// — we clone with git, not SSH.
                  </p>
                )}

                {error && (
                  <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
                )}

                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={creating || !name.trim()} className="min-w-32">
                    {creating ? "Creating…" : "Create project"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => (window.location.href = "/")}>
                    Cancel
                  </Button>
                </div>
              </form>

              <Separator className="my-6" />

              <div className="flex gap-3 rounded-lg border bg-muted/50 p-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background border">
                  <IconCode className="size-4 text-muted-foreground" />
                </span>
                <div>
                  <p className="text-sm font-medium">What happens next?</p>
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                    You will get a project page where you can open a session. Each session spins up a fresh sandbox, clones the branch, and gives the agent shell + file access.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="mt-6 flex justify-center gap-2 text-xs text-muted-foreground">
            <span>Need a different branch?</span>
            <span className="text-foreground">You can pick it when opening a session.</span>
          </div>
        </PageContainer>
      </PageShell>
    </AppShell>
  );
}
