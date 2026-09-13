"use client";

import { useState } from "react";
import { API } from "./lib";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function PreviewTab({
  sessionId,
  available,
  onReconnect,
}: {
  sessionId: string;
  available: boolean;
  onReconnect: () => void;
}) {
  const [port, setPort] = useState("3000");
  const [path, setPath] = useState("/");
  const [url, setUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");
  // Request-scoped state (url/error) resets via the parent's key on session/sandbox change.

  async function resolve() {
    setResolving(true);
    setError("");
    try {
      const response = await fetch(
        `${API}/api/sessions/${sessionId}/preview?port=${encodeURIComponent(port)}&path=${encodeURIComponent(path || "/")}`,
        { credentials: "include" },
      );
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        setError(data.error || "Preview unavailable.");
        setUrl("");
        return;
      }
      setUrl(data.url);
    } catch {
      setError("Preview unavailable: could not reach the server.");
    } finally {
      setResolving(false);
    }
  }

  if (!available) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium">Preview unavailable</p>
        <p className="max-w-60 text-[13px] text-muted-foreground">
          The sandbox is not running, so no dev server can be reached.
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
      <div className="flex items-center gap-1.5 border-b border-border p-2">
        <Input
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder="3000"
          inputMode="numeric"
          className="w-16"
        />
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/"
          className="min-w-0 flex-1"
        />
        <Button
          onClick={() => void resolve()}
          disabled={resolving}
        >
          {url ? "Reload" : resolving ? "…" : "Open"}
        </Button>
      </div>
      {error && (
        <p className="border-b border-border bg-danger-muted px-3 py-2 text-xs text-danger">
          {error}{" "}
          <button onClick={() => void resolve()} className="underline">
            Retry
          </button>
        </p>
      )}
      {url ? (
          <iframe
            title="Sandbox preview"
            src={url}
            className="min-h-0 flex-1"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-sm font-medium">No preview loaded</p>
          <p className="max-w-64 text-[13px] text-muted-foreground">
            Start a dev server in the terminal or via the agent, then open the port above. The URL
            appears only after it resolves.
          </p>
        </div>
      )}
    </div>
  );
}
