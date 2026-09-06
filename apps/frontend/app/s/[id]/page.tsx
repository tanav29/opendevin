"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconCopy,
  IconCheck,
  IconPlayerStop,
  IconSend2,
  IconRefresh,
  IconTrash,
  IconTerminal,
  IconLayoutSidebarRight,
  IconGitBranch,
  IconClock,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
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
import DeliveryBox01Icon from "@hugeicons/core-free-icons/DeliveryBox01Icon";
import { DeliveryBox01FreeIcons, DeliveryBox02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Bot, Box } from "lucide-react";

function AgentBadge({ working, failed, streaming }: { working: boolean; failed: boolean; streaming: boolean }) {
  const label = streaming || working ? "Working" : failed ? "Failed" : "Idle";
  return (
<<<<<<< HEAD
    <Badge variant={"ghost"}>
      <Bot className="w-3" />
=======
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${streaming || working ? "animate-pulse" : ""}`} />
>>>>>>> cd934e0 (full testing and bug fixes)
      {label}
    </Badge>
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
  return (
<<<<<<< HEAD
    <Badge variant={"ghost"}>
      <Box className="w-3" />
=======
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${pulse ? "animate-pulse" : ""}`} />
>>>>>>> cd934e0 (full testing and bug fixes)
      {label}
    </Badge>
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
      ?.then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId((c) => (c === id ? "" : c)), 1500);
      })
      ?.catch(() => undefined);
  }

  const refresh = useCallback(async (id: string, includeMessages: boolean) => {
    const [nextDetail, nextStatus, nextSessions] = await Promise.all([
      fetch(`${API}/api/sessions/${id}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API}/api/sessions/${id}/status`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
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
      } catch {}
      void refresh(id, true);
    });
  }, [params, refresh]);

  const sandboxStatus = status?.sandboxStatus ?? detail?.sandboxStatus ?? "pending";
  const agentStatus = status?.status ?? detail?.status ?? "idle";
  const busy = isWorking(agentStatus, sandboxStatus) || sending;

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
        const chunk = decoder.decode(value, { stream: true });
        setMessages((current) =>
          current.map((message) => (message.id === "streaming" ? { ...message, content: message.content + chunk } : message)),
        );
      }
      // Flush any remaining bytes
      const tail = decoder.decode();
      if (tail) {
        setMessages((current) =>
          current.map((message) => (message.id === "streaming" ? { ...message, content: message.content + tail } : message)),
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
    if (!sessionId || killing || !window.confirm("Kill this sandbox? The terminal and preview stop; chat history stays.")) return;
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
    if (!sessionId || deleting || !window.confirm("Delete this session and its sandbox? This cannot be undone.")) return;
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
      <header className="flex shrink-0 items-center justify-between gap-2 border-b bg-card px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
<<<<<<< HEAD
          <Button variant="ghost" size="icon-sm" onClick={() => (window.location.href = detail ? `/p/${detail.projectId}` : "/")}>
            <IconArrowLeft />
          </Button>
          <div className="min-w-0 flex gap-2 items-center">
            <h1 className="truncate text-sm font-medium leading-none">{detail?.title || "Loading session…"} </h1>
              {detail?.branch && (
                <Badge variant="outline">
                  {detail.branch}
                </Badge>
              )}

=======
          <Button variant="ghost" size="xs" onClick={() => (window.location.href = detail ? `/p/${detail.projectId}` : "/")}>
            <IconArrowLeft className="size-4" /> <span className="hidden sm:inline">Back</span>
          </Button>
          <span className="hidden h-4 w-px bg-border sm:inline" />
          <div className="min-w-0">
            <h1 className="truncate text-[13px] font-medium leading-none">{detail?.title || "Loading session…"} </h1>
            <div className="hidden items-center gap-1.5 pt-1 sm:flex">
              {detail?.branch && (
                <Badge variant="outline" className="h-4 gap-1 px-1.5 font-mono text-[11px]">
                  <IconGitBranch className="size-3" /> {detail.branch}
                </Badge>
              )}
              {detail && (
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                  <IconClock className="size-3" /> {formatDate(detail.createdAt)}
                </span>
              )}
            </div>
>>>>>>> cd934e0 (full testing and bug fixes)
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <AgentBadge working={agentStatus === "running"} failed={agentStatus === "failed"} streaming={sending} />
          <SandboxBadge status={status} />
          {(failed || (sandboxStatus === "ready" && !status?.sandboxAvailable)) && (
<<<<<<< HEAD
            <Button variant="ghost" size="sm" onClick={() => void reconnect()} disabled={reconnecting}>
=======
            <Button variant="outline" size="xs" onClick={() => void reconnect()} disabled={reconnecting}>
>>>>>>> cd934e0 (full testing and bug fixes)
              {reconnecting ? "…" : "Reconnect"}
            </Button>
          )}
          {(status?.sandboxId || detail?.sandboxId) && !failed && (
<<<<<<< HEAD
            <Button variant="ghost" size="sm" onClick={() => void kill()} disabled={killing} className="hidden sm:inline-flex">
              {killing ? "…" : "Kill"}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => void removeSession()} disabled={deleting}>
            <IconTrash />
            <span className="hidden lg:inline">{deleting ? "…" : "Delete"}</span>
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setPrefs({ ...prefs, open: !prefs.open })}>
            <IconLayoutSidebarRight />
=======
            <Button variant="ghost" size="xs" onClick={() => void kill()} disabled={killing} className="hidden sm:inline-flex">
              {killing ? "…" : "Kill"}
            </Button>
          )}
          <Button variant="ghost" size="xs" onClick={() => void removeSession()} disabled={deleting} className="text-muted-foreground hover:text-destructive">
            <IconTrash className="size-3.5" />
            <span className="hidden lg:inline">{deleting ? "…" : "Delete"}</span>
          </Button>
          <Button variant="outline" size="xs" onClick={() => setPrefs({ ...prefs, open: !prefs.open })}>
            <IconLayoutSidebarRight className="size-3.5" />
            {prefs.open ? "Hide" : "Panel"}
