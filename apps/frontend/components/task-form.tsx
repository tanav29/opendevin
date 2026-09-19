"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconBrandGithub, IconPlus } from "@tabler/icons-react";
import { ArrowUp, GitBranch, Loader2 } from "lucide-react";

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

export type TaskFormProject = { id: string; repo: string };

type GithubRepo = {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  private: boolean;
};

type Props = {
  projects: TaskFormProject[];
  initialProjectId?: string;
  placeholder?: string;
  autoFocus?: boolean;
};

function matchProject(projects: TaskFormProject[], repo: GithubRepo) {
  return (
    projects.find(
      (p) =>
        p.repo === repo.htmlUrl ||
        p.repo === repo.cloneUrl ||
        p.repo.includes(repo.fullName),
    ) ?? null
  );
}

export default function TaskForm({
  projects,
  initialProjectId,
  placeholder = "Inspect the repo and propose a plan…",
  autoFocus = false,
}: Props) {
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);
  const [resolvedProjectId, setResolvedProjectId] = useState(initialProjectId || "");
  const [resolving, setResolving] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [branch, setBranch] = useState("");
  const [branchSearch, setBranchSearch] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const isLockedToProject = Boolean(initialProjectId);
  const activeProjectId = initialProjectId || resolvedProjectId;

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
    setError("");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create workspace");
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
  const branches = useMemo(
    () => branchesQuery.data?.branches ?? [],
    [branchesQuery.data],
  );
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

  async function runTask(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || !activeProjectId || creating) return;
    setCreating(true);
    setError("");
    try {
      const data = await api<{ id: string }>(
        `/api/projects/${activeProjectId}/sessions`,
        {
          method: "POST",
          body: JSON.stringify({ message: prompt.trim(), branch }),
        },
      );
      window.location.href = `/s/${data.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create session");
      setCreating(false);
    }
  }

  return (
    <form onSubmit={runTask} className="relative space-y-3">
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={placeholder}
        rows={4}
        autoFocus={autoFocus}
        className="min-h-32 resize-none p-4 pb-14"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void runTask(e);
        }}
      />
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-3 pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {!isLockedToProject && (
            <Select
              value={selectedRepo ? String(selectedRepo.name) : ""}
              onValueChange={(v: string | null) => {
                const repo = repos.find((r) => String(r.id) === v) ?? null;
                if (repo) void handleRepoSelect(repo);
              }}
            >
              <SelectTrigger className="text-xs w-auto border-0">
                <span className="flex min-w-0 items-center gap-1.5">
                  <IconBrandGithub className="size-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="Select repo" />
                </span>
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
            <SelectTrigger className="h-8 w-auto max-w-44 border-0 text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                <SelectValue
                  placeholder={resolving ? "Creating workspace…" : "Branch"}
                />
              </span>
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
              ) : (
                <>
                  {filteredBranches.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                  {canCreateBranch && (
                    <SelectItem value={`__create__:${branchToCreate}`}>
                      <IconPlus className="size-3.5" />
                      Create “{branchToCreate}”
                    </SelectItem>
                  )}
                  {filteredBranches.length === 0 && !canCreateBranch && (
                    <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                      No branches found.
                    </div>
                  )}
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="submit"
          disabled={creating || resolving || !prompt.trim() || !activeProjectId}
          size="icon-sm"
        >
          {creating ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </div>
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
