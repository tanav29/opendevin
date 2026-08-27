"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Globe, LoaderCircle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function PreviewPane({ sessionId, sandboxId }: { sessionId: string; sandboxId?: string }) {
  const [port, setPort] = useState("3000");
  const [path, setPath] = useState("/");
  const [url, setUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  // Reset preview when session or sandbox changes — intentional sync of client state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(undefined);
    setError(undefined);
    setLoading(false);
  }, [sessionId, sandboxId]);


  async function loadPreview() {
    const value = Number(port);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      setError("Enter a valid port.");
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/sandbox/preview?sessionId=${encodeURIComponent(sessionId)}&port=${value}`);
      const result = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "Could not load preview.");
      setUrl(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load preview.");
    } finally {
      setLoading(false);
    }
  }

  let previewUrl: string | undefined;
  try {
    previewUrl = url ? new URL(path.startsWith("/") ? path : `/${path}`, url.startsWith("http") ? url : `https://${url}`).toString() : undefined;
  } catch {
    previewUrl = url;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-1">
      <div className="flex shrink-0 items-center gap-1.5 border-b bg-background px-2 py-1.5">
        <Globe className="size-3 shrink-0 text-muted-foreground" />
        <Input
          aria-label="Preview port"
          inputMode="numeric"
          value={port}
          onChange={(event) => setPort(event.target.value.replace(/\D/g, "").slice(0, 5))}
          onKeyDown={(event) => { if (event.key === "Enter") void loadPreview(); }}
          className="mono w-16 shrink-0"
          placeholder="3000"
        />
        <Input
          aria-label="Preview path"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void loadPreview(); }}
          className="mono min-w-0 flex-1"
          placeholder="/"
        />
        <Tooltip>
          <TooltipTrigger render={<Button size="icon" variant="outline" aria-label="Reload preview" onClick={() => void loadPreview()} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : <RotateCw />}</Button>} />
          <TooltipContent>Reload preview</TooltipContent>
        </Tooltip>
        {previewUrl && (
          <Tooltip>
            <TooltipTrigger render={<Button size="icon" variant="outline" aria-label="Open preview in a new tab" nativeButton={false} render={<a href={previewUrl} target="_blank" rel="noreferrer noopener" />}><ExternalLink /></Button>} />
            <TooltipContent>Open in new tab</TooltipContent>
          </Tooltip>
        )}
      </div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center" aria-busy="true" aria-live="polite">
          <div>
            <LoaderCircle className="mx-auto size-5 animate-spin text-muted-foreground" />
            <p className="mt-2 text-[13px] font-medium">Loading preview…</p>
            <p className="mt-1 text-xs text-muted-foreground">Resolving sandbox URL for port {port}.</p>
          </div>
        </div>
      ) : error ? (
        <div role="alert" className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <p className="text-[13px] font-medium">Preview unavailable</p>
            <p className="mt-1 text-xs text-muted-foreground">{error} Start your app in the sandbox, then try again.</p>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => void loadPreview()} disabled={loading}>Retry connection</Button>
          </div>
        </div>
      ) : previewUrl ? (
        <iframe title="Sandbox preview" src={previewUrl} className="min-h-0 flex-1 bg-white" />
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <Globe className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-[13px] font-medium">Preview a sandbox app</p>
            <p className="mt-1 text-xs text-muted-foreground">Enter the port your dev server uses, then load the preview.</p>
          </div>
        </div>
      )}
    </div>
  );
}
