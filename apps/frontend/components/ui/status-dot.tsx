"use client";

import { cn } from "@/lib/utils";

export type StatusTone = "running" | "idle" | "stopped" | "failed";

/**
 * Colour is spent only on states that want attention. Most sessions sit idle,
 * so painting those too leaves a wall of colour that says nothing — grey for
 * at-rest keeps a glance down the sidebar meaningful.
 */
const TONE: Record<StatusTone, { dot: string; label: string }> = {
  running: { dot: "bg-foreground shadow-[0_0_0_1px_var(--surface-2)]", label: "Working" },
  idle: { dot: "bg-muted-foreground/70", label: "Idle" },
  stopped: { dot: "bg-muted-foreground/30", label: "Stopped" },
  failed: { dot: "bg-destructive", label: "Failed" },
};

export function statusTone(status: string | undefined): StatusTone {
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  if (status === "stopped") return "stopped";
  return "idle";
}

export function statusLabel(status: string | undefined) {
  return TONE[statusTone(status)].label;
}

/**
 * The one place session state is drawn. A live session gets an expanding
 * halo — the only ambient motion in the product, so movement always means
 * the agent is working.
 */
export function StatusDot({
  status,
  className,
}: {
  status: string | undefined;
  className?: string;
}) {
  const tone = statusTone(status);
  return (
    <span
      role="img"
      aria-label={TONE[tone].label}
      className={cn(
        "relative inline-flex size-1.5 shrink-0 rounded-full",
        TONE[tone].dot,
        tone === "running" && "animate-halo",
        className,
      )}
    />
  );
}