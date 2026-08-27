"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation } from "convex/react";
import { PatchDiff } from "@pierre/diffs/react";
import { IconBrandGithub } from "@tabler/icons-react";
import {
  ChevronRight,
  Download,
  ExternalLink,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { toast } from "sonner";

import { sessionTitle, useGitHubFetch, useGitHubSession, type Session } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { parsePatch, statusLabel, type FileStatus, type PatchFile } from "@/lib/diff";
import { count } from "@/lib/format";
import { DIFF_THEME, useHighlighter } from "@/lib/highlighter";
import { cn } from "@/lib/utils";
import { api } from "@convex/_generated/api";

/**
 * The file path already sits in the trigger row above each diff, so the
 * library's own header is turned off rather than duplicated.
 */
const DIFF_OPTIONS = {
  theme: DIFF_THEME,
  themeType: "dark",
  disableFileHeader: true,
  diffStyle: "unified",
  overflow: "scroll",
  lineDiffType: "word",
} as const;

const STATUS_CHIP: Record<FileStatus, string> = {
  added: "text-success bg-success-muted",
  deleted: "text-danger bg-danger-muted",
  modified: "text-brand bg-brand-muted",
  renamed: "text-warning bg-warning-muted",
};

/** Additions and deletions, always in the same order and column. */
function Stat({ file }: { file: Pick<PatchFile, "additions" | "deletions"> }) {
  return (
    <span data-numeric className="mono flex shrink-0 items-center gap-1.5 text-[11px]">
      <span className={file.additions ? "text-success" : "text-muted-foreground/50"}>
        +{count(file.additions)}
      </span>
      <span className={file.deletions ? "text-danger" : "text-muted-foreground/50"}>
        −{count(file.deletions)}
      </span>
    </span>
  );
}

function FileRow({
  file,
  defaultOpen,
  plain,
}: {
  file: PatchFile;
  defaultOpen: boolean;
  /** Shiki never loaded — show the patch as-is rather than nothing. */
  plain: boolean;
}) {
  const directory = file.path.slice(0, file.path.lastIndexOf("/") + 1);
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);

  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger className="group/file sticky top-0 z-10 flex w-full items-center gap-2 bg-background/85 px-2 py-1.5 text-left backdrop-blur-sm transition-colors duration-100 hover:bg-surface-2">
        <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[panel-open]/file:rotate-90" />
        <span
          aria-hidden
          title={statusLabel(file.status)}
          className={cn(
            "mono grid size-4 shrink-0 place-items-center rounded text-[9px] font-medium uppercase",
            STATUS_CHIP[file.status],
          )}
        >
          {file.status[0]}
        </span>
        <span className="mono min-w-0 flex-1 truncate text-[12px]">
          <span className="text-muted-foreground">{directory}</span>
          <span className="text-foreground">{name}</span>
        </span>
        {file.binary ? (
          <span className="eyebrow shrink-0">binary</span>
        ) : (
          <Stat file={file} />
        )}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        {file.binary ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Binary file — no text diff to show.
          </p>
        ) : plain ? (
          <pre className="mono overflow-x-auto px-3 py-2 text-[12px] leading-[1.6] text-muted-foreground">
            {file.patch}
          </pre>
        ) : (
          <PatchDiff
            patch={file.patch}
            // No worker pool is configured, so highlighting runs on the main
            // thread — see lib/highlighter for why the pane waits for it.
            disableWorkerPool
            options={DIFF_OPTIONS}
            // The theme's own separator band is a 15% white mix, far brighter
            // than anything else here. Match the file row's hover tone instead.
            className="text-[12px] [--diffs-bg-separator-override:var(--surface-2)]"
          />
        )}
      </CollapsiblePanel>
    </Collapsible>
  );
}

