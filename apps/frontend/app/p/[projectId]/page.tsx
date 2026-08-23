"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery as useConvexQuery } from "convex/react";
import { ArrowUpRight, ChevronRight, FolderGit2 } from "lucide-react";
import { toast } from "sonner";

import { Composer } from "@/components/chat/composer";
import {
  mapSessions,
  sessionTitle,
  useSessionSelection,
  type Session,
} from "@/components/providers";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { StatusDot, statusLabel } from "@/components/ui/status-dot";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { parsePatch } from "@/lib/diff";
import { plural, repoName, timeAgo, timestamp } from "@/lib/format";
import { api } from "@convex/_generated/api";

function SessionRow({
  session,
  onOpen,
}: {
  session: Session;
  onOpen: () => void;
}) {
  const patch = useMemo(() => parsePatch(session.diff), [session.diff]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-2.5 rounded-lg border bg-surface-2 px-3 py-2.5 text-left transition-colors duration-100 hover:border-border-strong hover:bg-surface-3"
    >
      <StatusDot status={session.status} className="mt-px shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">
          {sessionTitle(session)}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{statusLabel(session.status)}</span>
          <span className="opacity-40">·</span>
          <span title={timestamp(session.updatedAt)}>
            {timeAgo(session.updatedAt)}
          </span>
          {patch.files.length > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span data-numeric className="mono">
                {plural(patch.files.length, "file")}
              </span>
              <span data-numeric className="mono text-success">
                +{patch.additions}
              </span>
              <span data-numeric className="mono text-danger">
                −{patch.deletions}
              </span>
            </>
          )}
        </span>
      </span>
      {session.PRNumber && (
        <span data-numeric className="mono shrink-0 text-[11px] text-brand">
          #{session.PRNumber}
        </span>
      )}
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
    </button>
  );
}

export default function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const { selectSession } = useSessionSelection();
  const createSession = useMutation(api.sessions.create);
  const project = useConvexQuery(
    api.projects.get,
    params.projectId ? { id: params.projectId as never } : "skip",
  );
  const sessionsResult = useConvexQuery(
    api.sessions.byProject,
    params.projectId ? { projectId: params.projectId as never } : "skip",
  );
  const sessions = useMemo(
    () =>
      mapSessions(sessionsResult as unknown[] | undefined).filter(
        (session) => !session.archived,
      ),
    [sessionsResult],
  );
  const [creating, setCreating] = useState(false);
  const working = sessions.filter((session) => session.status === "running");
  const rest = sessions.filter((session) => session.status !== "running");

  async function start(task: string) {
    if (!project || creating) return;
    setCreating(true);
    const loading = toast.loading("Starting session…");
    try {
      const session = await createSession({
        projectId: params.projectId as never,
        git: project.git,
        status: "idle",
        title: task.slice(0, 80),
      });
      if (!session) throw new Error("Could not create the session.");
      toast.success("Session started.", {
        id: loading,
        description: "The repository is checked out when the agent starts.",
      });
      window.sessionStorage.setItem("opendevin:initial-prompt", task);
      selectSession(session._id);
      router.push(`/s/${session._id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create the session.",
        { id: loading },
      );
      setCreating(false);
    }
  }

  const openSession = (sessionId: string) => {
    selectSession(sessionId);
    router.push(`/s/${sessionId}`);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="z-10 flex h-11 shrink-0 items-center gap-1.5 border-b px-1.5 sm:px-2">
        <Tooltip>
          <TooltipTrigger render={<SidebarTrigger />} />
          <TooltipContent side="bottom">Toggle sidebar</TooltipContent>
        </Tooltip>
        <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
        <h1 className="min-w-0 truncate text-[13px] font-medium tracking-[-0.01em]">
          {project?.name ?? "Project"}
        </h1>
        {project?.git && (
          <a
            href={project.git}
            target="_blank"
            rel="noreferrer noopener"
            className="mono hidden min-w-0 items-center gap-1 truncate rounded px-1 text-[11.5px] text-muted-foreground transition-colors duration-100 hover:text-foreground sm:flex"
          >
            <span className="truncate">{repoName(project.git)}</span>
            <ArrowUpRight className="size-3 shrink-0" />
          </a>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 pt-10 pb-12 sm:px-6">
          <p className="eyebrow">New session</p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.02em]">
            What should we change?
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
            Every session gets its own sandbox with{" "}
            <span className="mono text-foreground">
              {project?.git ? repoName(project.git) : "the repository"}
            </span>{" "}
            checked out, so they never step on each other.
          </p>

          <div className="mt-4 -mx-3 sm:-mx-4">
            <Composer
              busy={creating}
              disabled={!project}
              onSend={(text) => void start(text)}
              placeholder="Describe the task for this session…"
            />
          </div>

          {working.length > 0 && (
            <section className="mt-6">
              <p className="eyebrow">Working now · {working.length}</p>
              <div className="mt-2 space-y-1.5">
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
            <p className="eyebrow">Sessions · {rest.length}</p>
            {rest.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed px-3 py-5 text-center text-[13px] text-muted-foreground">
                No sessions yet. Describe a task above to start the first one.
              </p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {rest.map((session) => (
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
      </div>
    </div>
  );
}
