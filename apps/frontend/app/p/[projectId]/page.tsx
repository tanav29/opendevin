"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery as useConvexQuery } from "convex/react";
import {
  CheckCircle2,
  CircleDashed,
  FolderGit2,
  GitBranch,
  LoaderCircle,
  SendHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  API,
  mapSessions,
  sessionTitle,
  type Session,
  useSessionSelection,
} from "@/components/providers";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@convex/_generated/api";

function timeAgo(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusMeta(session: Session) {
  if (session.status === "running")
    return {
      label: "Working",
      badge: (
        <Badge variant="outline" className="gap-1 text-emerald-600">
          <LoaderCircle className="size-3 animate-spin" /> Working
        </Badge>
      ),
      icon: <LoaderCircle className="size-4 animate-spin text-emerald-600" />,
    };
  if (session.status === "stopped")
    return {
      label: "Stopped",
      badge: <Badge variant="outline">Stopped</Badge>,
      icon: <CircleDashed className="text-muted-foreground" />,
    };
  return {
    label: "Completed",
    badge: <Badge variant="outline">Completed</Badge>,
    icon: <CheckCircle2 className="text-emerald-600" />,
  };
}

function SessionRow({
  session,
  onOpen,
}: {
  session: Session;
  onOpen: () => void;
}) {
  const meta = statusMeta(session);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-md border bg-background px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
      <span className="shrink-0">{meta.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {sessionTitle(session)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          Updated {timeAgo(session.updatedAt)}
        </span>
      </span>
      {meta.badge}
    </button>
  );
}

export default function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const { selectSession } = useSessionSelection();
  const project = useConvexQuery(
    api.projects.get,
    params.projectId ? { id: params.projectId as never } : "skip",
  );
  const sessionsResult = useConvexQuery(
    api.sessions.byProject,
    params.projectId ? { projectId: params.projectId as never } : "skip",
  );
  const sessions = useMemo(
    () => mapSessions(sessionsResult as unknown[] | undefined),
    [sessionsResult],
  );
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const working = sessions.filter((session) => session.status === "running");
  const completed = sessions.filter((session) => session.status !== "running");

  async function createSession(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) {
      toast.error("Describe what this session should do.");
      return;
    }
    setCreating(true);
    const loadingToast = toast.loading("Starting sandbox…");
    try {
      const response = await fetch(
        `${API}/projects/${params.projectId}/sessions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt.trim() }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Could not create session.");
      toast.success("Session created", {
        id: loadingToast,
        description: "Your sandbox is ready.",
      });
      window.sessionStorage.setItem("opendevin:initial-prompt", prompt.trim());
      setPrompt("");
      selectSession(data.sessionId);
      router.push(`/s/${data.sessionId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create session.",
        { id: loadingToast },
      );
    } finally {
      setCreating(false);
    }
  }

  const openSession = (sessionId: string) => {
    selectSession(sessionId);
    router.push(`/s/${sessionId}`);
  };

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <header className="z-10 flex h-10 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
        <Tooltip>
          <TooltipTrigger render={<SidebarTrigger />} />
          <TooltipContent>Toggle sidebar</TooltipContent>
        </Tooltip>
        <FolderGit2 className="size-4 text-muted-foreground" />
        <h1 className="truncate text-sm font-medium">
          {project?.name ?? "Project"}
        </h1>
        <a
          href={project?.git}
          target="_blank"
          rel="noreferrer"
          className="ml-1 hidden items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground sm:flex">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{project?.git}</span>
        </a>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
          <section className="rounded-md border bg-background p-3">
            <p className="text-sm font-medium">New session</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Each session gets its own sandbox with this repository checked
              out.
            </p>
            <form onSubmit={createSession} className="mt-2.5 flex items-end gap-1.5">
              <Textarea
                value={prompt}
                disabled={creating}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    createSession(event);
                  }
                }}
                placeholder="Describe the task for this session…"
                rows={2}
                className="min-h-9 resize-none"
              />
              <Button
                type="submit"
                size="icon-sm"
                aria-label="Create session"
                disabled={creating || !prompt.trim()}>
                {creating ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <SendHorizontal />
                )}
              </Button>
            </form>
          </section>

          {working.length > 0 && (
            <section className="mt-6">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Working now · {working.length}
              </h2>
              <div className="mt-2 space-y-2">
                {working.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    onOpen={() => openSession(session.id)}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="mt-6">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sessions · {completed.length}
            </h2>
            {completed.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                No sessions yet. Create one above.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {completed.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    onOpen={() => openSession(session.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </main>
  );
}