export function ReviewPane({
  session,
  collapsed,
  onToggle,
  className,
  style,
}: {
  session: Session;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const updateSession = useMutation(api.sessions.update);
  const githubFetch = useGitHubFetch();
  const github = useGitHubSession();
  const patch = useMemo(() => parsePatch(session.diff), [session.diff]);
  const highlighter = useHighlighter();
  const [publishing, setPublishing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const hasDiff = patch.files.length > 0;

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("github");
    if (status === "connected") toast.success("GitHub connected.");
    if (status === "error") toast.error("Could not connect GitHub.");
  }, []);

  function downloadPatch() {
    if (!session.diff) return;
    const slug =
      sessionTitle(session)
        .replace(/[^a-z0-9-_]+/gi, "-")
        .toLowerCase()
        .replace(/^-+|-+$/g, "") || "opendevin";
    const url = URL.createObjectURL(
      new Blob([session.diff], { type: "text/x-diff;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug}.patch`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function commitChanges() {
    if (!session.diff || committing) return;
    const title = commitMessage.trim() || sessionTitle(session);
    setCommitting(true);
    const loading = toast.loading(session.agentBranch ? "Updating agent branch…" : "Committing changes…");
    try {
      const response = await githubFetch("/api/github/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          git: session.git,
          diff: session.diff,
          title,
          baseBranch: session.baseBranch,
          branch: session.agentBranch || `opendevin/${session.id}`,
        }),
      });
      const result = (await response.json()) as {
        branch?: string;
        sha?: string;
        repository?: string;
        baseBranch?: string;
        error?: string;
      };
      if (!response.ok || !result.branch || !result.sha || !result.repository) {
        throw new Error(result.error || "Could not commit changes.");
      }
      await updateSession({
        id: session.id as never,
        agentBranch: result.branch,
        commitSha: result.sha,
        publishRepository: result.repository,
        baseBranch: result.baseBranch,
      });
      setCommitOpen(false);
      toast.success(session.agentBranch ? "Agent branch updated." : "Changes committed to the agent branch.", { id: loading });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not commit changes.", { id: loading });
    } finally {
      setCommitting(false);
    }
  }

  async function publishChanges() {
    if (!session.agentBranch || !session.publishRepository || !session.baseBranch || publishing) return;
    setPublishing(true);
    const loading = toast.loading("Creating pull request…");
    try {
      const response = await githubFetch("/api/github/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          git: session.git,
          title: sessionTitle(session),
          baseBranch: session.baseBranch,
          branch: session.agentBranch,
          publishRepository: session.publishRepository,
        }),
      });
      const result = (await response.json()) as { number?: number; url?: string; error?: string };
      if (!response.ok || !result.number || !result.url) {
        throw new Error(result.error || "Could not create the pull request.");
      }
      await updateSession({ id: session.id as never, PRNumber: result.number, prUrl: result.url });
      toast.success(`Pull request #${result.number} created.`, { id: loading });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the pull request.", { id: loading });
    } finally {
      setPublishing(false);
    }
  }

  if (collapsed) {
    return (
      <aside style={style} className={cn("flex w-10 shrink-0 flex-col items-center border-l bg-surface-1 py-2", className)}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Show changes" onClick={onToggle}>
                <PanelRightOpen />
              </Button>
            }
          />
          <TooltipContent side="left">Show changes</TooltipContent>
        </Tooltip>
        {hasDiff && (
          <span data-numeric className="mono mt-3 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-medium text-brand-foreground">
            {patch.files.length}
          </span>
        )}
      </aside>
    );
  }

  return (
    <aside style={style} className={cn("flex min-h-0 min-w-0 flex-1 flex-col border-l bg-background", className)}>
      <header className="flex h-11 shrink-0 items-center gap-1.5 border-b bg-background px-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Hide changes"
                onClick={onToggle}
              >
                <PanelRightClose />
              </Button>
            }
          />
          <TooltipContent side="bottom">Hide changes</TooltipContent>
        </Tooltip>

        <span className="text-[13px] font-medium tracking-[-0.01em]">Changes</span>
        {hasDiff && (
          <span className="hidden items-center gap-2 sm:flex">
            <span data-numeric className="mono rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {patch.files.length} {patch.files.length === 1 ? "file" : "files"}
            </span>
            <Stat file={patch} />
          </span>
        )}

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Download patch"
                disabled={!hasDiff}
                onClick={downloadPatch}
              >
                <Download />
              </Button>
            }
          />
          <TooltipContent side="bottom">Download patch</TooltipContent>
        </Tooltip>

        {github?.connected ? (
          <>
            {session.prUrl && (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<a href={session.prUrl} target="_blank" rel="noreferrer noopener" />}
              >
                <IconBrandGithub />
                PR #{session.PRNumber}
                <ExternalLink />
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!hasDiff || committing}
              onClick={() => {
                setCommitMessage(sessionTitle(session));
                setCommitOpen(true);
              }}
            >
              <IconBrandGithub />
              {session.agentBranch ? "Update branch" : "Commit changes"}
            </Button>
            {!session.prUrl && session.agentBranch && (
              <Button size="sm" disabled={publishing} onClick={publishChanges}>
                {publishing ? <LoaderCircle className="animate-spin" /> : <IconBrandGithub />}
                Create pull request
              </Button>
            )}
          </>
        ) : github === undefined ? (
          <span className="text-xs text-muted-foreground">Checking GitHub…</span>
        ) : (
          <span className="hidden text-xs text-muted-foreground lg:inline">
            GitHub access required — re-authenticate to commit.
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasDiff ? (
          <div className="flex h-full items-center justify-center px-6 py-10">
            <div className="max-w-56 text-center">
              <p className="text-[13px] font-medium">No changes yet</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Edits the agent makes to the repository show up here as a diff.
              </p>
            </div>
          </div>
        ) : highlighter === "loading" ? (
          // Rows only mount once Shiki is warm: a panel measures its height on
          // open and never re-measures, so content arriving late stays clipped.
          <div aria-busy className="space-y-1 p-2">
            {patch.files.map((file) => (
              <div
                key={file.id}
                className="h-4 animate-pulse rounded bg-surface-2"
              />
            ))}
          </div>
        ) : (
          patch.files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              plain={highlighter === "failed"}
              defaultOpen={patch.files.length <= 3}
            />
          ))
        )}
      </div>

      {commitOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="commit-title"
            className="w-full max-w-md rounded-xl border bg-background p-5 shadow-2xl"
          >
            <p className="eyebrow">Review commit</p>
            <h2 id="commit-title" className="mt-2 text-base font-medium tracking-[-0.01em]">
              {session.agentBranch ? "Update agent branch" : "Commit changes"}
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              This commit will include {patch.files.length} {patch.files.length === 1 ? "changed file" : "changed files"} on {session.agentBranch || `opendevin/${session.id}`}.
            </p>
            <ul className="mono mt-3 max-h-32 space-y-1 overflow-y-auto rounded-md border bg-surface-1 p-2 text-[11px] text-muted-foreground">
              {patch.files.map((file) => <li key={file.id} className="truncate">{file.path}</li>)}
            </ul>
            <label className="mt-4 block text-[13px] font-medium">
              Commit message
              <Textarea
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                rows={3}
                className="mt-1.5 resize-none text-[13px]"
              />
            </label>
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">Generated from the session title. Edit it before committing.</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="outline" disabled={committing} onClick={() => setCommitOpen(false)}>Cancel</Button>
              <Button size="sm" disabled={!commitMessage.trim() || committing} onClick={() => void commitChanges()}>
                {committing && <LoaderCircle className="animate-spin" />}
                Commit changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
