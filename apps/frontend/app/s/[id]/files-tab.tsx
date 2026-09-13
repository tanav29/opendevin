"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
} from "@pierre/trees/react";
import { API } from "./lib";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";


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
  const { model } = useFileTree({ paths: [], search: true });
  const search = useFileTreeSearch(model);

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
    if (active && available) void readPaths();
  }, [active, available, sandboxId, readPaths]);


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
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">Listing files…</p>
        ) : paths.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">No files found.</p>
        ) : (
          <FileTree model={model} className="px-1 py-2" />
        )}
      </div>
      {truncated && (
        <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          Showing first 5,000 files.
        </p>
      )}

    </div>
  );
}
