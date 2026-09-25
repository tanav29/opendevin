"use client";

import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles, type FileDiffOptions, type FileDiffMetadata } from "@pierre/diffs";
import { IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";

export default function ChangesTab({
  sessionId,
  sandboxId,
  available,
  active,
  defaultTitle,
  onReconnect,
  onCommitted,
}: {
  sessionId: string;
  sandboxId: string;
  available: boolean;
  active: boolean;
  defaultTitle: string;
  onReconnect: () => void;
  onCommitted?: () => void;
}) {
  const confirm = useConfirm();
  const [diff, setDiff] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [persisted, setPersisted] = useState(false);
  const [recoveryPatch, setRecoveryPatch] = useState<{
    diff: string;
    capturedAt: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState("");
  const [commitDone, setCommitDone] = useState("");
  const [reverting, setReverting] = useState("");
  const [preflight, setPreflight] = useState<{
    repo: string;
    sourceBranch: string;
    destinationBranch: string;
    changedFileCount: number;
    untrackedFiles: string[];
    untrackedCount: number;
  } | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState("");
  const [confirmUntracked, setConfirmUntracked] = useState(false);

  type DiffPayload = {
    diff?: string;
    truncated?: boolean;
    persisted?: boolean;
    error?: string;
    recoveryPatch?: { diff: string; capturedAt: string | null } | null;
  };

  const readDiff = useCallback(async (): Promise<{ ok: boolean; payload: DiffPayload }> => {
    if (!sessionId) return { ok: false, payload: { error: "" } };
    try {
      const payload = await api<DiffPayload>(`/api/sessions/${sessionId}/diff`, undefined, 60_000);
      return { ok: true, payload };
    } catch {
      return {
        ok: false,
        payload: { error: "Changes unavailable: could not reach the server. Retry." },
      };
    }
  }, [sessionId]);

  const readPreflight = useCallback(async () => {
    setPreflightLoading(true);
    setPreflightError("");
    try {
      const data = await api<{
        repo: string;
        sourceBranch: string;
        destinationBranch: string;
        changedFileCount: number;
        untrackedFiles?: string[];
        untrackedCount?: number;
      }>(`/api/sessions/${sessionId}/commit/preflight`, undefined, 60_000);
      setPreflight({
        repo: data.repo,
        sourceBranch: data.sourceBranch,
        destinationBranch: data.destinationBranch,
        changedFileCount: data.changedFileCount,
        untrackedFiles: data.untrackedFiles || [],
        untrackedCount: data.untrackedCount || 0,
      });
      setConfirmUntracked(false);
    } catch (error) {
      setPreflight(null);
      setPreflightError(
        error instanceof Error ? error.message : "Could not check the publish target.",
      );
    } finally {
      setPreflightLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (commitOpen) void readPreflight();
  }, [commitOpen, readPreflight]);

  const applyDiff = useCallback(({ ok, payload }: { ok: boolean; payload: DiffPayload }) => {
    if (!ok) {
      toast.error(payload.error || "Changes unavailable.");
    } else {
      // Keep the last diff readable: only overwrite on success.
      setDiff(payload.diff ?? "");
      setTruncated(Boolean(payload.truncated));
      setPersisted(Boolean(payload.persisted));
      setRecoveryPatch(payload.recoveryPatch ?? null);
      setError("");
    }
    setLoading(false);
  }, []);

  // Load persisted diff on mount even when the sandbox is gone; refetch live
  // whenever the tab becomes active or the sandbox changes.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void readDiff().then((result) => {
      if (!cancelled) applyDiff(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, readDiff, applyDiff]);

  useEffect(() => {
    if (!sessionId || !active || !available) return;
    let cancelled = false;
    void readDiff().then((result) => {
      if (!cancelled) applyDiff(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, active, available, sandboxId, readDiff, applyDiff]);

  function refresh() {
    setLoading(true);
    setError("");
    void readDiff().then(applyDiff);
  }

  const diffOptions = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({
      theme: { dark: "pierre-dark", light: "pierre-light" },
      diffStyle: "unified",
      hunkSeparators: "line-info",
      lineDiffType: "word-alt",
      overflow: "scroll",
    }),
    [],
  );
  const parsedFiles = useMemo<FileDiffMetadata[]>(() => {
    if (!diff) return [];
    try {
      return parsePatchFiles(diff, `session-${sessionId}`).flatMap((patch) => patch.files);
    } catch {
      return [];
    }
  }, [diff, sessionId]);

  async function downloadPatch(content = diff, suffix = "") {
    if (!content) return;
    const blob = new Blob([content], { type: "text/x-patch" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `session-${sessionId.slice(-8)}${suffix}.patch`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function revertFile(path: string) {
    const confirmed = await confirm({
      title: `Revert ${path}?`,
      description:
        "This discards tracked edits and removes the untracked file. The change cannot be recovered from the workspace.",
      confirmLabel: "Revert file",
      destructive: true,
    });
    if (!confirmed) return;
    setReverting(path);
    try {
      await api(`/api/sessions/${sessionId}/revert`, {
        method: "POST",
        body: JSON.stringify({ path }),
      });
      refresh();
    } catch {
      toast.error("Could not revert: server unreachable.");
    } finally {
      setReverting("");
    }
  }

  const messageReady = Boolean(
    commitMessage.trim() &&
    preflight &&
    !preflightLoading &&
    (!preflight.untrackedCount || confirmUntracked),
  );

  async function commit() {
    if (committing || !messageReady) return;
    const message = commitMessage.trim();
    setCommitting(true);
    setCommitError("");
    try {
      const data = await api<{
        branch?: string;
        sourceBranch?: string;
        destinationBranch?: string;
        repo?: string;
        changedFileCount?: number;
      }>(
        `/api/sessions/${sessionId}/commit`,
        {
          method: "POST",
          body: JSON.stringify({
            message,
            confirmUntracked: preflight?.untrackedCount ? confirmUntracked : true,
          }),
        },
        180_000,
      );
      const target = data.destinationBranch || data.branch || "the generated session branch";
      setCommitDone(
        `Pushed ${data.changedFileCount ?? preflight?.changedFileCount ?? 0} files to ${target}`,
      );
      setCommitOpen(false);
      setCommitMessage("");
      refresh();
      onCommitted?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Commit failed.";
      setCommitError(message);
      if (err instanceof ApiError && err.code === "untracked_files") {
        setConfirmUntracked(false);
        await readPreflight();
      } else {
        toast.error(message);
      }
    } finally {
      setCommitting(false);
    }
  }

  if (!available && !diff && !loading && !error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium">Changes unavailable</p>
        <p className="max-w-60 text-[13px] text-muted-foreground">
          The sandbox is not running, so there is no workspace to diff.
        </p>
        <button
          onClick={onReconnect}
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
        >
          Reconnect sandbox
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="font-mono text-[11px] text-muted-foreground">
          {loading
            ? "Loading diff…"
            : diff
              ? `${parsedFiles.length} files${truncated ? " · truncated" : ""}${persisted ? " · saved" : ""}`
              : "No diff loaded"}
        </p>
        <div className="flex gap-1.5">
          <button
            onClick={refresh}
            disabled={loading}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Refresh
          </button>
          <button
            onClick={() => void downloadPatch()}
            disabled={!diff}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            .patch
          </button>
          <button
            onClick={() => {
              setCommitError("");
              setCommitDone("");
              setCommitOpen(true);
            }}
            disabled={!diff || !available}
            className="rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background disabled:opacity-40"
          >
            Commit
          </button>
        </div>
      </div>
      {commitDone && (
        <p className="border-b border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {commitDone}
        </p>
      )}
      {recoveryPatch && (
        <div className="flex items-center justify-between gap-3 border-b border-warning/40 bg-warning-muted/30 px-3 py-2 text-xs">
          <span>
            Recovery patch from the replaced workspace remains available
            {recoveryPatch.capturedAt
              ? ` (captured ${new Date(recoveryPatch.capturedAt).toLocaleString()})`
              : ""}
            . It is not applied to this sandbox.
          </span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => void downloadPatch(recoveryPatch.diff, "-recovery")}
          >
            Download
          </Button>
        </div>
      )}
      {!available && diff && (
        <p className="border-b border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          Showing the last saved diff — review/download only. The sandbox is not running and this
          patch is not applied to a replacement.{" "}
          <button onClick={onReconnect} className="underline">
            Reconnect
          </button>
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {diff === null && !loading && (
          <p className="px-3 py-6 text-[13px] text-muted-foreground">
            Open this tab to load the workspace diff.
          </p>
        )}
        {diff !== null && !diff && (
          <div className="px-3 py-6 text-center">
            <p className="text-sm font-medium">No changes</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              The workspace matches HEAD. Ask the agent to edit files.
            </p>
          </div>
        )}
        {diff && parsedFiles.length === 0 && (
          <div className="px-3 py-4">
            <p className="text-center text-[13px] text-muted-foreground">
              Pretty view could not parse this diff — showing raw patch.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-[11px] whitespace-pre">
              {diff.slice(0, 20000)}
            </pre>
          </div>
        )}
        {parsedFiles.map((fileDiff, index) => (
          <div key={`${fileDiff.name}-${index}`} className="mb-3 min-w-0 overflow-x-auto px-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {fileDiff.name}
              </p>
              <button
                onClick={() => void revertFile(fileDiff.name)}
                disabled={reverting === fileDiff.name}
                className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-40"
                title={`Revert ${fileDiff.name}`}
              >
                {reverting === fileDiff.name ? "…" : "Revert"}
              </button>
            </div>
            <FileDiff fileDiff={fileDiff} options={diffOptions} className="w-full" />
          </div>
        ))}
      </div>
      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Commit changes</DialogTitle>
            <DialogDescription>
              Review the exact remote target before committing and pushing.
            </DialogDescription>
          </DialogHeader>
          {preflightLoading ? (
            <p className="text-sm text-muted-foreground">Checking publish target…</p>
          ) : preflightError ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-danger">{preflightError}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void readPreflight()}
              >
                <IconRefresh className="size-3.5" /> Retry
              </Button>
            </div>
          ) : preflight ? (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-xs">
              <p>
                <span className="text-muted-foreground">Repository:</span> {preflight.repo}
              </p>
              <p>
                <span className="text-muted-foreground">Source branch:</span>{" "}
                {preflight.sourceBranch}
              </p>
              <p>
                <span className="text-muted-foreground">Destination branch:</span>{" "}
                {preflight.destinationBranch}
              </p>
              <p>
                <span className="text-muted-foreground">Changed files:</span>{" "}
                {preflight.changedFileCount}
              </p>
              {preflight.untrackedCount > 0 && (
                <label className="flex items-start gap-2 text-warning">
                  <input
                    type="checkbox"
                    checked={confirmUntracked}
                    onChange={(e) => setConfirmUntracked(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    `git add -A` includes {preflight.untrackedCount} untracked file(s). Review them
                    before pushing.
                    {preflight.untrackedFiles.length > 0 && (
                      <span className="mt-1 block font-mono text-[11px] break-all">
                        {preflight.untrackedFiles.join(", ")}
                      </span>
                    )}
                  </span>
                </label>
              )}
            </div>
          ) : null}
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder={defaultTitle || "Commit message"}
            rows={3}
            autoFocus
            className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
          {commitError && <p className="text-xs text-danger">{commitError}</p>}
          <div className="flex justify-end gap-1.5">
            <button
              onClick={() => setCommitOpen(false)}
              disabled={committing}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={() => void commit()}
              disabled={committing || !messageReady}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
            >
              {committing ? "Pushing…" : "Commit + push"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
