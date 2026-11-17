"use client";

import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles, type FileDiffOptions, type FileDiffMetadata } from "@pierre/diffs";
import { Download, GitBranch, Pencil, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";

export default function ChangesTab({
  sessionId,
  sandboxId,
  available,
  active,
  onReconnect,
  onCommitted,
  onUseComment,
}: {
  sessionId: string;
  sandboxId: string;
  available: boolean;
  active: boolean;
  defaultTitle: string;
  onReconnect: () => void;
  onCommitted?: () => void;
  onUseComment: (comment: string) => void;
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
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [committing, setCommitting] = useState(false);
  const [creatingPr, setCreatingPr] = useState(false);
  const [createdPr, setCreatedPr] = useState<{ url: string; number: number } | null>(null);
  const [editingBranch, setEditingBranch] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [reverting, setReverting] = useState("");
  const [git, setGit] = useState<{
    branch: string;
    files: { path: string; staged: string; unstaged: string }[];
    commits: { hash: string; subject: string }[];
    commitsError: string;
    workspaceError: string;
    pullRequests: {
      number: number;
      title: string;
      url: string;
      state: string;
      comments: { id: string; author: string; body: string; path?: string; url: string }[];
    }[];
    pullRequestError: string;
  } | null>(null);
  const [gitError, setGitError] = useState("");
  const readGit = useCallback(async () => {
    try {
      const data = await api<NonNullable<typeof git>>(
        `/api/sessions/${sessionId}/git`,
        undefined,
        60_000,
      );
      setGit(data);
      setGitError("");
    } catch (error) {
      setGitError(error instanceof Error ? error.message : "Could not load Git details.");
    }
  }, [sessionId]);

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
    } catch (error) {
      return {
        ok: false,
        payload: { error: error instanceof Error ? error.message : "Changes unavailable. Retry." },
      };
    }
  }, [sessionId]);

  const applyDiff = useCallback(({ ok, payload }: { ok: boolean; payload: DiffPayload }) => {
    if (!ok) {
      toast.error(payload.error || "Changes unavailable.");
    } else {
      // Keep the last diff readable: only overwrite on success.
      setDiff(payload.diff ?? "");
      setTruncated(Boolean(payload.truncated));
      setPersisted(Boolean(payload.persisted));
      setRecoveryPatch(payload.recoveryPatch ?? null);
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

  useEffect(() => {
    if (active) void readGit();
  }, [active, sandboxId, readGit]);

  function refresh() {
    setLoading(true);
    void readDiff().then(applyDiff);
    void readGit();
  }

  async function renameBranch(event: React.FormEvent) {
    event.preventDefault();
    setRenaming(true);
    try {
      await api(`/api/sessions/${sessionId}/branch`, {
        method: "POST",
        body: JSON.stringify({ branch: branchName }),
      });
      setEditingBranch(false);
      refresh();
      toast.success("Branch renamed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rename branch.");
    } finally {
      setRenaming(false);
    }
  }

  const diffOptions = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({
      theme: { dark: "pierre-dark", light: "pierre-light" },
      diffStyle: "unified",
      hunkSeparators: "line-info",
      lineDiffType: "word-alt",
      overflow: "scroll",
      disableFileHeader: true,
    }),
    [],
  );
  const parsedFiles = useMemo<FileDiffMetadata[]>(() => {
    if (!diff) return [];
    try {
      return parsePatchFiles(diff).flatMap((patch) => patch.files);
    } catch {
      return [];
    }
  }, [diff]);

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

  const includedFiles = (git?.files || []).filter(
    (file) => !selectedFiles.length || selectedFiles.includes(file.path),
  );
  async function commit() {
    if (committing || !available) return;
    setCommitting(true);
    try {
      const data = await api<{
        branch?: string;
        sourceBranch?: string;
        destinationBranch?: string;
        repo?: string;
        changedFileCount?: number;
        message?: string;
      }>(
        `/api/sessions/${sessionId}/commit`,
        {
          method: "POST",
          body: JSON.stringify({
            files: selectedFiles,
            confirmUntracked: true,
          }),
        },
        180_000,
      );
      const target = data.destinationBranch || data.branch || "the generated session branch";
      const result = `Pushed ${data.changedFileCount ?? includedFiles.length} files to ${target}`;
      toast.success(result);
      setSelectedFiles([]);
      refresh();
      onCommitted?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Commit failed.";
      toast.error(message);
      refresh();
    } finally {
      setCommitting(false);
    }
  }

  async function createPullRequest(event: React.FormEvent) {
    event.preventDefault();
    setCreatingPr(true);
    try {
      try {
        await api(
          `/api/sessions/${sessionId}/commit`,
          {
            method: "POST",
            body: JSON.stringify({
              files: selectedFiles,
              confirmUntracked: true,
              forPullRequest: true,
            }),
          },
          180_000,
        );
        setSelectedFiles([]);
        onCommitted?.();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("Nothing to commit")) throw error;
      }
      const result = await api<{ url: string; number: number }>(
        `/api/sessions/${sessionId}/pull-request`,
        {
          method: "POST",
        },
      );
      setCreatedPr(result);
      void readGit();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create pull request.");
    } finally {
      setCreatingPr(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {editingBranch ? (
          <form onSubmit={renameBranch} className="flex min-w-0 flex-1 items-center gap-1">
            <input
              aria-label="Branch name"
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
              autoFocus
              className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
            />
            <Button type="submit" size="xs" disabled={renaming || !branchName.trim()}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setEditingBranch(false)}
              disabled={renaming}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <span
              className="min-w-0 flex-1 truncate text-xs font-medium"
              title={git?.branch || "Unknown branch"}
            >
              {git?.branch || "Git"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!available || !git?.branch}
              aria-label="Rename branch"
              title="Rename branch"
              onClick={() => {
                setBranchName(git?.branch || "");
                setEditingBranch(true);
              }}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh Git changes"
          title="Refresh"
          className="text-muted-foreground"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void downloadPatch()}
          disabled={!diff}
          aria-label="Download patch"
          title="Download patch"
          className="text-muted-foreground"
        >
          <Download className="size-3.5" aria-hidden="true" />
        </Button>
        <Button size="xs" onClick={() => void commit()} disabled={!git || !available || committing}>
          {committing ? "Pushing…" : "Commit & push"}
        </Button>
      </div>
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-1 px-3 pt-3 text-xs">
          {gitError && <p className="text-danger">{gitError}</p>}
          {!git && !gitError && <p className="text-muted-foreground">Loading Git details…</p>}
          {git && (
            <>
              {git.workspaceError && (
                <p className="text-muted-foreground">
                  {git.workspaceError}{" "}
                  <button onClick={onReconnect} className="underline">
                    Reconnect
                  </button>
                </p>
              )}
              <section className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">
                    Changes{" "}
                    <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {git.workspaceError ? "?" : git.files.length}
                    </span>
                  </h3>
                  {selectedFiles.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFiles([]);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      Clear selection
                    </button>
                  )}
                </div>
                <p className="mt-1 text-muted-foreground">
                  {git.files.length > 0 &&
                    (selectedFiles.length
                      ? `${selectedFiles.length} selected`
                      : "All files will be included unless you select files")}
                </p>
                {git.files.length ? (
                  <ul className="mt-2 overflow-hidden rounded-md border border-border">
                    {git.files.map((file) => (
                      <li key={file.path}>
                        <label className="flex cursor-pointer items-center gap-2.5 px-2.5 py-2 hover:bg-muted/60">
                          <input
                            type="checkbox"
                            checked={selectedFiles.includes(file.path)}
                            onChange={(event) => {
                              setSelectedFiles((current) =>
                                event.target.checked
                                  ? [...current, file.path]
                                  : current.filter((path) => path !== file.path),
                              );
                            }}
                            className="accent-foreground"
                            aria-label={`Select ${file.path}`}
                          />
                          <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
                            {file.path}
                          </span>
                          <span
                            className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                            title={
                              file.unstaged === "?"
                                ? "Untracked"
                                : `Staged: ${file.staged || "none"}; unstaged: ${file.unstaged || "none"}`
                            }
                          >
                            {file.unstaged === "?"
                              ? "New"
                              : [file.staged, file.unstaged].filter(Boolean).join(" / ")}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : !git.workspaceError ? (
                  <p className="mt-2 text-muted-foreground">Working tree is clean.</p>
                ) : null}
              </section>
              <section className="border-t border-border py-2.5">
                <h3 className="font-medium">Pull request</h3>
                <form onSubmit={createPullRequest} className="mt-2 space-y-2">
                  <Button
                    type="submit"
                    size="xs"
                    disabled={creatingPr || !available || !git || !!git.workspaceError}
                  >
                    {creatingPr ? "Creating…" : "Create draft pull request"}
                  </Button>
                  {createdPr && (
                    <p>
                      <a
                        href={createdPr.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        Open pull request #{createdPr.number}
                      </a>
                    </p>
                  )}
                </form>
                {git.pullRequestError ? (
                  <p className="mt-1 text-muted-foreground">{git.pullRequestError}</p>
                ) : git.pullRequests.length === 0 ? (
                  <p className="mt-1 text-muted-foreground">No pull requests for this branch.</p>
                ) : (
                  git.pullRequests.map((pr) => (
                    <div key={pr.number} className="mt-2 space-y-2">
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium underline break-words"
                      >
                        #{pr.number} {pr.title}
                      </a>{" "}
                      <span className="text-muted-foreground">{pr.state}</span>
                      {pr.comments.length === 0 ? (
                        <p className="text-muted-foreground">No comments.</p>
                      ) : (
                        pr.comments.map((comment) => (
                          <button
                            key={comment.id}
                            type="button"
                            onClick={() =>
                              onUseComment(
                                `PR #${pr.number} comment by @${comment.author}${comment.path ? ` on ${comment.path}` : ""}:\n${comment.body}\n${comment.url}`,
                              )
                            }
                            className="block w-full rounded-md border border-border p-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                            title="Add comment to chat input"
                          >
                            <span className="font-medium">@{comment.author}</span>
                            {comment.path && (
                              <span className="ml-2 text-muted-foreground break-all">
                                {comment.path}
                              </span>
                            )}
                            <span className="mt-1 block whitespace-pre-wrap break-words">
                              {comment.body}
                            </span>
                            <span className="mt-1 block text-muted-foreground">
                              Click to add to chat
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ))
                )}
              </section>
              <details className="border-t border-border py-2.5">
                <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                  Commits not in main{" "}
                  <span className="text-muted-foreground">{git.commits.length}</span>
                </summary>
                {git.commitsError ? (
                  <p className="mt-1 text-danger">{git.commitsError}</p>
                ) : git.commits.length ? (
                  <ul className="mt-1 space-y-1">
                    {git.commits.map((commit) => (
                      <li key={commit.hash} className="flex gap-2">
                        <span className="shrink-0 font-mono text-muted-foreground">
                          {commit.hash}
                        </span>
                        <span className="break-words">{commit.subject}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-muted-foreground">No commits unique to this branch.</p>
                )}
              </details>
            </>
          )}
        </div>
        <details open className="mx-3 border-t border-border py-2.5 text-xs">
          <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
            Diff{" "}
            <span className="text-muted-foreground">
              {loading ? "Loading?" : truncated ? "Truncated" : persisted ? "Saved" : ""}
            </span>
          </summary>
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
          <div className="mt-2 divide-y divide-border overflow-hidden rounded-md border border-border">
            {parsedFiles.map((fileDiff, index) => (
              <details open key={`${fileDiff.name}-${index}`}>
                <summary
                  className="cursor-pointer truncate px-2.5 py-2 font-mono hover:bg-muted/60"
                  title={fileDiff.name}
                >
                  {fileDiff.name}
                </summary>
                <div className="min-w-0 overflow-x-auto border-t border-border">
                  <div className="flex justify-end px-2 py-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => void revertFile(fileDiff.name)}
                      disabled={reverting === fileDiff.name}
                    >
                      {reverting === fileDiff.name ? "Reverting?" : "Revert"}
                    </Button>
                  </div>
                  <FileDiff fileDiff={fileDiff} options={diffOptions} className="w-full" />
                </div>
              </details>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
