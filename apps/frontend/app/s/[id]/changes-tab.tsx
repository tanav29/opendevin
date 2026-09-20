"use client";

import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles, type FileDiffOptions, type FileDiffMetadata } from "@pierre/diffs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ChangesTab({
  sessionId,
  sandboxId,
  available,
  active,
  defaultTitle,
  onReconnect,
}: {
  sessionId: string;
  sandboxId: string;
  available: boolean;
  active: boolean;
  defaultTitle: string;
  onReconnect: () => void;
}) {
  const [diff, setDiff] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [persisted, setPersisted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState("");
  const [commitDone, setCommitDone] = useState("");
  const [reverting, setReverting] = useState("");

  type DiffPayload = { diff?: string; truncated?: boolean; persisted?: boolean; error?: string };

  const readDiff = useCallback(async (): Promise<{ ok: boolean; payload: DiffPayload }> => {
    if (!sessionId) return { ok: false, payload: { error: "" } };
    try {
      const payload = await api<DiffPayload>(`/api/sessions/${sessionId}/diff`);
      return { ok: true, payload };
    } catch {
      return {
        ok: false,
        payload: { error: "Changes unavailable: could not reach the server. Retry." },
      };
    }
  }, [sessionId]);

  const applyDiff = useCallback(({ ok, payload }: { ok: boolean; payload: DiffPayload }) => {
    if (!ok) {
      setError(payload.error || "Changes unavailable.");
    } else {
      // Keep the last diff readable: only overwrite on success.
      setDiff(payload.diff ?? "");
      setTruncated(Boolean(payload.truncated));
      setPersisted(Boolean(payload.persisted));
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

  async function downloadPatch() {
    if (!diff) return;
    const blob = new Blob([diff], { type: "text/x-patch" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `session-${sessionId.slice(-8)}.patch`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function revertFile(path: string) {
    setReverting(path);
    try {
      await api(`/api/sessions/${sessionId}/revert`, {
        method: "POST",
        body: JSON.stringify({ path }),
      });
      refresh();
    } catch {
      setError("Could not revert: server unreachable.");
    } finally {
      setReverting("");
    }
  }

  async function commit() {
    if (committing) return;
    const message = commitMessage.trim();
    setCommitting(true);
    setCommitError("");
    try {
      const data = await api<{ branch?: string }>(`/api/sessions/${sessionId}/commit`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      setCommitDone(data.branch ? `Pushed to ${data.branch}` : "Pushed");
      setCommitOpen(false);
      setCommitMessage("");
      refresh();
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : "Commit failed.");
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
            disabled={!diff}
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
      {error && (
        <p className="border-b border-border bg-danger-muted px-3 py-2 text-xs text-danger">
          {error}{" "}
          <button onClick={refresh} className="underline">
            Retry
          </button>
        </p>
      )}
      {!available && diff && (
        <p className="border-b border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          Showing the last saved diff — the sandbox is not running.{" "}
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
              Commit workspace changes (if any) and push the session branch to the remote.
            </DialogDescription>
          </DialogHeader>
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
              disabled={committing}
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
