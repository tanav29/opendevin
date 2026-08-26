"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

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
  const [connected, setConnected] = useState<boolean>();
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);


  useEffect(() => {
    void fetch("/api/github/session")
      .then((response) => response.json())
      .then((result) => setConnected(Boolean(result.connected)))
      .catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    if (!connected) return;
    void fetch("/api/github/repositories")
      .then(async (response) => {
        const result = (await response.json()) as { repositories?: GitHubRepository[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load GitHub repositories.");
        setRepositories(result.repositories || []);
      })
      .catch(() => setRepositories([]));
  }, [connected]);

  const selected = useMemo(
    () => repositories.find((repository) => repository.url === value.git),
    [repositories, value.git],
  );

  useEffect(() => {
    if (!selected) return;
    void fetch(`/api/github/branches?repository=${encodeURIComponent(selected.fullName)}`)
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
  }, [onChange, selected, value.baseBranch]);

  if (connected === false) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5">
        <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">
          Connect GitHub to choose an accessible repository and branch.
        </span>
        <Button size="sm" variant="outline" nativeButton={false} render={<a href="/api/github/login?returnTo=/new" />}>
          Connect GitHub
        </Button>
      </div>
    );
  }

  if (connected === undefined) return null;

  return (
    <div className="mt-2 space-y-2">
      {!lockRepository && (
        <select
          aria-label="GitHub repository"
          value={selected?.url || ""}
          disabled={false}
          onChange={(event) => {
            const repository = repositories.find((item) => item.url === event.target.value);
            if (repository) onChange({ git: repository.url, baseBranch: repository.defaultBranch });
          }}
          className="mono flex h-9 w-full rounded-md border bg-transparent px-2 text-[12px] outline-none focus-visible:border-ring"
        >
          <option value="">Choose a connected GitHub repository</option>
          {repositories.map((repository) => (
            <option key={repository.fullName} value={repository.url}>
              {repository.fullName}{repository.private ? " · private" : ""}
            </option>
          ))}
        </select>
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
