"use client";

import { useMutation } from "convex/react";
import { Archive, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { sessionTitle, useSessionSelection, type Session } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { StatusDot, statusLabel } from "@/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { repoName, timeAgo, timestamp } from "@/lib/format";
import { api } from "@convex/_generated/api";

export function SessionHeader({ session, legacy }: { session?: Session | null; legacy?: boolean }) {
  const updateSession = useMutation(api.sessions.update);
  const { selectSession } = useSessionSelection();
  const confirm = useConfirm();

  async function archive() {
    if (!session) return;
    const ok = await confirm({
      title: "Archive this session?",
      description: "It moves to the archived list in the sidebar. The transcript and diff are kept.",
      confirmLabel: "Archive",
    });
    if (!ok) return;
    try {
      await updateSession({ id: session.id as never, archived: true });
      selectSession(null);
      toast.success("Session archived.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not archive the session.");
    }
  }

  return (
    <header className="z-10 flex h-11 shrink-0 items-center gap-1.5 border-b bg-background px-1.5 sm:px-2">
      <Tooltip>
        <TooltipTrigger render={<SidebarTrigger />} />
        <TooltipContent side="bottom">Toggle sidebar</TooltipContent>
      </Tooltip>

      {session ? (
        <>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span className="mono hidden max-w-[160px] shrink-0 truncate text-[11.5px] text-muted-foreground sm:inline">
              {repoName(session.git)}
            </span>
            <ChevronRight className="hidden size-3 shrink-0 text-muted-foreground/40 sm:inline" />
            <h1 className="min-w-0 truncate text-[13px] font-medium tracking-[-0.01em]">{sessionTitle(session)}</h1>
          </div>

          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border bg-surface-1 px-2 py-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <StatusDot status={legacy ? "stopped" : session.status} />
                  <span className="hidden sm:inline">{legacy ? "Archived transcript" : statusLabel(session.status)}</span>
                </span>
              }
            />
            <TooltipContent side="bottom">
              Updated {timeAgo(session.updatedAt)} · {timestamp(session.updatedAt)}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Archive session" onClick={() => void archive()}>
                  <Archive />
                </Button>
              }
            />
            <TooltipContent side="bottom">Archive session</TooltipContent>
          </Tooltip>
        </>
      ) : (
        <span className="text-[13px] font-medium tracking-[-0.01em] text-muted-foreground">OpenDevin</span>
      )}
    </header>
  );
}
