"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
type Project = { id: string; name: string; repo: string | null };
type ProjectSession = {
  id: string;
  title: string;
  status: string;
  sandboxStatus: string;
  branch: string;
  createdAt: string;
};

const PROVISIONING_SANDBOX = new Set(["pending", "creating", "cloning"]);

function isProvisioning(session: ProjectSession) {
  return session.status === "running" || PROVISIONING_SANDBOX.has(session.sandboxStatus);
}

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
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
        fetch(`${API}/api/projects/${id}`, { credentials: "include" }).then((r) => {
          if (r.status === 404) return null;
          return r.ok ? r.json() : null;
        }),
        fetch(`${API}/api/projects/${id}/sessions`, { credentials: "include" }).then((r) =>
          r.ok ? r.json() : [],
        ),
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

  // Poll while any session is provisioning so loaders resolve without refresh.
  useEffect(() => {
    if (!projectId || !sessions.some(isProvisioning)) return;
    const timer = setInterval(() => void loadSessions(projectId), 3000);
    return () => clearInterval(timer);
  }, [projectId, sessions, loadSessions]);

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
    if (
      !projectId ||
      deleting ||
      !window.confirm(
        "Delete this project, all its sessions, and their sandboxes? This cannot be undone.",
      )
    )
      return;
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
      <main className="mx-auto min-h-screen max-w-5xl px-6 py-8 sm:py-12">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
          OpenDevin / projects
        </p>
        <div className="mt-10 animate-pulse border-b border-border pb-7">
          <div className="h-4 w-24 rounded bg-card" />
          <div className="mt-3 h-10 w-64 rounded bg-card" />
          <div className="mt-3 h-4 w-48 rounded bg-card" />
        </div>
        <div className="grid gap-10 pt-8 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-md bg-card" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-lg bg-card" />
        </div>
      </main>
    );
  }

  if (notFound || !project) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl px-6 py-10 text-sm text-muted-foreground">
        <Link href="/" className="text-xs uppercase tracking-[0.16em] hover:text-foreground">
          OpenDevin / projects
        </Link>
        <p className="mt-10 font-serif text-2xl text-foreground">Project not found.</p>
        <p className="mt-2">It may have been deleted, or you don&apos;t have access.</p>
      </main>
    );
  }

  const showBranchPicker = Boolean(project.repo);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-8 sm:py-12">
      <Link
        href="/"
        className="text-xs uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
      >
        OpenDevin / projects
      </Link>
      <header className="mt-10 flex flex-col gap-4 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Workspace</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {project.repo || "local workspace"}
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
        </span>
        <button
          onClick={() => void deleteProject()}
          disabled={deleting}
          className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-danger disabled:opacity-40"
        >
          {deleting ? "Deleting…" : "Delete project"}
        </button>
      </header>
      <div className="grid gap-10 pt-8 lg:grid-cols-[1fr_360px]">
        <section>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Sessions</p>
          <div className="mt-4 divide-y divide-border border-y border-border">
            {sessions.map((session) => {
              const provisioning = isProvisioning(session);
              return (
                <Link
                  key={session.id}
                  href={`/s/${session.id}`}
                  className="flex items-center justify-between gap-4 py-4 hover:bg-card/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{session.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      {session.branch && (
                        <span className="inline-block rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {session.branch}
                        </span>
                      )}
                      {provisioning ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="h-3 w-3 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
                          Provisioning sandbox…
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {session.status}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {session.sandboxStatus}
                  </span>
                </Link>
              );
            })}
            {sessions.length === 0 && (
              <p className="py-10 text-sm text-muted-foreground">
                No sessions yet. Start with a task on the right.
              </p>
            )}
          </div>
        </section>
        <section className="h-fit rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-raised)]">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">New session</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Give the agent a first move.
          </h2>
          <form onSubmit={createSession} className="mt-5">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Inspect this repo and tell me where to start..."
              rows={5}
              className="w-full resize-none rounded-md border border-input bg-background p-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
            />
            {showBranchPicker && (
              <label className="mt-3 block text-xs text-muted-foreground">
                Branch to check out in sandbox
                {branches.length > 0 ? (
                  <select
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="">Default branch</option>
                    {branches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="Default branch (e.g. main)"
                    className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  />
                )}
                <input
                  value={customBranch}
                  onChange={(e) => setCustomBranch(e.target.value)}
                  placeholder="Or type a new/exact branch name"
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
            )}
            <button
              disabled={creating || !prompt.trim()}
              className="mt-3 w-full rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
            >
              {creating ? "Opening sandbox..." : "Open session"}
            </button>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          </form>
        </section>
      </div>
    </main>
  );
}
