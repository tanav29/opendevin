"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { API } from "./lib";

type DiffFile = {
  header: string;
  path: string;
  additions: number;
  deletions: number;
  lines: string[];
};

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = {
        header: line,
        path: line.replace(/^diff --git a\/(.*?) b\/.*$/, "$1"),
        additions: 0,
        deletions: 0,
        lines: [],
      };
      files.push(current);
    } else if (current) {
      current.lines.push(line);
      if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) current.deletions += 1;
    }
  }
  return files;
}

function DiffLine({ line }: { line: string }) {
  const className =
    line.startsWith("+") && !line.startsWith("+++")
      ? "bg-success-muted text-success"
      : line.startsWith("-") && !line.startsWith("---")
        ? "bg-danger-muted text-danger"
        : line.startsWith("@@")
          ? "bg-muted font-medium text-muted-foreground"
          : line.startsWith("diff --git") ||
              line.startsWith("index ") ||
              line.startsWith("+++") ||
              line.startsWith("---")
            ? "font-medium text-muted-foreground"
            : "text-muted-foreground";
  return (
    <div className={`whitespace-pre px-3 font-mono text-xs leading-5 ${className}`}>
      {line || " "}
    </div>
  );
}

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
  const [publishBranch, setPublishBranch] = useState("");
  const [publishTitle, setPublishTitle] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState("");

  type DiffPayload = { diff?: string; truncated?: boolean; persisted?: boolean; error?: string };

  const readDiff = useCallback(async (): Promise<{ ok: boolean; payload: DiffPayload }> => {
    try {
      const response = await fetch(`${API}/api/sessions/${sessionId}/diff`, {
        credentials: "include",
      });
      const payload = (await response.json().catch(() => ({}))) as DiffPayload;
      return { ok: response.ok, payload };
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
    }
    setLoading(false);
  }, []);

  // Load persisted diff on mount even when the sandbox is gone; refetch live
  // whenever the tab becomes active or the sandbox changes.
  useEffect(() => {
    let cancelled = false;
    void readDiff().then((result) => {
      if (!cancelled) applyDiff(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, readDiff, applyDiff]);

  useEffect(() => {
    if (!active || !available) return;
    let cancelled = false;
    void readDiff().then((result) => {
      if (!cancelled) applyDiff(result);
    });
    return () => {
      cancelled = true;
    };
  }, [active, available, sandboxId, readDiff, applyDiff]);

  function refresh() {
    setLoading(true);
    setError("");
    void readDiff().then(applyDiff);
  }

  const files = useMemo(() => parseDiff(diff || ""), [diff]);
  const totalAdd = files.reduce((n, f) => n + f.additions, 0);
  const totalDel = files.reduce((n, f) => n + f.deletions, 0);

  async function downloadPatch() {
    if (!diff) return;
    const blob = new Blob([diff], { type: "text/x-patch" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `session-${sessionId.slice(-8)}.patch`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function publish() {
    setPublishing(true);
    setPublishResult("");
    try {
      const response = await fetch(`${API}/api/sessions/${sessionId}/publish`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: publishBranch, title: publishTitle || defaultTitle }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        branch?: string;
        prUrl?: string;
        error?: string;
      };
      setPublishResult(response.ok ? `PR_OPENED:${data.prUrl}` : data.error || "Publish failed.");
    } catch {
      setPublishResult("Publish failed: could not reach the server.");
    } finally {
      setPublishing(false);
    }
  }

  if (!available && !diff) {
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
              ? `${files.length} files · +${totalAdd} −${totalDel}${truncated ? " · truncated" : ""}${persisted ? " · saved" : ""}`
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
        </div>
      </div>
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
        {diff !== null && files.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-sm font-medium">No changes</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              The workspace matches HEAD. Ask the agent to edit files.
            </p>
          </div>
        )}
        {files.map((file, i) => (
          <div key={`${file.path}-${i}`} className="mb-3 overflow-x-auto border-y border-border">
            <div className="sticky left-0 flex items-center justify-between gap-2 bg-muted px-3 py-1.5">
              <span className="truncate font-mono text-xs font-medium">{file.path}</span>
              <span className="shrink-0 font-mono text-[11px]">
                <span className="text-success">+{file.additions}</span>{" "}
                <span className="text-danger">−{file.deletions}</span>
              </span>
            </div>
            {file.lines.map((line, j) => (
              <DiffLine key={j} line={line} />
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Publish to GitHub
        </p>
        <input
          value={publishBranch}
          onChange={(e) => setPublishBranch(e.target.value)}
          placeholder={`Branch (default opendevin/session-${sessionId.slice(-8)})`}
          className="mt-2 w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
        />
        <input
          value={publishTitle}
          onChange={(e) => setPublishTitle(e.target.value)}
          placeholder={defaultTitle || "Pull request title"}
          className="mt-1.5 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
        />
        <button
          onClick={() => void publish()}
          disabled={publishing || !diff}
          className="mt-2 w-full rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
        >
          {publishing ? "Publishing…" : "Push branch + open PR"}
        </button>
        {publishResult &&
          (publishResult.startsWith("PR_OPENED:") ? (
            <a
              href={publishResult.slice(10)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block text-xs text-success underline"
            >
              Pull request opened ↗
            </a>
          ) : (
            <p className="mt-2 text-xs text-danger">{publishResult}</p>
          ))}
      </div>
    </div>
  );
}
