"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { IconBrandGithub } from "@tabler/icons-react";
import { ArrowUp, GitBranch, CircleDot, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { toast } from "sonner";

export type TaskFormProject = { id: string; repo: string };

type GithubRepo = {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  private: boolean;
};

type GithubIssue = { number: number; title: string; htmlUrl: string };

type Props = {
  projects: TaskFormProject[];
  initialProjectId?: string;
  placeholder?: string;
  autoFocus?: boolean;
};

function matchProject(projects: TaskFormProject[], repo: GithubRepo) {
  return (
    projects.find(
      (p) => p.repo === repo.htmlUrl || p.repo === repo.cloneUrl || p.repo.includes(repo.fullName),
    ) ?? null
  );
}

export default function TaskForm({
  projects,
  initialProjectId,
  placeholder = "Inspect the repo and propose a plan…",
  autoFocus = false,
}: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);
  const [resolvedProjectId, setResolvedProjectId] = useState(initialProjectId || "");
  const [resolving, setResolving] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [branch, setBranch] = useState("");
  const [branchSearch, setBranchSearch] = useState("");
  const [issueSearch, setIssueSearch] = useState("");
  const [issue, setIssue] = useState<GithubIssue | null>(null);
  const [creating, setCreating] = useState(false);
  const submittedRef = useRef(false);

  const isLockedToProject = Boolean(initialProjectId);
  const activeProjectId = initialProjectId || resolvedProjectId;
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const repositoryLabel = selectedRepo?.fullName || activeProject?.repo || "Select repository";
  const sourceBranchLabel = branch || "Choose a branch";

  const reposQuery = useQuery({
    queryKey: ["github-repos"],
    queryFn: () => api<{ repos?: GithubRepo[] }>("/api/github/repos"),
    retry: false,
    staleTime: 60_000,
  });
  const repos = useMemo(() => reposQuery.data?.repos ?? [], [reposQuery.data]);

  const filteredRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repos, repoSearch]);

  async function handleRepoSelect(repo: GithubRepo) {
    setSelectedRepo(repo);
    setRepoSearch("");
    setBranch("");
    setIssue(null);
    const existing = matchProject(projects, repo);
    if (existing) {
      setResolvedProjectId(existing.id);
      return;
    }
    // No workspace yet for this repo — create one, then enable branches.
    setResolving(true);
    setResolvedProjectId("");
    try {
      const created = await api<{ id: string }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ repo: repo.htmlUrl }),
      });
      setResolvedProjectId(created.id);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create workspace");
    } finally {
      setResolving(false);
    }
  }

  const branchesQuery = useQuery({
    queryKey: ["task-form-branches", activeProjectId],
    queryFn: () =>
      api<{ branches: string[]; defaultBranch: string }>(
        `/api/projects/${activeProjectId}/branches`,
      ),
    enabled: Boolean(activeProjectId),
    retry: false,
    staleTime: 30_000,
  });
  const issuesQuery = useQuery({
    queryKey: ["task-form-issues", activeProjectId],
    queryFn: () => api<{ issues: GithubIssue[] }>(`/api/projects/${activeProjectId}/issues`),
    enabled: Boolean(activeProjectId),
    retry: false,
    staleTime: 30_000,
  });
  const branches = useMemo(() => branchesQuery.data?.branches ?? [], [branchesQuery.data]);
  const defaultBranch = branchesQuery.data?.defaultBranch ?? "";

  useEffect(() => {
    if (defaultBranch) setBranch(defaultBranch);
  }, [defaultBranch, activeProjectId]);

  const filteredBranches = branches.filter((item) =>
    item.toLowerCase().includes(branchSearch.trim().toLowerCase()),
  );
  const branchToCreate = branchSearch.trim();
  const canCreateBranch =
    branchToCreate.length > 0 &&
    !branches.some((item) => item.toLowerCase() === branchToCreate.toLowerCase());

  const branchEnabled = Boolean(activeProjectId) && !resolving;
  const issues = issuesQuery.data?.issues ?? [];
  const filteredIssues = issues.filter((item) =>
    `${item.number} ${item.title}`.toLowerCase().includes(issueSearch.trim().toLowerCase()),
  );

  async function runTask(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || !activeProjectId || !branch.trim() || creating || submittedRef.current)
      return;
    submittedRef.current = true;
    setCreating(true);
    let created: { id: string };
    try {
      created = await api<{ id: string }>(`/api/projects/${activeProjectId}/sessions`, {
        method: "POST",
        body: JSON.stringify({
          message: issue ? `${prompt.trim()}\n\nRelated issue: ${issue.htmlUrl}` : prompt.trim(),
          branch: branch.trim(),
        }),
      });
      if (!created.id) throw new Error("The server did not return a session ID.");
    } catch (error) {
      submittedRef.current = false;
      setCreating(false);
      toast.error(error instanceof Error ? error.message : "Could not create session");
      return;
    }
    toast.success("Task started");
    setPrompt("");
    // Keep the action locked while the client-side transition starts. A
    // failed API call is the only path that re-enables submission.
    try {
      router.push(`/s/${created.id}`);
      window.setTimeout(() => {
        if (window.location.pathname === `/s/${created.id}`) return;
        submittedRef.current = false;
        setCreating(false);
        toast.error(
          "The task started, but this page could not open it. Find it in Recent sessions.",
        );
      }, 5000);
    } catch (error) {
      submittedRef.current = false;
      setCreating(false);
      toast.error(error instanceof Error ? error.message : "Could not open the new session");
      return;
    }
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["project-sessions"] }),
    ]).catch(() => undefined);
  }

  return (
    <form onSubmit={runTask} className="relative space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
        <span>
          Repository: <span className="font-medium text-foreground">{repositoryLabel}</span>
        </span>
        <span>
          Source branch:{" "}
          <span className="font-mono font-medium text-foreground">{sourceBranchLabel}</span>
        </span>
      </div>
      <div className="relative">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={placeholder}
          rows={4}
          autoFocus={autoFocus}
          className={`rounded-2xl min-h-32 resize-none p-4 pb-14`}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void runTask(e);
          }}
        />
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-3 pb-3">
        <div className="flex min-w-0 flex-1 items-center">
          {!isLockedToProject && (
            <Select
              value={selectedRepo ? String(selectedRepo.id) : ""}
              onValueChange={(v: string | null) => {
                const repo = repos.find((r) => String(r.id) === v) ?? null;
                if (repo) void handleRepoSelect(repo);
              }}
            >
              <SelectTrigger className="text-xs w-auto border-0 bg-transparent!">
                <IconBrandGithub className="size-3.5 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="Select repo" />
              </SelectTrigger>
              <SelectContent>
                <div onKeyDown={(e) => e.stopPropagation()}>
                  <Input
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Search repos…"
                    className="text-xs rounded-sm"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <hr className="my-2" />
                {reposQuery.isPending ? (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                    Loading repos…
                  </div>
                ) : reposQuery.isError ? (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                    Couldn’t load repos. Sign in with GitHub.
                  </div>
                ) : filteredRepos.length === 0 ? (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                    No repos found.
                  </div>
                ) : (
                  filteredRepos.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.fullName}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          )}

          <Select
            value={branch}
            disabled={!branchEnabled}
            onValueChange={(value) => {
              if (!value) {
                setBranch("");
                setBranchSearch("");
                return;
              }
              if (value.startsWith("__create__:")) {
                setBranch(value.slice("__create__:".length));
                setBranchSearch("");
                return;
              }
              setBranch(value);
              setBranchSearch("");
            }}
          >
            <SelectTrigger className="h-8 bg-transparent w-auto max-w-44 border-0 text-xs bg-transparent!">
              <GitBranch className="size-3 shrink-0 text-muted-foreground" />
              <SelectValue placeholder={resolving ? "Creating workspace…" : "Branch"} />
            </SelectTrigger>
            <SelectContent>
              <div className="" onKeyDown={(e) => e.stopPropagation()}>
                <Input
                  value={branchSearch}
                  onChange={(e) => setBranchSearch(e.target.value)}
                  placeholder="Search branches…"
                  className="text-xs rounded-sm"
                  onClick={(e) => e.stopPropagation()}
                />
                <hr className="my-2" />
              </div>
              {branchesQuery.isPending ? (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  Loading branches…
                </div>
              ) : branchesQuery.isError ? (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  Couldn&apos;t load branches. Enter a name to create a source branch.
                </div>
              ) : (
                <>
                  {branch &&
                    !branches.some((item) => item.toLowerCase() === branch.toLowerCase()) && (
                      <SelectItem value={branch}>{branch}</SelectItem>
                    )}
                  {filteredBranches.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                  {filteredBranches.length === 0 && !canCreateBranch && (
                    <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                      No branches found.
                    </div>
                  )}
                </>
              )}
              {canCreateBranch && (
                <SelectItem value={`__create__:${branchToCreate}`}>
                  Create “{branchToCreate}”
                </SelectItem>
              )}
            </SelectContent>
          </Select>

          <Select
            value={issue ? String(issue.number) : ""}
            disabled={!branchEnabled}
            onValueChange={(value: string | null) => {
              const selected = issues.find((item) => String(item.number) === value);
              setIssue(selected ?? null);
              setIssueSearch("");
            }}
          >
            <SelectTrigger className="h-8 w-auto max-w-44 border-0 text-xs bg-transparent!">
              <span className="flex min-w-0 items-center gap-1.5">
                <CircleDot className="size-3 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="Attach Issue" />
              </span>
            </SelectTrigger>
            <SelectContent>
              <div onKeyDown={(e) => e.stopPropagation()}>
                <Input
                  value={issueSearch}
                  onChange={(e) => setIssueSearch(e.target.value)}
                  placeholder="Search issues…"
                  className="text-xs rounded-sm"
                  onClick={(e) => e.stopPropagation()}
                />
                <hr className="my-2" />
              </div>
              {issuesQuery.isPending ? (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  Loading issues…
                </div>
              ) : issuesQuery.isError ? (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  Couldn’t load issues.
                </div>
              ) : filteredIssues.length ? (
                filteredIssues.map((item) => (
                  <SelectItem key={item.number} value={String(item.number)}>
                    #{item.number} · {item.title}
                  </SelectItem>
                ))
              ) : (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No open issues found.
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="submit"
          disabled={creating || resolving || !prompt.trim() || !activeProjectId || !branch.trim()}
          size="icon-sm"
        >
          {creating ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </div>
    </form>
  );
}
