"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from "@pierre/trees/react";
import { API } from "./lib";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [openPath, setOpenPath] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const { model } = useFileTree({ paths: [], search: true });
  const search = useFileTreeSearch(model);
  const selection = useFileTreeSelection(model);

  useEffect(() => {
    model.resetPaths(paths);
  }, [model, paths]);

  const readPaths = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/sessions/${sessionId}/files`, {
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not list files");
        return;
      }
      setPaths(Array.isArray(data.paths) ? data.paths : []);
      setTruncated(Boolean(data.truncated));
    } catch {
      setError("Could not list files: the server is unreachable.");
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
      setOpenPath(path);
      setFileLoading(true);
      setFileError("");
      setDirty(false);
      try {
        const response = await fetch(
          `${API}/api/sessions/${sessionId}/file?path=${encodeURIComponent(path)}`,
          { credentials: "include" },
        );
        const data = (await response.json().catch(() => ({}))) as {
          content?: string;
          error?: string;
        };
        if (!response.ok) {
          setFileError(data.error || "Could not open file");
          setFileContent("");
          return;
        }
        setFileContent(typeof data.content === "string" ? data.content : "");
      } catch {
        setFileError("Could not open file: server unreachable.");
        setFileContent("");
      } finally {
        setFileLoading(false);
      }
    },
    [sessionId, fileLoading],
  );

  // Open the tree selection in the editor.
  useEffect(() => {
    const selected = selection[0];
    if (selected && selected !== openPath && !selected.endsWith("/") && paths.includes(selected)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void openFile(selected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  async function saveFile() {
    if (!openPath || saving) return;
    setSaving(true);
    setFileError("");
    try {
      const response = await fetch(`${API}/api/sessions/${sessionId}/file`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: openPath, content: fileContent }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFileError(data.error || "Could not save file");
        return;
      }
      setDirty(false);
    } catch {
      setFileError("Could not save file: server unreachable.");
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
      {error && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="text-xs text-destructive">{error}</p>
          <Button size="xs" variant="outline" onClick={() => void readPaths()}>
            Retry
          </Button>
        </div>
      )}
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
            value={openPath}
            onChange={(e) => setOpenPath(e.target.value)}
            placeholder="path/to/file.ts"
            className="h-7 font-mono text-[11px]"
            spellCheck={false}
          />
          <Button
            size="xs"
            variant="outline"
            onClick={() => void openFile(openPath)}
            disabled={!openPath || fileLoading}
          >
            Open
          </Button>
          <Button
            size="xs"
            onClick={() => void saveFile()}
            disabled={!openPath || !dirty || saving}
          >
            {saving ? "…" : "Save"}
          </Button>
        </div>
        {fileError && (
          <p className="border-b border-border px-3 py-1.5 text-xs text-destructive">{fileError}</p>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          {fileLoading ? (
            <p className="px-3 py-4 text-[13px] text-muted-foreground">Loading file…</p>
          ) : openPath ? (
            <Textarea
              value={fileContent}
              onChange={(e) => {
                setFileContent(e.target.value);
                setDirty(true);
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
      {truncated && (
        <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          Showing first 5,000 files.
        </p>
      )}
    </div>
  );
}
