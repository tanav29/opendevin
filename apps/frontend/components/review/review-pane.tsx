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

import { sessionTitle, type Session } from "@/components/providers";
import { Button } from "@/components/ui/button";
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
  const patch = useMemo(() => parsePatch(session.diff), [session.diff]);
  const highlighter = useHighlighter();
  const [github, setGithub] = useState<
    { connected: boolean; login?: string } | undefined
  >();
  const [publishing, setPublishing] = useState(false);
  const hasDiff = patch.files.length > 0;

  useEffect(() => {
    void fetch("/api/github/session")
      .then((response) => response.json())
      .then((value) => setGithub(value as { connected: boolean }))
      .catch(() => setGithub({ connected: false }));
    const status = new URLSearchParams(window.location.search).get("github");
    if (status === "connected") toast.success("GitHub connected.");
    if (status === "error") toast.error("Could not connect GitHub.");
    if (status) window.history.replaceState({}, "", window.location.pathname);
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

  async function publishChanges() {
    if (!session.diff || publishing) return;
    setPublishing(true);
    const loading = toast.loading("Creating pull request…");
    try {
      const response = await fetch("/api/github/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          git: session.git,
          diff: session.diff,
          title: sessionTitle(session),
        }),
      });
      const result = (await response.json()) as {
        number?: number;
        url?: string;
        error?: string;
      };
      if (!response.ok || !result.number || !result.url) {
        throw new Error(result.error || "Could not create the pull request.");
      }
      await updateSession({
        id: session.id as never,
        PRNumber: result.number,
        prUrl: result.url,
      });
      toast.success(`Pull request #${result.number} created.`, { id: loading });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not create the pull request.",
        { id: loading },
      );
    } finally {
      setPublishing(false);
    }
  }

  if (collapsed) {
    return (
      <aside
        style={style}
        className={cn(
          "flex w-10 shrink-0 flex-col items-center border-l bg-surface-1 py-2",
          className,
        )}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Show changes"
                onClick={onToggle}
              >
                <PanelRightOpen />
              </Button>
            }
          />
          <TooltipContent side="left">Show changes</TooltipContent>
        </Tooltip>
        {hasDiff && (
          <span
            data-numeric
            className="mono mt-2 text-[10px] text-muted-foreground [writing-mode:vertical-rl]"
          >
            {patch.files.length}
          </span>
        )}
      </aside>
    );
  }

  return (
    <aside
      style={style}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col border-l bg-background",
        className,
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-1.5 border-b px-1.5">
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
          <>
            <span
              data-numeric
              className="mono text-[11px] text-muted-foreground"
            >
              {patch.files.length} {patch.files.length === 1 ? "file" : "files"}
            </span>
            <Stat file={patch} />
          </>
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

        {session.prUrl ? (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <a href={session.prUrl} target="_blank" rel="noreferrer noopener" />
            }
          >
            <IconBrandGithub />
            PR #{session.PRNumber}
            <ExternalLink />
          </Button>
        ) : github?.connected ? (
          <Button size="sm" disabled={!hasDiff || publishing} onClick={publishChanges}>
            {publishing ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <IconBrandGithub />
            )}
            Create pull request
          </Button>
        ) : (
          // Leaves the app for GitHub's OAuth flow, so it has to be a real link.
          <Button
            size="sm"
            disabled={github === undefined}
            nativeButton={false}
            render={<a href="/api/github/login?returnTo=/" />}
          >
            <IconBrandGithub />
            Connect GitHub
          </Button>
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
    </aside>
  );
}
