"use client";

import { useState } from "react";
import { IconPlayerPlay } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, ApiError } from "@/lib/api";
import { emitPreview } from "./preview-signal";

// Session header action: runs the project's saved dev command on the sandbox
// (empty body = backend uses project devCommand/devPort) and opens the result
// in the workspace preview tab.
export default function DevRunButton({
  sessionId,
  sandboxReady,
  devCommand,
  devPort,
  onOpened,
  onError,
}: {
  sessionId: string;
  sandboxReady: boolean;
  devCommand?: string;
  devPort?: number;
  onOpened: () => void;
  onError: (message: string) => void;
}) {
  const [starting, setStarting] = useState(false);
  const command = (devCommand || "").trim();
  const port = devPort || 3000;

  async function run() {
    if (!sessionId || starting || !sandboxReady) return;
    setStarting(true);
    onError("");
    try {
      const data = await api<{ url?: string; command?: string; port?: number }>(
        `/api/sessions/${sessionId}/devserver`,
        { method: "POST", body: JSON.stringify({}) },
        90_000,
      );
      if (!data.url) {
        onError("Could not start dev server.");
        return;
      }
      onOpened();
      emitPreview(sessionId, data.url, data.port ?? port);
    } catch (error) {
      onError(
        error instanceof ApiError
          ? error.message
          : "Could not start dev server: server unreachable.",
      );
    } finally {
      setStarting(false);
    }
  }

  const label = command
    ? `Run ${command} (:${port}) and open preview`
    : `Run dev server (:${port}) and open preview`;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          size="sm"
          onClick={() => void run()}
          disabled={!sandboxReady || starting || !sessionId}
          aria-label={starting ? "Starting dev server…" : label}
        >
          {starting ? (
            <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <IconPlayerPlay />
          )}
          <span className="hidden sm:inline">{starting ? "Starting…" : "Run dev"}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{sandboxReady ? label : "Dev server needs a running sandbox"}</TooltipContent>
    </Tooltip>
  );
}
