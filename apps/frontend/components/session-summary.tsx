"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconGitBranch, IconClock } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import { repoName, timeAgo, timestamp } from "@/lib/format";
import { Archive, Box, CircleDashed, Loader } from "lucide-react";
import { Button } from "./ui/button";
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
};

function isWorking(session: SessionSummaryData) {
  return (
    session.status === "running" ||
    ["pending", "creating", "cloning"].includes(session.sandboxStatus || "")
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
        {working ? <Loader className="animate-spin size-3 " /> : <CircleDashed className="size-3" />}
      </div>
      <div className="min-w-0 flex-1 -my-1">
        <p className="truncate text-sm font-medium">{session.title || "Untitled session"}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <div
            className={cn(
              SANDBOX_TONE[sandboxStatus] || "text-muted-foreground",
            )}
          >
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
  const archiveMutation = useMutation({
    mutationFn: () => api(`/api/sessions/${session.id}/archive`, { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["project-sessions"] });
      toast.success("Session archived");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not archive session"),
  });
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
        title="Archive session"
        disabled={!session.id || archiveMutation.isPending}
        onClick={() => archiveMutation.mutate()}
      >
        <Archive />
      </Button>
    </div>
  );
}
