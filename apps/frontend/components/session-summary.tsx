"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconGitBranch, IconClock } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import { repoName, timeAgo, timestamp } from "@/lib/format";
import { Archive, Box, CircleDashed, Loader } from "lucide-react";
import { Button } from "./ui/button";
import { useConfirm } from "./ui/confirm";
import { api } from "@/lib/api";
import { toast } from "sonner";

export type SessionSummaryData = {
  id?: string;
  title: string;
  repo?: string | null;
  branch?: string | null;
  createdAt?: string | null;
  status?: string | null;
  sandboxStatus?: string | null;
};

const SANDBOX_TONE: Record<string, string> = {
  ready: "text-success",
  error: "text-danger",
  pending: "text-warning",
  creating: "text-warning",
  cloning: "text-warning",
  "setting-up": "text-warning",
};

function isWorking(session: SessionSummaryData) {
  return (
    session.status === "running" ||
    session.status === "queued" ||
    ["pending", "creating", "cloning", "setting-up"].includes(session.sandboxStatus || "")
  );
}

function SummaryContent({ session, showRepo }: { session: SessionSummaryData; showRepo: boolean }) {
  const working = isWorking(session);
  const sandboxStatus = session.sandboxStatus || "pending";

  return (
    <>
      <div
        className="text-muted-foreground"
        aria-label={working ? "Agent is running" : `Agent is ${session.status || "idle"}`}
      >
        {working ? (
          <Loader className="animate-spin size-3 " />
        ) : (
          <CircleDashed className="size-3" />
        )}
      </div>
      <div className="min-w-0 flex-1 -my-1">
        <p className="truncate text-sm font-medium">{session.title || "Untitled session"}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <div className={cn(SANDBOX_TONE[sandboxStatus] || "text-muted-foreground")}>
            <Box className="size-3" />
          </div>
          {showRepo && session.repo && <span className="truncate">{repoName(session.repo)}</span>}
          {session.branch && (
            <span className="inline-flex min-w-0 items-center gap-1 font-mono">
              <IconGitBranch className="size-3 shrink-0" />
              <span className="truncate">{session.branch}</span>
            </span>
          )}
          {session.createdAt && (
            <span className="inline-flex items-center gap-1" title={timestamp(session.createdAt)}>
              <IconClock className="size-3 shrink-0" />
              Created {timeAgo(session.createdAt)}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

export function SessionSummary({
  session,
  showRepo = false,
  href,
  className,
}: {
  session: SessionSummaryData;
  showRepo?: boolean;
  href?: string;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const archiveMutation = useMutation({
    mutationFn: () => api(`/api/sessions/${session.id}/archive`, { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["project-sessions"] });
      toast.success("Session archived");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not archive session"),
  });
  async function confirmArchive() {
    if (!session.id || archiveMutation.isPending || confirmingArchive) return;
    setConfirmingArchive(true);
    try {
      const ok = await confirm({
        title: "Archive this session?",
        description: `“${session.title || "Untitled session"}” will be hidden from the workspace and its sandbox will stop. Chat history and the last recovery patch remain stored.`,
        confirmLabel: "Archive session",
        destructive: true,
      });
      if (ok) archiveMutation.mutate();
    } finally {
      setConfirmingArchive(false);
    }
  }
  const classes = cn(
    "flex min-w-0 items-start gap-3 px-4 py-3 transition-colors",
    href && "hover:bg-muted/50",
    className,
  );

  return (
    <div className={classes}>
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-start gap-3">
          <SummaryContent session={session} showRepo={showRepo} />
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <SummaryContent session={session} showRepo={showRepo} />
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        aria-label="Archive session"
        title="Archive session and stop sandbox"
        disabled={!session.id || archiveMutation.isPending || confirmingArchive}
        onClick={() => void confirmArchive()}
      >
        <Archive />
      </Button>
    </div>
  );
}
