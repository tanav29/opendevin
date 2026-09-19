"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPreviewSignal, subscribePreview } from "./preview-signal";

export default function PreviewTab({
  sessionId,
  available,
  onReconnect,
  defaultPort,
}: {
  sessionId: string;
  available: boolean;
  onReconnect: () => void;
  defaultPort?: number;
}) {
  const [port, setPort] = useState<string | null>(null);
  const [path, setPath] = useState("/");
  // The session header's Run-dev button starts the saved dev command and hands
  // the resolved URL over via emitPreview. A freshly mounted pane reads the
  // latest signal for this session; an already-open pane picks it up via the
  // subscription below.
  const [url, setUrl] = useState(() => {
    const pending = getPreviewSignal();
    return pending && pending.sessionId === sessionId ? pending.url : "";
  });
  const [resolving, setResolving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [devInfo, setDevInfo] = useState("");
  const [copied, setCopied] = useState(false);
  // Request-scoped state (url/error) resets via the parent's key on session/sandbox change.
  const effectivePort = port ?? (defaultPort ? String(defaultPort) : "3000");

  useEffect(
    () =>
      subscribePreview((next) => {
        if (next.sessionId !== sessionId) return;
        setPort(String(next.port));
        setUrl(next.url);
        setError("");
      }),
    [sessionId],
  );

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
        body: JSON.stringify({ port: Number(effectivePort) || 3000 }),
      });
      if (!data.url) {
        setError("Could not start dev server.");
        return;
      }
      setPort(String(data.port ?? effectivePort));
      setDevInfo(`Started: ${data.command}`);
      setUrl(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start dev server.");
    } finally {
      setStarting(false);
    }
  }

  async function resolve() {
    setResolving(true);
    setError("");
    try {
      const data = await api<{ url?: string }>(
        `/api/sessions/${sessionId}/preview?port=${encodeURIComponent(effectivePort)}&path=${encodeURIComponent(path || "/")}`,
      );
      if (!data.url) {
        setError("Preview unavailable.");
        setUrl("");
        return;
      }
      setUrl(data.url);
    } catch (e) {
      // The backend only resolves URLs that actually serve, so a failure here
      // means nothing listens on this port — drop the stale iframe, if any.
      setUrl("");
      setError(e instanceof Error ? e.message : "Preview unavailable.");
    } finally {
      setResolving(false);
    }
  }

  function copyUrl() {
    if (!url) return;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
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
          value={effectivePort}
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
      {url && (
        <div className="flex items-center gap-1 border-b border-border px-2 py-1">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {url}
          </span>
          <Button variant="ghost" size="xs" onClick={copyUrl}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium text-primary hover:underline"
          >
            Open ↗
          </a>
        </div>
      )}
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
        <>
          <iframe
            key={url}
            title="Sandbox preview"
            src={url}
            className="min-h-0 flex-1"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
          <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            Blank here but the site works via Open ↗? The app blocks iframe embedding — use the
            external link.
          </p>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-sm font-medium">No preview loaded</p>
          <p className="max-w-64 text-[13px] text-muted-foreground">
            Start a dev server in the terminal, via the agent, or with Auto-start, then open the
            port above. The preview appears only once something actually serves that port.
          </p>
        </div>
      )}
    </div>
  );
}
