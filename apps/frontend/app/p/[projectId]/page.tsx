"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery as useConvexQuery } from "convex/react";
import { ArrowUpRight, ChevronRight, FolderGit2 } from "lucide-react";
import { toast } from "sonner";

import { Composer } from "@/components/chat/composer";
import { GitHubRepositoryBranchPicker } from "@/components/github/repository-branch-picker";
import { mapSessions, sessionTitle, useSessionSelection, type Session } from "@/components/providers";
import { PageHeader, PageShell, PageContainer } from "@/components/ui/page-header";
import { InlineEmpty, SectionLabel } from "@/components/ui/empty-state";
import { StatusDot, statusLabel } from "@/components/ui/status-dot";
import { parsePatch } from "@/lib/diff";
import { plural, repoName, timeAgo, timestamp } from "@/lib/format";
import { api } from "@convex/_generated/api";

function SessionRow({ session, onOpen }: { session: Session; onOpen: () => void }) {
  const patch = useMemo(() => parsePatch(session.diff), [session.diff]);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-2.5 rounded-lg border bg-surface-2 px-3 py-2.5 text-left transition-colors duration-100 hover:border-border-strong hover:bg-surface-3"
    >
      <StatusDot status={session.status} className="mt-px shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">{sessionTitle(session)}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{statusLabel(session.status)}</span>
          <span className="opacity-40">·</span>
          <span title={timestamp(session.updatedAt)}>{timeAgo(session.updatedAt)}</span>
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
  const project = useConvexQuery(api.projects.get, params.projectId ? { id: params.projectId as never } : "skip");
  const sessionsResult = useConvexQuery(
    api.sessions.byProject,
    params.projectId ? { projectId: params.projectId as never } : "skip",
  );
  const sessions = useMemo(
    () => mapSessions(sessionsResult as unknown[] | undefined).filter((s) => !s.archived),
    [sessionsResult],
  );
  const [creating, setCreating] = useState(false);
  const [baseBranch, setBaseBranch] = useState<string>();
  const working = sessions.filter((s) => s.status === "running");
  const rest = sessions.filter((s) => s.status !== "running");

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
        baseBranch,
      });
      if (!session) throw new Error("Could not create the session.");
      toast.success("Session started.", { id: loading });
      window.sessionStorage.setItem("opendevin:initial-prompt", task);
      selectSession(session._id);
      router.push(`/s/${session._id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the session.", { id: loading });
      setCreating(false);
    }
  }

  const openSession = (id: string) => {
    selectSession(id);
    router.push(`/s/${id}`);
  };

  return (
    <PageShell
      header={
        <PageHeader
          icon={<FolderGit2 className="size-3.5" />}
          title={project ? project.name : "Project"}
          description={project?.git ? repoName(project.git) : undefined}
          actions={
            project?.git ? (
              <a
                href={project.git}
                target="_blank"
                rel="noreferrer noopener"
                className="mono hidden items-center gap-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground sm:flex"
              >
                Open in GitHub <ArrowUpRight className="size-3" />
              </a>
            ) : undefined
          }
        />
      }
    >
      <PageContainer className="pt-10 pb-12">
        <p className="eyebrow">New session</p>
        <h2 className="mt-2 text-[22px] font-medium tracking-[-0.025em]">What should we change?</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Every session gets its own sandbox with{" "}
          <span className="mono text-foreground">{project?.git ? repoName(project.git) : "the repository"}</span> checked
          out, so they never step on each other.
        </p>

        <div className="mt-4 rounded-xl border bg-surface-1 p-3">
          <GitHubRepositoryBranchPicker
            value={{ git: project?.git || "", baseBranch }}
            lockRepository
            onChange={({ baseBranch: next }) => setBaseBranch(next)}
          />
        </div>

        <div className="mt-3">
          <Composer
            busy={creating}
            disabled={!project}
            onSend={(t) => void start(t)}
            placeholder="Describe the task for this session…"
          />
        </div>

        {working.length > 0 && (
          <section className="mt-8">
            <SectionLabel>Working now · {working.length}</SectionLabel>
            <div className="mt-3 space-y-1.5">
              {working.map((s) => (
                <SessionRow key={s.id} session={s} onOpen={() => openSession(s.id)} />
              ))}
            </div>
          </section>
        )}

        <section className="mt-8">
          <SectionLabel>Sessions · {rest.length}</SectionLabel>
          {rest.length === 0 ? (
            <InlineEmpty className="mt-3">No sessions yet. Describe a task above to start the first one.</InlineEmpty>
          ) : (
            <div className="mt-3 space-y-1.5">
              {rest.map((s) => (
                <SessionRow key={s.id} session={s} onOpen={() => openSession(s.id)} />
              ))}
            </div>
          )}
        </section>
      </PageContainer>
    </PageShell>
  );
}
