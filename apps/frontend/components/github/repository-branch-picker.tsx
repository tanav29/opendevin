"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useGitHubFetch } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Search } from "lucide-react";

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
  const [connected, setConnected] = useState<boolean>();
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  const filteredRepositories = useMemo(() => {
    const query = repositoryQuery.trim().toLowerCase();
    if (!query) return repositories;
    return repositories.filter((repository) =>
      repository.fullName.toLowerCase().includes(query),
    );
  }, [repositories, repositoryQuery]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setRepositoryOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  useEffect(() => {
    void githubFetch("/api/github/session")
      .then((response) => response.json())
      .then((result) => setConnected(Boolean(result.connected)))
      .catch(() => setConnected(false));
  }, [githubFetch]);

  useEffect(() => {
    if (!connected) return;
    void githubFetch("/api/github/repositories")
      .then(async (response) => {
        const result = (await response.json()) as { repositories?: GitHubRepository[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load GitHub repositories.");
        setRepositories(result.repositories || []);
      })
      .catch(() => setRepositories([]));
  }, [connected, githubFetch]);

  const selected = useMemo(
    () => repositories.find((repository) => repository.url === value.git),
    [repositories, value.git],
  );

  useEffect(() => {
    if (!selected) return;
    void githubFetch(`/api/github/branches?repository=${encodeURIComponent(selected.fullName)}`)
      .then(async (response) => {
        const result = (await response.json()) as { branches?: GitHubBranch[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load GitHub branches.");
        const nextBranches = result.branches || [];
        setBranches(nextBranches);
        if (!nextBranches.some((branch) => branch.name === value.baseBranch)) {
          onChange({ git: selected.url, baseBranch: selected.defaultBranch });
        }
      })
      .catch(() => setBranches([]));
  }, [githubFetch, onChange, selected, value.baseBranch]);

  if (connected === false) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5">
        <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">
          Your GitHub sign-in does not include repository access yet. Sign out and sign in again to grant it.
        </span>
      </div>
    );
  }

  if (connected === undefined) return null;

  return (
    <div className="mt-2 space-y-2">
      {!lockRepository && (
        <div ref={pickerRef} className="relative">
          <Button
            type="button"
            variant="outline"
            aria-label="GitHub repository"
            aria-expanded={repositoryOpen}
            onClick={() => setRepositoryOpen((open) => !open)}
            className="h-9 w-full justify-between px-2.5 font-normal"
          >
            <span className={cn("mono truncate text-[12px]", !selected && "text-muted-foreground")}>
              {selected?.fullName || "Choose a connected GitHub repository"}
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>

          {repositoryOpen && (
            <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={repositoryQuery}
                  onChange={(event) => setRepositoryQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setRepositoryOpen(false);
                    if (event.key === "Enter" && filteredRepositories[0]) {
                      const repository = filteredRepositories[0];
                      onChange({ git: repository.url, baseBranch: repository.defaultBranch });
                      setRepositoryQuery("");
                      setRepositoryOpen(false);
                    }
                  }}
                  placeholder="Search repositories..."
                  aria-label="Search GitHub repositories"
                  className="h-8 border-0 pl-8 text-[12px] shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="mt-1 max-h-52 overflow-y-auto" role="listbox" aria-label="GitHub repositories">
                {filteredRepositories.length > 0 ? (
                  filteredRepositories.map((repository) => (
                    <button
                      key={repository.fullName}
                      type="button"
                      role="option"
                      aria-selected={repository.url === selected?.url}
                      onClick={() => {
                        onChange({ git: repository.url, baseBranch: repository.defaultBranch });
                        setRepositoryQuery("");
                        setRepositoryOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                    >
                      <span className="mono min-w-0 flex-1 truncate">{repository.fullName}</span>
                      {repository.private && <span className="text-[10px] text-muted-foreground">private</span>}
                      {repository.url === selected?.url && <Check className="size-3.5 shrink-0" />}
                    </button>
                  ))
                ) : (
                  <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">
                    No repositories match “{repositoryQuery}”.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {lockRepository && !selected && (
        <p className="text-[12px] text-muted-foreground">Connect an account with access to this repository to choose a branch.</p>
      )}

      {selected && (
        <select
          aria-label="Base branch"
          value={value.baseBranch || ""}
          disabled={false}
          onChange={(event) => onChange({ git: selected.url, baseBranch: event.target.value })}
          className="mono flex h-9 w-full rounded-md border bg-transparent px-2 text-[12px] outline-none focus-visible:border-ring"
        >
          <option value="">Choose a base branch</option>
          {branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
        </select>
      )}

    </div>
  );
}