>>>>>>> cd934e0 (full testing and bug fixes)
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
<<<<<<< HEAD
        {/*<SessionSidebar sessions={allSessions} activeId={sessionId} projectId={detail?.projectId || ""} />*/}
=======
        <SessionSidebar sessions={allSessions} activeId={sessionId} projectId={detail?.projectId || ""} />
>>>>>>> cd934e0 (full testing and bug fixes)

        <section className="flex min-w-0 flex-1 flex-col bg-background">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6">
            {provisioning && (
              <div className="mb-5 flex items-center gap-2.5 rounded-lg border bg-card px-3 py-3 text-[13px] text-muted-foreground">
                <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                Spinning up sandbox and cloning repo… the agent gets full workspace access once ready.
              </div>
            )}
            {failed && (
              <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                <p className="text-sm font-medium text-destructive">Sandbox failed: {status?.lastError || detail?.lastError || "unknown error"}</p>
                <Button size="sm" className="mt-3" onClick={() => void reconnect()} disabled={reconnecting}>
                  <IconRefresh className="size-4" /> {reconnecting ? "Reconnecting…" : "Reconnect sandbox"}
                </Button>
              </div>
            )}
            {agentStatus === "failed" && !sending && (
              <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                <p className="text-sm font-medium text-destructive">Agent run failed.</p>
                <Button size="sm" className="mt-3" onClick={retry}>
                  <IconRefresh className="size-4" /> Retry last message
                </Button>
              </div>
            )}

            <div className="flex-1 space-y-4">
              {messages.length === 0 && (
                <EmptyState
                  icon={<IconTerminal className="size-4" />}
                  title="Agent is ready"
                  description="Ask it to inspect files, make a plan, or start building. It can read, edit, run commands, and show you the diff."
                />
              )}
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.role === "user"
<<<<<<< HEAD
                      ? ""
                      : ""
                  }
                >
                  <div className="mb-0.5 flex items-center justify-between">
                    {/*<p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
=======
                      ? "ml-6 rounded-xl border bg-card px-4 py-3 sm:ml-10"
                      : "group mr-2 sm:mr-8"
                  }
                >
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
>>>>>>> cd934e0 (full testing and bug fixes)
                      {message.role === "user" ? "You" : "OpenDevin"}
                    </p>*/}
                    {message.role === "assistant" && message.content && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => copyMessage(message.id, message.content)}
                        className="h-6 gap-1 px-1.5 text-[11px] opacity-0 group-hover:opacity-100"
                      >
                        {copiedId === message.id ? <IconCheck className="size-3" /> : <IconCopy className="size-3" />}
                        {copiedId === message.id ? "Copied" : "Copy"}
                      </Button>
                    )}
                  </div>
                  {message.role === "user" ? (
                    <p className="whitespace-pre-wrap text-[13.5px] leading-6">{message.content}</p>
                  ) : (
                    <div className="rounded-none border-0 bg-transparent p-0 text-[13.5px] leading-7">
                      <Markdown content={message.content || "Thinking…"} />
                    </div>
                  )}
                </article>
              ))}
            </div>

<<<<<<< HEAD
            <form onSubmit={(e) => void send(e)} className="sticky bottom-0 bg-card rounded-xl">
              <div className="">
=======
            <form onSubmit={(e) => void send(e)} className="sticky bottom-0 -mx-4 mt-6 border-t bg-background px-4 pt-4 sm:mx-0 sm:px-0">
              <div className="rounded-xl border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring">
>>>>>>> cd934e0 (full testing and bug fixes)
                <Textarea
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
<<<<<<< HEAD
                  className="min-h-16 rounded-xl bg-transparent resize-none border-0 px-3 py-2 text-sm focus-visible:ring-0"
                />
                <div className="flex items-center justify-between gap-2 px-2 p-2">
                  <p className="px-2 text-[11px] text-muted-foreground">{sending && "Agent is working… esc to stop"}</p>
=======
                  className="min-h-[72px] resize-none border-0 bg-transparent px-3 py-3 shadow-none focus-visible:ring-0"
                />
                <div className="flex items-center justify-between gap-2 border-t px-2 py-2">
                  <p className="px-2 text-[11px] text-muted-foreground">{sending ? "Agent is working… esc to stop" : "↵ send · ⇧↵ new line"}</p>
>>>>>>> cd934e0 (full testing and bug fixes)
                  {sending ? (
                    <Button type="button" variant="outline" size="sm" onClick={stop} className="gap-1.5">
                      <IconPlayerStop className="size-4" /> Stop
                    </Button>
                  ) : (
                    <Button type="submit" size="sm" disabled={!input.trim()} className="gap-1.5">
                      <IconSend2 className="size-4" /> Send
                    </Button>
                  )}
                </div>
              </div>
              {error && <p className="mt-2 text-right text-sm text-destructive">{error}</p>}
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
