"use client";

import { useEffect, useState } from "react";

export type SandboxState = "loading" | "available" | "unavailable" | "error";

type SandboxStatus = {
  state: SandboxState;
  message?: string;
};

const LOADING: SandboxStatus = { state: "loading" };

/** Checks the live E2B sandbox without copying that operational state to Convex. */
export function useSandboxStatus(sessionId: string | null | undefined) {
  const [status, setStatus] = useState<SandboxStatus>(LOADING);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      try {
        const response = await fetch(`/api/sandbox/status?sessionId=${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
        });
        const result = (await response.json()) as { available?: boolean; error?: string };
        if (cancelled) return;
        setStatus(
          response.ok && result.available
            ? { state: "available" }
            : { state: "unavailable", message: result.error || "Sandbox is not running." },
        );
      } catch {
        if (!cancelled) setStatus({ state: "error", message: "Could not check sandbox status." });
      } finally {
        if (!cancelled) timer = setTimeout(check, 10_000);
      }
    };

    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  return status;
}
