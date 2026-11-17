"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  notificationKey,
  readNotificationPrefs,
  type NotificationPrefs,
} from "@/components/session-notifications";

export function ExpandedSettings({ userId }: { userId: string }) {
  const settings = useQuery({
    queryKey: ["settings", userId],
    queryFn: () => api<{ defaultModel: string; systemModel: string }>("/api/settings"),
    retry: false,
  });
  const usage = useQuery({
    queryKey: ["usage", userId],
    queryFn: () =>
      api<{ projects: number; sessions: number; recordedSessions: number; tokens: number | null }>(
        "/api/settings/usage",
      ),
    retry: false,
  });
  const github = useQuery({
    queryKey: ["github-connection", userId],
    queryFn: () =>
      api<{ status: "connected" | "disconnected" | "unknown" }>("/api/settings/github"),
    retry: false,
  });
  const [model, setModel] = useState("");
  const [prefs, setPrefs] = useState<NotificationPrefs>({ completed: false, failed: false });
  const [permission, setPermission] = useState("unavailable");
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    if (settings.data) setModel(settings.data.defaultModel);
  }, [settings.data]);
  useEffect(() => {
    setPrefs(readNotificationPrefs(userId));
    setPermission("Notification" in window ? Notification.permission : "unavailable");
  }, [userId]);
  const save = useMutation({
    mutationFn: () =>
      api("/api/settings", { method: "PUT", body: JSON.stringify({ defaultModel: model.trim() }) }),
  });
  const reconnect = useMutation({
    mutationFn: () =>
      api<{ url?: string }>("/api/auth/sign-in/social", {
        method: "POST",
        body: JSON.stringify({
          provider: "github",
          callbackURL: window.location.origin + "/settings",
        }),
      }),
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
  });
  function changePref(key: keyof NotificationPrefs, checked: boolean) {
    const next = { ...prefs, [key]: checked };
    try {
      localStorage.setItem(notificationKey(userId), JSON.stringify(next));
      setPrefs(next);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Model default</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Used for new sessions. Existing sessions keep their model. Leave blank to use the server
            default{settings.data ? ` (${settings.data.systemModel})` : ""}.
          </p>
          {settings.isError ? (
            <p role="alert" className="text-sm">
              Could not load settings.{" "}
              <button className="underline" onClick={() => void settings.refetch()}>
                Retry
              </button>
            </p>
          ) : settings.isPending ? (
            <p className="text-sm">Loading…</p>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <label htmlFor="default-model" className="text-sm font-medium">
                OpenRouter model ID
              </label>
              <Input
                id="default-model"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  save.reset();
                }}
                placeholder="provider/model"
                maxLength={200}
              />
              <Button type="submit" size="sm" disabled={save.isPending}>
                Save model
              </Button>
              {save.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {save.error.message}
                </p>
              )}
              {save.isSuccess && (
                <p role="status" className="text-sm">
                  Model default saved.
                </p>
              )}
            </form>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Saved in this browser for this account. Alerts are checked while OpenDevin is open;
            desktop notifications appear when the tab is hidden and permission is granted.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={prefs.completed}
              onChange={(e) => changePref("completed", e.target.checked)}
            />{" "}
            Session completes
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={prefs.failed}
              onChange={(e) => changePref("failed", e.target.checked)}
            />{" "}
            Session fails
          </label>
          <p>Browser permission: {permission}</p>
          {permission === "default" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void Notification.requestPermission().then(setPermission)}
            >
              Enable desktop notifications
            </Button>
          )}
          {permission === "denied" && (
            <p className="text-muted-foreground">
              Allow notifications in your browser site settings.
            </p>
          )}
          {storageError && (
            <p role="alert" className="text-destructive">
              Could not save browser preferences.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Connections</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            GitHub:{" "}
            {github.isPending
              ? "Checking…"
              : github.isError
                ? "Unable to check"
                : github.data.status === "unknown"
                  ? "Unable to verify"
                  : github.data.status === "connected"
                    ? "Connected"
                    : "Disconnected"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => reconnect.mutate()}
              disabled={reconnect.isPending}
            >
              Reconnect GitHub
            </Button>
            <a
              className="inline-flex items-center rounded-lg border px-3 py-1.5 hover:bg-muted"
              href="https://github.com/settings/applications"
              target="_blank"
              rel="noreferrer"
            >
              Manage on GitHub
            </a>
            <Button size="sm" variant="ghost" onClick={() => void github.refetch()}>
              Check again
            </Button>
          </div>
          {reconnect.isError && (
            <p role="alert" className="text-destructive">
              {reconnect.error.message}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {usage.isPending ? (
            <p>Loading…</p>
          ) : usage.isError ? (
            <p role="alert">
              Could not load usage.{" "}
              <button className="underline" onClick={() => void usage.refetch()}>
                Retry
              </button>
            </p>
          ) : (
            <>
              <p>Projects: {usage.data.projects.toLocaleString()}</p>
              <p>Sessions: {usage.data.sessions.toLocaleString()}</p>
              <p>
                Recorded tokens:{" "}
                {usage.data.tokens === null ? "Unknown" : usage.data.tokens.toLocaleString()}
              </p>
              <p className="text-muted-foreground">
                Sum of the latest recorded turn in {usage.data.recordedSessions} of{" "}
                {usage.data.sessions} retained sessions, including archived sessions. Earlier turns
                and deleted sessions are not included. Cost is unknown.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
