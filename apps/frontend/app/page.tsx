"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
type Project = { id: string; name: string; repo: string | null };

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    fetch(`${API}/api/projects`, { credentials: "include" })
      .then(async (response) => {
        if (response.ok) {
          setSignedIn(true);
          setProjects((await response.json()) as Project[]);
        }
      })
      .catch(() => undefined);
  }, []);
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-10">
      <header className="flex items-center justify-between border-b border-border pb-5">
        <Link href="/" className="text-xl font-semibold tracking-tight">
          OpenDevin
        </Link>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          {signedIn ? <Link href="/settings">Settings</Link> : <Link href="/login">Sign in</Link>}
        </nav>
      </header>
      <section className="py-20">
        <p className="text-sm text-muted-foreground">Developer workspace</p>
        <h1 className="mt-3 max-w-xl text-5xl font-semibold leading-tight tracking-tight">Build something useful.</h1>
        <p className="mt-5 max-w-lg text-muted-foreground">
          A small, understandable foundation for projects, sessions, and auth.
        </p>
        <Link
          href={signedIn ? "/new" : "/login"}
          className="mt-8 inline-block rounded-md bg-foreground px-4 py-2 text-sm text-background"
        >
          {signedIn ? "New project" : "Get started"}
        </Link>
      </section>
      {signedIn && (
        <section className="border-t border-border pt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold tracking-tight">Projects</h2>
            <Link href="/new" className="text-sm text-muted-foreground">
              Add project
            </Link>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/p/${project.id}`}
                className="rounded-md border border-border p-4 hover:bg-card"
              >
                <p>{project.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {project.repo || "No repository"}
                </p>
              </Link>
            ))}
            {projects.length === 0 && (
              <p className="text-sm text-muted-foreground">No projects yet.</p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
