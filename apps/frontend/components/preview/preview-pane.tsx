"use client";

import { useState } from "react";
import { ExternalLink, Globe, LoaderCircle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function PreviewPane({ sessionId }: { sessionId: string }) {
  const [port, setPort] = useState("3000");
  const [url, setUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function loadPreview() {
    const value = Number(port);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      setError("Enter a valid port.");
      return;
    }
    // TODO: preview the port in the sandbox via a special link you can see in https://docs.e2b.dev/network/public-url
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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-1">
      <div className="flex shrink-0 items-center gap-1.5 border-b bg-background px-2 py-1.5">
        <Globe className="size-3 text-muted-foreground" />
        <span className="mono min-w-0 flex-1 truncate text-[11px] text-muted-foreground">http://localhost:</span>
        <Input
          aria-label="Preview port"
          inputMode="numeric"
          value={port}
          onChange={(event) => setPort(event.target.value.replace(/\D/g, "").slice(0, 5))}
          onKeyDown={(event) => { if (event.key === "Enter") void loadPreview(); }}
          className="mono w-20"
          placeholder="3000"
        />
        <Input
          aria-label="Path" // path after the domain
          inputMode="text"
          value={port}
          onChange={(event) => setPort(event.target.value.replace(/\D/g, "").slice(0, 5))}
          onKeyDown={(event) => { if (event.key === "Enter") void loadPreview(); }}
          className="mono w-20"
          placeholder="/"
        />
        <Button size="icon" variant="outline" aria-label="Load preview" onClick={() => void loadPreview()} disabled={loading}>
          {loading ? <LoaderCircle className="animate-spin" /> : <RotateCw />}
        </Button>
      </div>
      {error ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <p className="text-[13px] font-medium">Preview unavailable</p>
            <p className="mt-1 text-xs text-muted-foreground">{error} Start your app in the sandbox, then try again.</p>
          </div>
        </div>
      ) : url ? (
        <iframe title="Sandbox preview" src={url} className="min-h-0 flex-1 bg-white" />
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <Globe className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-[13px] font-medium">Preview a sandbox app</p>
            <p className="mt-1 text-xs text-muted-foreground">Enter the port your dev server uses and load it here.</p>
          </div>
        </div>
      )}
    </div>
  );
}
