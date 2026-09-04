"use client";

import Link from "next/link";
import { isWorking, type SidebarSession } from "./lib";

export default function SessionSidebar({
  sessions,
  activeId,
  projectId,
}: {
  sessions: SidebarSession[];
  activeId: string;
  projectId: string;
}) {
  const groups = new Map<string, { name: string; sessions: SidebarSession[] }>();
  for (const session of sessions) {
    const group = groups.get(session.projectId) || { name: session.project.name, sessions: [] };
    group.sessions.push(session);
    groups.set(session.projectId, group);
  }

  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          OpenDevin
        </Link>
        <Link
          href={projectId ? `/p/${projectId}` : "/"}
          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Project
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {[...groups.entries()].map(([id, group]) => (
          <div key={id} className="mt-2">
            <p className="truncate px-2 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {group.name}
            </p>
            <div className="space-y-0.5">
              {group.sessions.map((session) => {
                const working = isWorking(session.status, session.sandboxStatus);
                const active = session.id === activeId;
                return (
                  <Link
                    key={session.id}
                    href={`/s/${session.id}`}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] leading-tight hover:bg-sidebar-accent ${
                      active
                        ? "bg-sidebar-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {working && (
                      <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="px-2 py-4 text-[13px] text-muted-foreground">No sessions yet.</p>
        )}
      </div>
    </aside>
  );
}
