"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Markdown from "./markdown";
import SessionPanel, { usePanelPrefs } from "./session-panel";
import SessionSidebar from "./session-sidebar";
import {
  API,
  PROVISIONING_SANDBOX,
  formatDate,
  isWorking,
  type ChatMessage,
  type SessionDetail,
  type SessionStatus,
  type SidebarSession,
} from "./lib";

function AgentBadge({
  working,
  failed,
  streaming,
}: {
  working: boolean;
  failed: boolean;
  streaming: boolean;
}) {
  const label = streaming || working ? "Working" : failed ? "Failed" : "Idle";
  const dot = streaming || working ? "bg-warning" : failed ? "bg-danger" : "bg-success";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
      <span
        className={`h-1.5 w-1.5 rounded-full ${dot} ${streaming || working ? "animate-pulse" : ""}`}
      />
      {label}
    </span>
  );
}

function SandboxBadge({ status }: { status: SessionStatus | null }) {
  const sandboxStatus = status?.sandboxStatus || "pending";
  const label = status
    ? sandboxStatus === "ready"
      ? status.sandboxAvailable
        ? "Active"
        : "Unreachable"
      : sandboxStatus === "error"
        ? "Failed"
        : "Provisioning"
    : "…";
  const dot =
    sandboxStatus === "ready" && status?.sandboxAvailable
      ? "bg-success"
      : sandboxStatus === "error" || (sandboxStatus === "ready" && !status?.sandboxAvailable)
        ? "bg-danger"
        : "bg-warning";
  const pulse = sandboxStatus !== "ready" && sandboxStatus !== "error";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${pulse ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const [sessionId, setSessionId] = useState("");
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [allSessions, setAllSessions] = useState<SidebarSession[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [killing, setKilling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const [prefs, setPrefs] = usePanelPrefs();

  function copyMessage(id: string, content: string) {
    void navigator.clipboard
      ?.writeText(content)
      .then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId((c) => (c === id ? "" : c)), 1500);
      })
      .catch(() => undefined);
  }

  const refresh = useCallback(async (id: string, includeMessages: boolean) => {
    const [nextDetail, nextStatus, nextSessions] = await Promise.all([
      fetch(`${API}/api/sessions/${id}`, { credentials: "include" }).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`${API}/api/sessions/${id}/status`, { credentials: "include" }).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`${API}/api/sessions`, { credentials: "include" }).then((r) => (r.ok ? r.json() : [])),
    ]);
    if (nextDetail) setDetail(nextDetail);
    if (nextStatus) setStatus(nextStatus);
    setAllSessions(nextSessions);
    if (includeMessages) {
      const history = await fetch(`${API}/api/sessions/${id}/messages`, {
        credentials: "include",
      }).then((r) => (r.ok ? r.json() : []));
      setMessages(history);
    }
    return nextDetail as SessionDetail | null;
  }, []);

  useEffect(() => {
    void params.then(({ id }) => {
      setSessionId(id);
      try {
        window.localStorage.setItem("opendevin:selected-session", id);
      } catch {
        // Ignore persistence failures.
      }
      void refresh(id, true);
    });
  }, [params, refresh]);

  const sandboxStatus = status?.sandboxStatus ?? detail?.sandboxStatus ?? "pending";
  const agentStatus = status?.status ?? detail?.status ?? "idle";
  const busy = isWorking(agentStatus, sandboxStatus) || sending;

  // Poll every 3s while creating/cloning/running (navbar + sidebar stay live).
  useEffect(() => {
    if (!sessionId || !busy) return;
    const timer = setInterval(() => void refresh(sessionId, !sending), 3000);
    return () => clearInterval(timer);
  }, [sessionId, busy, sending, refresh]);

  async function reconnect() {
    if (!sessionId || reconnecting) return;
    setReconnecting(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/sessions/${sessionId}/reconnect`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not reconnect sandbox");
      } else {
        await refresh(sessionId, false);
      }
    } catch {
      setError("Could not reconnect sandbox: the server is unreachable.");
    } finally {
      setReconnecting(false);
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !sessionId || sending) return;
    setInput("");
    setError("");
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: "user", content: trimmed },
      { id: "streaming", role: "assistant", content: "" },
    ]);
    try {
      const response = await fetch(`${API}/api/sessions/${sessionId}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "The agent could not respond");
        setMessages((current) => current.filter((message) => message.id !== "streaming"));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        setMessages((current) =>
          current.map((message) =>
            message.id === "streaming" ? { ...message, content: message.content + chunk } : message,
          ),
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Stopped. Partial reply kept — the server finishes in the background.");
      } else {
        setError("The agent could not respond: the server is unreachable.");
        setMessages((current) => current.filter((message) => message.id !== "streaming"));
      }
    } finally {
      abortRef.current = null;
      setSending(false);
      // Backend is source of truth — refetch the persisted transcript.
      await refresh(sessionId, true);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function retry() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser && !sending) void sendMessage(lastUser.content);
  }

  async function kill() {
    if (
      !sessionId ||
      killing ||
      !window.confirm("Kill this sandbox? The terminal and preview stop; chat history stays.")
    )
      return;
    setKilling(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/sessions/${sessionId}/kill`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not kill sandbox");
      } else {
        await refresh(sessionId, false);
      }
    } catch {
      setError("Could not kill sandbox: the server is unreachable.");
    } finally {
      setKilling(false);
    }
  }

  async function removeSession() {
    if (
      !sessionId ||
      deleting ||
      !window.confirm("Delete this session and its sandbox? This cannot be undone.")
    )
      return;
    setDeleting(true);
    try {
      const response = await fetch(`${API}/api/sessions/${sessionId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not delete session");
        setDeleting(false);
        return;
      }
      window.location.href = detail ? `/p/${detail.projectId}` : "/";
    } catch {
      setError("Could not delete session: the server is unreachable.");
      setDeleting(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    await sendMessage(input);
  }

  const provisioning = PROVISIONING_SANDBOX.has(sandboxStatus);
  const failed = sandboxStatus === "error";
  const ready = sandboxStatus === "ready" && (status?.sandboxAvailable ?? false);

  return (
    <main className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href={detail ? `/p/${detail.projectId}` : "/"}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back
          </Link>
          <span className="h-4 w-px shrink-0 bg-border" />
          <h1 className="truncate text-sm font-medium">{detail?.title || "Loading session…"}</h1>
          {detail?.branch && (
            <span className="hidden shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground sm:inline">
              {detail.branch}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {detail && (
            <span
              className="hidden font-mono text-[11px] text-muted-foreground xl:inline"
              title="Session created"
            >
              {formatDate(detail.createdAt)}
            </span>
          )}
          <AgentBadge
            working={agentStatus === "running"}
            failed={agentStatus === "failed"}
            streaming={sending}
          />
          <SandboxBadge status={status} />
          {(failed || (sandboxStatus === "ready" && !status?.sandboxAvailable)) && (
            <button
              onClick={() => void reconnect()}
              disabled={reconnecting}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              {reconnecting ? "…" : "Reconnect"}
            </button>
          )}
          {(status?.sandboxId || detail?.sandboxId) && !failed && (
            <button
              onClick={() => void kill()}
              disabled={killing}
              title="Stop the cloud sandbox now instead of waiting for timeout"
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              {killing ? "…" : "Kill"}
            </button>
          )}
          <button
            onClick={() => void removeSession()}
            disabled={deleting}
            title="Delete this session and its sandbox"
            className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-danger disabled:opacity-40"
          >
            {deleting ? "…" : "Delete"}
          </button>
          <button
            onClick={() => setPrefs({ ...prefs, open: !prefs.open })}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {prefs.open ? "Hide panel" : "Panel"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <SessionSidebar
          sessions={allSessions}
          activeId={sessionId}
          projectId={detail?.projectId || ""}
        />

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6">
            {provisioning && (
              <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                Spinning up cloud sandbox and cloning repo… the agent gets full workspace access
                once this turns ready.
              </div>
            )}
            {failed && (
              <div className="mb-5 rounded-lg border border-danger/40 bg-card p-4 text-sm">
                <p className="font-medium text-danger">
                  Sandbox failed: {status?.lastError || detail?.lastError || "unknown error"}
                </p>
                <button
                  onClick={() => void reconnect()}
                  disabled={reconnecting}
                  className="mt-3 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                >
                  {reconnecting ? "Reconnecting…" : "Reconnect sandbox"}
                </button>
              </div>
            )}
            {agentStatus === "failed" && !sending && (
              <div className="mb-5 rounded-lg border border-danger/40 bg-card p-4 text-sm">
                <p className="font-medium text-danger">Agent run failed.</p>
                <button
                  onClick={retry}
                  className="mt-3 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
                >
                  Retry last message
                </button>
              </div>
            )}
            <div className="flex-1 space-y-5">
              {messages.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-8 text-sm text-muted-foreground">
                  Your agent is ready. Ask it to inspect files, make a plan, or start building.
                </div>
              )}
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-8 rounded-lg bg-card px-4 py-3 text-sm"
                      : "group mr-8 px-1 py-2 text-sm leading-7 text-foreground/85"
                  }
                >
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      {message.role === "user" ? "You" : "OpenDevin"}
                    </p>
                    {message.role === "assistant" && message.content && (
                      <button
                        onClick={() => copyMessage(message.id, message.content)}
                        className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                      >
                        {copiedId === message.id ? "Copied" : "Copy"}
                      </button>
                    )}
                  </div>
                  {message.role === "user" ? (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  ) : (
                    <Markdown content={message.content || "Thinking…"} />
                  )}
                </article>
              ))}
            </div>
            <form onSubmit={(e) => void send(e)} className="mt-8 border-t border-border pt-4">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (sending) stop();
                    else void send(e as unknown as FormEvent);
                  }
                }}
                rows={3}
                placeholder="Tell the agent what to do next… (Enter to send, Shift+Enter for a new line)"
                className="w-full resize-none rounded-md border border-input bg-card px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
              />
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                  {sending ? "Agent is working…" : " "}
                </p>
                {sending ? (
                  <button
                    onClick={stop}
                    className="rounded-md border border-danger/50 px-4 py-2 text-sm font-medium text-danger"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    disabled={!input.trim()}
                    className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
                  >
                    Send
                  </button>
                )}
              </div>
              {error && <p className="mt-2 text-right text-sm text-danger">{error}</p>}
            </form>
          </div>
        </section>

        {prefs.open && (
          <SessionPanel
            sessionId={sessionId}
            sandboxId={status?.sandboxId || detail?.sandboxId || ""}
            sandboxReady={ready}
            defaultTitle={detail?.title || ""}
            prefs={prefs}
            onPrefs={setPrefs}
            onReconnect={() => void reconnect()}
          />
        )}
      </div>
    </main>
  );
}
