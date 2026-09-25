"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from "@pierre/trees/react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function FilesTab({
  sessionId,
  sandboxId,
  available,
  active,
  onReconnect,
}: {
  sessionId: string;
  sandboxId: string;
  available: boolean;
  active: boolean;
  onReconnect: () => void;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const [pathsTruncated, setPathsTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [loadedPath, setLoadedPath] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [contentTruncated, setContentTruncated] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = Boolean(loadedPath) && fileContent !== savedContent;
  const pathMismatch = Boolean(loadedPath) && pathInput !== loadedPath;
  const { model } = useFileTree({ paths: [], search: true });
  const search = useFileTreeSearch(model);
  const selection = useFileTreeSelection(model);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const warnBeforeNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a") : null;
      if (!target || target.origin !== window.location.origin || target.target === "_blank") return;
      if (!window.confirm("Leave without saving file changes?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", warnBeforeNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", warnBeforeNavigation, true);
    };
  }, [dirty]);

  useEffect(() => {
    model.resetPaths(paths);
  }, [model, paths]);

  const readPaths = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ paths?: string[]; truncated?: boolean }>(
        `/api/sessions/${sessionId}/files`,
        undefined,
        60_000,
      );
      setPaths(Array.isArray(data.paths) ? data.paths : []);
      setPathsTruncated(Boolean(data.truncated));
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not list files: the server is unreachable.",
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!active || !available) return;
    const timer = window.setTimeout(() => void readPaths(), 0);
    return () => window.clearTimeout(timer);
  }, [active, available, sandboxId, readPaths]);

  const openFile = useCallback(
    async (path: string) => {
      if (!path || fileLoading) return;
      if (dirty && !window.confirm("Discard unsaved file changes?")) return;
      setPathInput(path);
      setLoadedPath("");
      setContentTruncated(false);
      setFileLoading(true);
      setFileError("");
      try {
        const data = await api<{
          path?: string;
          content?: string;
          truncated?: boolean;
        }>(`/api/sessions/${sessionId}/file?path=${encodeURIComponent(path)}`, undefined, 60_000);
        const content = typeof data.content === "string" ? data.content : "";
        const canonicalPath = data.path || path;
        setPathInput(canonicalPath);
        setLoadedPath(canonicalPath);
        setFileContent(content);
        setSavedContent(content);
        setContentTruncated(Boolean(data.truncated));
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : "Could not open file: server unreachable.";
        setFileError(message);
        toast.error(message);
        setFileContent("");
        setSavedContent("");
      } finally {
        setFileLoading(false);
      }
    },
    [dirty, fileLoading, sessionId],
  );

  // Open the tree selection in the editor.
  useEffect(() => {
    const selected = selection[0];
    if (
      selected &&
      selected !== loadedPath &&
      !selected.endsWith("/") &&
      paths.includes(selected)
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void openFile(selected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  async function saveFile() {
    if (!loadedPath || pathMismatch || contentTruncated || saving || !dirty) return;
    setSaving(true);
    setFileError("");
    try {
      await api(
        `/api/sessions/${sessionId}/file`,
        {
          method: "PUT",
          body: JSON.stringify({
            path: loadedPath,
            content: fileContent,
            expectedContent: savedContent,
          }),
        },
        60_000,
      );
      setSavedContent(fileContent);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not save file: server unreachable.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!available) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">Files need a running sandbox.</p>
        <Button size="sm" variant="outline" onClick={onReconnect}>
          Reconnect sandbox
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-2">
        <Input
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            try {
              search.setValue(e.target.value || null);
            } catch {}
          }}
          placeholder="Filter files…"
          className="h-7 text-[12px]"
        />
      </div>
      <div className="min-h-0 max-h-[40%] flex-shrink-0 overflow-auto border-b border-border">
        {loading ? (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">Listing files…</p>
        ) : paths.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">No files found.</p>
        ) : (
          <FileTree model={model} className="px-1 py-2" />
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="path/to/file.ts"
            className="h-7 font-mono text-[11px]"
            spellCheck={false}
          />
          <Button
            size="xs"
            variant="outline"
            onClick={() => void openFile(pathInput)}
            disabled={!pathInput || fileLoading}
          >
            Open
          </Button>
          <Button
            size="xs"
            onClick={() => void saveFile()}
            disabled={!loadedPath || pathMismatch || contentTruncated || !dirty || saving}
          >
            {saving ? "…" : "Save"}
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground" aria-live="polite">
            {saving ? "Saving…" : dirty ? "Unsaved changes" : loadedPath ? "Saved" : ""}
          </span>
        </div>
        {fileError && (
          <p className="border-b border-border px-3 py-1.5 text-xs text-destructive">{fileError}</p>
        )}
        {contentTruncated && (
          <p className="border-b border-border bg-warning-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
            This file preview is truncated. It is read-only so omitted content cannot be
            overwritten.
          </p>
        )}
        {pathMismatch && (
          <p className="border-b border-border bg-warning-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
            The path changed. Open it before editing or saving this file.
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          {fileLoading ? (
            <p className="px-3 py-4 text-[13px] text-muted-foreground">Loading file…</p>
          ) : loadedPath ? (
            <Textarea
              value={fileContent}
              readOnly={contentTruncated || pathMismatch}
              onChange={(e) => {
                if (contentTruncated || pathMismatch) return;
                setFileContent(e.target.value);
              }}
              spellCheck={false}
              className="min-h-full rounded-none border-0 font-mono text-[12px] leading-5 focus-visible:ring-0"
              placeholder="File content…"
            />
          ) : (
            <p className="px-3 py-4 text-[13px] text-muted-foreground">
              Select a file in the tree or type a path to edit.
            </p>
          )}
        </div>
      </div>
      {pathsTruncated && (
        <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          Showing first 5,000 files.
        </p>
      )}
    </div>
  );
}
