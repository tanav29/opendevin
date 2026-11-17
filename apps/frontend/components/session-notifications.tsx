"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSession } from "@/hooks/use-session";

export type NotificationPrefs = { completed: boolean; failed: boolean };
export const notificationKey = (id: string) => `notifications:${id}`;
export function readNotificationPrefs(id: string): NotificationPrefs {
  try {
    const value = JSON.parse(localStorage.getItem(notificationKey(id)) || "{}");
    return { completed: value.completed === true, failed: value.failed === true };
  } catch {
    return { completed: false, failed: false };
  }
}

export function SessionNotifications() {
  const auth = useSession();
  const userId = auth.data?.user.id;
  useEffect(() => {
    if (!userId) return;
    let previous: Map<string, string> | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const sessions =
          await api<{ id: string; title: string; status: string }[]>("/api/sessions");
        if (stopped) return;
        const prefs = readNotificationPrefs(userId!);
        const next = new Map<string, string>();
        for (const session of sessions) {
          next.set(session.id, session.status);
          const old = previous?.get(session.id);
          const active = old === "running" || old === "queued";
          const event =
            active && session.status === "idle" && prefs.completed
              ? "completed"
              : active && session.status === "failed" && prefs.failed
                ? "failed"
                : null;
          if (event) {
            const message = `${session.title}: ${event}`;
            toast(message);
            if (
              document.hidden &&
              "Notification" in window &&
              Notification.permission === "granted"
            ) {
              new Notification("OpenDevin session", {
                body: message,
                tag: `session-${session.id}`,
              });
            }
          }
        }
        previous = next;
      } catch {
        /* Keep the last observed state until the API returns. */
      }
      if (!stopped) timer = setTimeout(poll, 10000);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [userId]);
  return null;
}
