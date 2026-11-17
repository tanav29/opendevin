"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";

type Checkpoint = {
  id: string;
  label: string;
  sourceCommit: string;
  branch: string;
  fileCount: number;
  byteSize: number;
  exclusions: string;
  createdAt: string;
};

export default function CheckpointsDialog({
  sessionId,
  ready,
  busy,
  onChanged,
  onBusyChange,
}: {
  sessionId: string;
  ready: boolean;
  busy: boolean;
  onChanged: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [captureError, setCaptureError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState<"restore" | "delete" | null>(null);
  const selected = checkpoints.find((c) => c.id === selectedId);
  const disabled = busy || Boolean(pending) || loading;

  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ checkpoints: Checkpoint[]; error: string | null }>(
        `/api/sessions/${sessionId}/checkpoints`,
      );
      setCheckpoints(result.checkpoints);
      setCaptureError(result.error || "");
      setSelectedId((current) =>
        result.checkpoints.some((c) => c.id === current)
          ? current
          : result.checkpoints[0]?.id || "",
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load checkpoints.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && sessionId) void load();
  }, [open, sessionId]);

  async function act(action: "capture" | "restore" | "fork" | "delete") {
    if (disabled || (action !== "capture" && !selected)) return;
    setPending(action);
    onBusyChange(true);
    setError("");
    setNotice("");
    try {
      const base = `/api/sessions/${sessionId}/checkpoints`;
      const path =
        action === "capture"
          ? base
          : `${base}/${selected!.id}${action === "delete" ? "" : `/${action}`}`;
      const result = await api<{ id?: string; sessionId?: string }>(
        path,
        {
          method: action === "delete" ? "DELETE" : "POST",
          ...(action !== "delete"
            ? { body: JSON.stringify(action === "capture" ? { label } : { confirmReplace: true }) }
            : {}),
        },
        300_000,
      );
      setConfirming(null);
      if (action === "fork" && result.sessionId) {
        setOpen(false);
        router.push(`/s/${result.sessionId}`);
      } else {
        if (action === "capture") {
          setLabel("");
          setSelectedId(result.id || "");
        }
        setNotice(
          action === "restore"
            ? "Checkpoint restored. Files, commits, and staging have been recovered. Reinstall dependencies and restart your preview as needed."
            : action === "delete"
              ? "Checkpoint deleted."
              : "Checkpoint captured.",
        );
        await load();
        onChanged();
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Checkpoint operation failed. Recovery data was retained.",
      );
    } finally {
      setPending("");
      onBusyChange(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          setOpen(next);
          setConfirming(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Checkpoints</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Workspace checkpoints</DialogTitle>
          <DialogDescription>
            Save work beyond sandbox expiry, restore an earlier state, or fork it into a new
            session.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs leading-5 text-muted-foreground">
          Includes the source commit, reachable history, staged changes, and untracked files,
          including binary files. Stop terminal commands and other writers before capture.
        </p>
        <details className="text-xs leading-5 text-muted-foreground">
          <summary className="cursor-pointer">Limits and exclusions</summary>
          <p className="mt-2">
            Ignored files and private environment/credential files are excluded. Capture refuses
            detected secrets. Up to 20 MiB, 5 MiB per changed file, and 2,000 changed files;
            symlinks and submodules are unsupported. Keeps 10 automatic and up to 20 manual
            checkpoints. Dependencies and running processes are not saved.
          </p>
        </details>
        {captureError && (
          <p role="alert" className="text-sm text-destructive">
            Automatic recovery: {captureError}
          </p>
        )}
        <div className="space-y-2 border-t pt-3">
          <label htmlFor="checkpoint-label" className="text-sm font-medium">
            New checkpoint label
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="checkpoint-label"
              className="min-w-0 flex-1"
              value={label}
              maxLength={100}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Manual checkpoint"
              disabled={disabled || !ready}
            />
            <Button size="sm" disabled={disabled || !ready} onClick={() => void act("capture")}>
              {pending === "capture" ? "Capturing…" : "Capture checkpoint"}
            </Button>
          </div>
          {!ready && (
            <p className="text-xs text-muted-foreground">
              Reconnect before capturing. Saved checkpoints can still be restored or forked.
            </p>
          )}
          {busy && (
            <p className="text-xs text-muted-foreground">
              Wait for the current operation or stop the agent before changing checkpoints.
            </p>
          )}
        </div>
        <div className="space-y-3 border-t pt-3">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="checkpoint-select" className="text-sm font-medium">
              Saved checkpoints
            </label>
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(pending) || loading}
              onClick={() => void load()}
            >
              Refresh
            </Button>
          </div>
          {loading && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading checkpoints…
            </p>
          )}
          {!loading && !error && checkpoints.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No checkpoints yet. Capture one while your workspace is available.
            </p>
          )}
          {checkpoints.length > 0 && (
            <select
              id="checkpoint-select"
              className="h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
              value={selectedId}
              disabled={Boolean(pending)}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setConfirming(null);
              }}
            >
              {checkpoints.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} · {new Date(c.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          )}
          {selected && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Source commit</dt>
                <dd className="break-all font-mono">{selected.sourceCommit}</dd>
                <dt className="text-muted-foreground">Branch</dt>
                <dd className="break-all">{selected.branch || "Detached HEAD"}</dd>
                <dt className="text-muted-foreground">Stored data</dt>
                <dd>
                  {selected.fileCount} changed files · {(selected.byteSize / 1024).toFixed(1)} KiB
                </dd>
              </dl>
              {selected.exclusions !== "[]" && (
                <details className="text-xs">
                  <summary>Excluded private files</summary>
                  <p className="mt-1 break-all whitespace-pre-wrap">
                    {JSON.parse(selected.exclusions).join("\n")}
                  </p>
                </details>
              )}
              {!confirming ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => setConfirming("restore")}
                  >
                    Restore checkpoint
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => void act("fork")}
                  >
                    {pending === "fork" ? "Forking…" : "Fork from here"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => setConfirming("delete")}
                  >
                    Delete
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 rounded-md border p-3">
                  <p className="text-sm">
                    {confirming === "restore"
                      ? "Replace this session’s current workspace with this checkpoint? Later changes will be lost. Capture them first, or fork to keep both workspaces."
                      : "Permanently delete this checkpoint? This cannot be undone."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={disabled}
                      onClick={() => void act(confirming)}
                    >
                      {pending
                        ? "Working…"
                        : confirming === "restore"
                          ? "Replace workspace"
                          : "Delete checkpoint"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(pending)}
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
