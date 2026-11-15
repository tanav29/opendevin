"use client";

import { useEffect, useState } from "react";
import { Box } from "lucide-react";
import { cn } from "@/lib/utils";

export function SandboxStatus({
  status,
  expiresAt,
  compact = false,
}: {
  status: string;
  expiresAt?: string | null;
  compact?: boolean;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
  const minutes =
    now === null || !Number.isFinite(expiry) ? null : Math.ceil((expiry - now) / 60_000);
  const starting = ["pending", "creating", "cloning", "setting-up"].includes(status);
  const expired = status === "ready" && minutes !== null && minutes <= 0;
  const urgent = status === "ready" && minutes !== null && minutes > 0 && minutes <= 10;
  const label = starting
    ? "Starting"
    : status !== "ready"
      ? status === "error"
        ? "Stopped"
        : "Unavailable"
      : expired
        ? "Time elapsed"
        : minutes === null
          ? "Lifetime unknown"
          : `${minutes}m left`;
  const description = starting
    ? "Sandbox is starting"
    : status !== "ready"
      ? "Sandbox is unavailable"
      : expired
        ? "Sandbox lifetime has elapsed; it may no longer be available"
        : minutes === null
          ? "Sandbox lifetime is unknown"
          : `Sandbox has about ${minutes} minute${minutes === 1 ? "" : "s"} left before its workspace is discarded`;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs",
        urgent || expired ? "text-warning" : "text-muted-foreground",
      )}
      title={description}
      aria-label={description}
    >
      <Box className="size-3 shrink-0" aria-hidden="true" />
      {!compact && <span>Sandbox</span>}
      <span>{label}</span>
    </span>
  );
}
