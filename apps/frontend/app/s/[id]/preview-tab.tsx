"use client";

import { useState } from "react";
import { api } from "@/lib/api";
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
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [devInfo, setDevInfo] = useState("");
  // Request-scoped state (url/error) resets via the parent's key on session/sandbox change.

  async function startDev() {
    setStarting(true);
    setError("");
    setDevInfo("");
    try {
      const data = await api<{
        url?: string;
        command?: string;
        port?: number;
        log?: string;
      }>(`/api/sessions/${sessionId}/devserver`, {
        method: "POST",
        body: JSON.stringify({ port: Number(port) || 3000 }),
      });
      if (!data.url) {
        setError("Could not start dev server.");
        return;
      }
      setPort(String(data.port ?? port));
      setDevInfo(`Started: ${data.command}`);
      setUrl(data.url);
    } catch {
      setError("Could not start dev server: server unreachable.");
    } finally {
      setStarting(false);
    }
  }

  async function resolve() {
    setResolving(true);
    setError("");
    try {
      const data = await api<{ url?: string }>(
        `/api/sessions/${sessionId}/preview?port=${encodeURIComponent(port)}&path=${encodeURIComponent(path || "/")}`,
      );
      if (!data.url) {
        setError("Preview unavailable.");
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
        <Button onClick={() => void resolve()} disabled={resolving}>
          {url ? "Reload" : resolving ? "…" : "Open"}
        </Button>
        <Button variant="outline" onClick={() => void startDev()} disabled={starting}>
          {starting ? "…" : "Auto-start"}
        </Button>
      </div>
      {devInfo && (
        <p className="truncate border-b border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
          {devInfo}
        </p>
      )}
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
