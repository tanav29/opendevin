"use client";

import { ChevronRight, PanelRightClose, PanelRightOpen } from "lucide-react";

import { sessionTitle, type Session } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { StatusDot, statusLabel } from "@/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { repoName, timeAgo, timestamp } from "@/lib/format";

export function SessionHeader({
  session,
  panelOpen = false,
  panelAvailable = false,
  sandboxStatus = "loading",
  onTogglePanel,
}: {
  session?: Session | null;
  panelOpen?: boolean;
  panelAvailable?: boolean;
  sandboxStatus?: "loading" | "available" | "unavailable" | "error";
  onTogglePanel?: () => void;
}) {
  const panelLabel = panelOpen ? "Hide workspace panel" : "Show workspace panel";
  const sandboxLabel = sandboxStatus === "available"
    ? "Sandbox running"
    : sandboxStatus === "loading"
      ? "Checking sandbox"
      : sandboxStatus === "error"
        ? "Sandbox status unavailable"
        : "Sandbox stopped";

  return (
    <header className="z-10 flex h-11 shrink-0 items-center gap-1.5 border-b bg-background px-1.5 sm:px-2">
      <Tooltip>
        <TooltipTrigger render={<SidebarTrigger />} />
        <TooltipContent side="bottom">Toggle sidebar</TooltipContent>
      </Tooltip>

      {session ? (
        <>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span className="mono hidden max-w-[160px] shrink-0 truncate text-[11.5px] text-muted-foreground sm:inline">{repoName(session.git)}</span>
            <ChevronRight className="hidden size-3 shrink-0 text-muted-foreground/40 sm:inline" />
            <h1 className="min-w-0 truncate text-[13px] font-medium tracking-[-0.01em]">{sessionTitle(session)}</h1>
          </div>

          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} className="flex shrink-0 items-center gap-1.5 rounded-full border bg-surface-1 px-2 py-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"><StatusDot status={session.status} /><span className="hidden sm:inline">{statusLabel(session.status)}</span></span>} />
            <TooltipContent side="bottom">Streaming: {statusLabel(session.status)} · Updated {timeAgo(session.updatedAt)} · {timestamp(session.updatedAt)}</TooltipContent>
          </Tooltip>

          <span className="hidden shrink-0 items-center gap-1 rounded-full border bg-surface-1 px-2 py-1 text-[11px] text-muted-foreground lg:flex" aria-label={`Created ${timestamp(session.createdAt)}`}>
            <span className="mono">Created {timeAgo(session.createdAt)}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="hidden xl:inline">{timestamp(session.createdAt)}</span>
          </span>

          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} className="hidden shrink-0 items-center gap-1.5 rounded-full border bg-surface-1 px-2 py-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 sm:flex"><StatusDot status={panelAvailable ? "running" : "stopped"} /><span>{sandboxLabel}</span></span>} />
            <TooltipContent side="bottom">Created {timestamp(session.createdAt)} · {sandboxLabel} · Updated {timeAgo(session.updatedAt)}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={panelLabel} aria-pressed={panelOpen} disabled={!panelAvailable} onClick={onTogglePanel}>{panelOpen ? <PanelRightClose /> : <PanelRightOpen />}</Button>} />
            <TooltipContent side="bottom">{panelAvailable ? panelLabel : sandboxStatus === "loading" ? "Checking sandbox…" : "Start the agent to make the workspace panel available"}</TooltipContent>
          </Tooltip>
        </>
      ) : (
        <span className="text-[13px] font-medium tracking-[-0.01em] text-muted-foreground">OpenDevin</span>
      )}
    </header>
  );
}
