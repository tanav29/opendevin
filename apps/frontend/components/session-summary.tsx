import Link from "next/link";
import { IconGitBranch, IconClock } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import { repoName, timeAgo, timestamp } from "@/lib/format";

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
  ready: "border-success/30 bg-success-muted text-success",
  error: "border-danger/30 bg-danger-muted text-danger",
  pending: "border-warning/30 bg-warning-muted text-warning",
  creating: "border-warning/30 bg-warning-muted text-warning",
  cloning: "border-warning/30 bg-warning-muted text-warning",
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
      <span
        className={cn(
          "mt-1 size-3 shrink-0 rounded-full",
          working
            ? "animate-spin border-2 border-muted-foreground/30 border-t-foreground"
            : "bg-muted-foreground/45",
        )}
        aria-label={working ? "Agent is running" : `Agent is ${session.status || "idle"}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{session.title || "Untitled session"}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
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
          {working && <span className="font-medium text-foreground">Agent running</span>}
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-md border px-1 font-mono text-xs font-medium",
          SANDBOX_TONE[sandboxStatus] || "border-border bg-muted text-muted-foreground",
        )}
      >
        {sandboxStatus}
      </span>
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
  const classes = cn(
    "flex min-w-0 items-start gap-3 px-4 py-3 transition-colors",
    href && "hover:bg-muted/50",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        <SummaryContent session={session} showRepo={showRepo} />
      </Link>
    );
  }

  return (
    <div className={classes}>
      <SummaryContent session={session} showRepo={showRepo} />
    </div>
  );
}
