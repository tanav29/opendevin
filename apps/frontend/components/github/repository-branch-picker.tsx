"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useGitHubFetch, useGitHubSession } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, GitBranch, Search } from "lucide-react";

export type GitHubRepository = {
  fullName: string;
  url: string;
  defaultBranch: string;
  private: boolean;
  canPush: boolean;
};

type GitHubBranch = { name: string; sha: string; protected: boolean };
type Selection = { git: string; baseBranch?: string };

export function GitHubRepositoryBranchPicker({
  value,
  onChange,
  lockRepository = false,
}: {
  value: Selection;
  onChange: (selection: Selection) => void;
  lockRepository?: boolean;
}) {
  const githubFetch = useGitHubFetch();
  const githubSession = useGitHubSession();
  const connected = githubSession?.connected;
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const [loadingRepos, setLoadingRepos] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const filteredRepositories = useMemo(() => {
    const q = repositoryQuery.trim().toLowerCase();
    if (!q) return repositories;
    return repositories.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repositories, repositoryQuery]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (!pickerRef.current?.contains(e.target as Node)) setRepositoryOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!connected) return;
    setLoadingRepos(true);
    void githubFetch("/api/github/repositories")
      .then(async (r) => {
        const result = (await r.json()) as { repositories?: GitHubRepository[]; error?: string };
        if (!r.ok) throw new Error(result.error || "Could not load repositories.");
        setRepositories(result.repositories || []);
      })
      .catch(() => setRepositories([]))
      .finally(() => setLoadingRepos(false));
  }, [connected, githubFetch]);

  const selected = useMemo(() => repositories.find((r) => r.url === value.git), [repositories, value.git]);

  useEffect(() => {
    if (!selected) return;
    void githubFetch(`/api/github/branches?repository=${encodeURIComponent(selected.fullName)}`)
      .then(async (r) => {
        const result = (await r.json()) as { branches?: GitHubBranch[]; error?: string };
        if (!r.ok) throw new Error(result.error || "Could not load branches.");
        const next = result.branches || [];
        setBranches(next);
        if (!next.some((b) => b.name === value.baseBranch)) {
          onChange({ git: selected.url, baseBranch: selected.defaultBranch });
        }
      })
      .catch(() => setBranches([]));
  }, [githubFetch, selected, value.baseBranch, onChange]);

  if (connected === false) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed bg-surface-1/50 px-3 py-2.5">
        <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted-foreground">
          GitHub repository access not granted. Sign out and sign in again to enable it.
        </span>
      </div>
    );
  }
  if (connected === undefined) {
    return (
      <div className="h-9 animate-pulse rounded-md border bg-surface-2" aria-hidden />
    );
  }

  return (
    <div className="space-y-2.5">
      {!lockRepository && (
        <div ref={pickerRef} className="relative">
          <Button
            type="button"
            variant="outline"
            aria-label="GitHub repository"
            aria-expanded={repositoryOpen}
            onClick={() => setRepositoryOpen((o) => !o)}
            className="h-9 w-full justify-between bg-background px-2.5 font-normal"
          >
            <span className={cn("mono truncate text-[12.5px]", !selected && "text-muted-foreground")}>
              {loadingRepos ? "Loading repositories…" : selected?.fullName || "Choose a GitHub repository"}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>

          {repositoryOpen && (
            <div className="animate-rise absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={repositoryQuery}
                  onChange={(e) => setRepositoryQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRepositoryOpen(false);
                    if (e.key === "Enter" && filteredRepositories[0]) {
                      const r = filteredRepositories[0];
                      onChange({ git: r.url, baseBranch: r.defaultBranch });
                      setRepositoryQuery("");
                      setRepositoryOpen(false);
                    }
                  }}
                  placeholder="Search repositories…"
                  aria-label="Search GitHub repositories"
                  className="h-8 border-0 bg-surface-1 pl-8 text-[12.5px] shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="mt-1 max-h-52 overflow-y-auto" role="listbox" aria-label="GitHub repositories">
                {filteredRepositories.length > 0 ? (
                  filteredRepositories.map((r) => (
                    <button
                      key={r.fullName}
                      type="button"
                      role="option"
                      aria-selected={r.url === selected?.url}
                      onClick={() => {
                        onChange({ git: r.url, baseBranch: r.defaultBranch });
                        setRepositoryQuery("");
                        setRepositoryOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12.5px] transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <span className="mono min-w-0 flex-1 truncate">{r.fullName}</span>
                      {r.private && <span className="rounded bg-surface-2 px-1 py-0.5 text-[10px] text-muted-foreground">private</span>}
                      {r.url === selected?.url && <Check className="size-3.5 shrink-0 text-brand" />}
                    </button>
                  ))
                ) : (
                  <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">
                    No match for “{repositoryQuery}”.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {lockRepository && !selected && (
        <p className="rounded-md border border-dashed bg-surface-1/50 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
          Connect an account with access to this repository to choose a branch.
        </p>
      )}

      {selected && (
        <div className="relative">
          <GitBranch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <select
            aria-label="Base branch"
            value={value.baseBranch || ""}
            onChange={(e) => onChange({ git: selected.url, baseBranch: e.target.value })}
            className="mono flex h-9 w-full appearance-none rounded-md border bg-background py-2 pr-8 pl-8 text-[12.5px] outline-none transition-colors focus-visible:border-ring"
          >
            <option value="">{branches.length ? "Choose a base branch" : "Loading branches…"}</option>
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name} {b.protected ? "🔒" : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3 -translate-y-1/2 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
