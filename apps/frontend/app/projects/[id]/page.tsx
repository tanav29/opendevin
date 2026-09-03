"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
type Project = { name: string; repo: string | null };
type ProjectSession = { id: string; title: string; status: string; createdAt: string };

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void params.then(({ id }) => {
      setProjectId(id);
      void Promise.all([
        fetch(`${API}/api/projects/${id}`, { credentials: "include" }).then((r) => r.ok ? r.json() : null),
        fetch(`${API}/api/projects/${id}/sessions`, { credentials: "include" }).then((r) => r.ok ? r.json() : []),
      ]).then(([nextProject, nextSessions]) => { setProject(nextProject); setSessions(nextSessions); });
    });
  }, [params]);

  async function createSession(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || !projectId) return;
    setCreating(true); setError("");
    const response = await fetch(`${API}/api/projects/${projectId}/sessions`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: prompt }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error || "Could not create session"); setCreating(false); return; }
    window.location.href = `/sessions/${data.id}`;
  }

  if (!project) return <main className="mx-auto min-h-screen max-w-5xl px-6 py-10 text-sm text-muted-foreground">Loading project...</main>;
  return <main className="mx-auto min-h-screen max-w-5xl px-6 py-8 sm:py-12">
    <Link href="/" className="text-xs uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground">OpenDevin / projects</Link>
    <header className="mt-10 flex flex-col gap-4 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Workspace</p><h1 className="mt-2 font-serif text-4xl tracking-tight">{project.name}</h1><p className="mt-2 font-mono text-xs text-muted-foreground">{project.repo || "local workspace"}</p></div>
      <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">{sessions.length} {sessions.length === 1 ? "session" : "sessions"}</span>
    </header>
    <div className="grid gap-10 pt-8 lg:grid-cols-[1fr_360px]">
      <section><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Recent sessions</p><div className="mt-4 divide-y divide-border border-y border-border">{sessions.map((session) => <Link key={session.id} href={`/sessions/${session.id}`} className="flex items-center justify-between gap-4 py-4 hover:bg-card/50"><span className="min-w-0 truncate text-sm">{session.title}</span><span className="shrink-0 font-mono text-[11px] text-muted-foreground">{session.status}</span></Link>)}{sessions.length === 0 && <p className="py-10 text-sm text-muted-foreground">No sessions yet. Start with a task on the right.</p>}</div></section>
      <section className="h-fit rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-raised)]"><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">New session</p><h2 className="mt-3 font-serif text-2xl">Give the agent a first move.</h2><form onSubmit={createSession} className="mt-5"><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Inspect this repo and tell me where to start..." rows={5} className="w-full resize-none rounded-md border border-input bg-background p-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" /><button disabled={creating || !prompt.trim()} className="mt-3 w-full rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40">{creating ? "Opening sandbox..." : "Open session"}</button>{error && <p className="mt-3 text-sm text-destructive">{error}</p>}</form></section>
    </div>
  </main>;
}
