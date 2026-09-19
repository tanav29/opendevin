"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  IconArrowLeft,
  IconPlayerStop,
  IconSend2,
  IconRefresh,
  IconTrash,
  IconTerminal,
  IconLayoutSidebarRight,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePanelPrefs } from "./panel-prefs";
import { api } from "@/lib/api";
const Message = dynamic(() => import("./message"), {
  ssr: false,
  loading: () => <span className="text-muted-foreground">Loading response…</span>,
});
const SessionPanel = dynamic(() => import("./session-panel"), {
  ssr: false,
  loading: () => <aside className="hidden w-[min(30vw,480px)] shrink-0 md:block" />,
});
import {
  API,
  PROVISIONING_SANDBOX,
  isWorking,
  type ChatMessage,
  type SessionDetail,
  type SessionStatus,
} from "./lib";
import { Bot, Box, PaperclipIcon } from "lucide-react";

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
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex cursor-help" />}>
        <Badge variant={failed ? "destructive" : "ghost"}>
          <Bot className="w-3" />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {failed
          ? "The last agent run failed. Retry from the conversation."
          : working || streaming
            ? "The agent is currently processing this session."
            : "The agent is ready for your next message."}
      </TooltipContent>
    </Tooltip>
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
  const description = status
    ? `${status.workspacePath || "/home/user/workspace"} · ${
        sandboxStatus === "ready" && status.sandboxAvailable ? "Connected" : label
      }`
    : "Loading sandbox status…";
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex cursor-help" />}>
        <Badge variant={sandboxStatus === "error" ? "destructive" : "ghost"}>
          <Box className="w-3" />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  );
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const [sessionId, setSessionId] = useState("");
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [killing, setKilling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [attachments, setAttachments] = useState<{ name: string; content: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [prefs, setPrefs] = usePanelPrefs();

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files).slice(0, 3);
    for (const f of list) {
      if (f.size > 200_000) {
        setError(`Attachment ${f.name} too large (max 200KB).`);
        continue;
      }
      try {
        const text = await f.text();
        setAttachments((cur) =>
          cur.length >= 3
            ? cur
            : [...cur, { name: f.name.slice(0, 100), content: text.slice(0, 50_000) }],
        );
      } catch {
        setError(`Could not read ${f.name}.`);
      }
    }
  }
  const refresh = useCallback(async (id: string, includeMessages: boolean) => {
    const [nextDetail, nextStatus, history] = await Promise.all([
      api<SessionDetail>(`/api/sessions/${id}`).catch(() => null),
      api<SessionStatus>(`/api/sessions/${id}/status`).catch(() => null),
      includeMessages
        ? api<ChatMessage[]>(`/api/sessions/${id}/messages`).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (nextDetail) setDetail(nextDetail);
    if (nextStatus) setStatus(nextStatus);
    if (history) setMessages(history);
    return nextDetail as SessionDetail | null;
  }, []);

  // Keep the latest turn visible while streaming or after history loads.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending]);

  // Autogrow the composer instead of a fixed 3-row box.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);
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
      await api(`/api/sessions/${sessionId}/reconnect`, {
        method: "POST",
      });
      await refresh(sessionId, false);
    } catch {
      setError("Could not reconnect sandbox: the server is unreachable.");
    } finally {
      setReconnecting(false);
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || !sessionId || sending) return;
    let full = trimmed;
    if (attachments.length > 0) {
      const blocks = attachments
        .map((a) => `<attachment name="${a.name}">\n${a.content}\n</attachment>`)
        .join("\n\n");
      full = trimmed ? `${trimmed}\n\n${blocks}` : blocks;
      full = full.slice(0, 60_000);
    }
    setInput("");
    setAttachments([]);
    setError("");
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: "user", content: full },
      { id: "streaming", role: "assistant", content: "" },
    ]);
    try {
      const response = await fetch(`${API}/api/sessions/${sessionId}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: full }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "The agent could not respond");
        setMessages((current) => current.filter((message) => message.id !== "streaming"));
        return;
      }
      setDegraded(response.headers.get("x-sandbox-degraded") === "1");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((current) =>
          current.map((message) =>
            message.id === "streaming" ? { ...message, content: message.content + chunk } : message,
          ),
        );
      }
      // Flush any remaining bytes
      const tail = decoder.decode();
      if (tail) {
        setMessages((current) =>
          current.map((message) =>
            message.id === "streaming" ? { ...message, content: message.content + tail } : message,
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
      await refresh(sessionId, true);
    }
  }

  function stop() {
    abortRef.current?.abort();
    // Server-side abort: actually stops the model turn, not just the stream.
    if (sessionId) {
      void api(`/api/sessions/${sessionId}/stop`, {
        method: "POST",
      })
        .then(() => refresh(sessionId, true))
        .catch(() => undefined);
    }
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
      await api(`/api/sessions/${sessionId}/kill`, {
        method: "POST",
      });
      await refresh(sessionId, false);
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
      await api(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });
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
      <header className="z-10 flex shrink-0 items-center justify-between gap-3 border-b bg-card/90 px-3 py-2.5 backdrop-blur sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back to project"
                onClick={() => (window.location.href = detail ? `/p/${detail.projectId}` : "/")}
              >
                <IconArrowLeft />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back to project</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<div className="min-w-0 cursor-default" />}>
              <div className="flex min-w-0 items-center gap-2">
                  <h1 className="max-w-[min(42vw,24rem)] truncate text-sm">
                    {detail?.title || "Loading session…"}
                  </h1>
                {detail?.branch && <Badge variant="outline">{detail.branch}</Badge>}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {detail?.workspacePath || "Session workspace"}
              {detail?.branch ? ` · branch ${detail.branch}` : ""}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <AgentBadge
            working={agentStatus === "running"}
            failed={agentStatus === "failed"}
            streaming={sending}
          />
          <SandboxBadge status={status} />
          {(failed || (sandboxStatus === "ready" && !status?.sandboxAvailable)) && (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void reconnect()}
                  disabled={reconnecting}
                >
                  {reconnecting ? "…" : "Reconnect"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reconnect the workspace sandbox</TooltipContent>
            </Tooltip>
          )}
          {(status?.sandboxId || detail?.sandboxId) && !failed && (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button
                  variant="destructive"
                  size="sm"
                  aria-label="Stop sandbox"
                  onClick={() => void kill()}
                  disabled={killing}
                  className="gap-1.5"
                >
                  <IconPlayerStop className="size-3.5" />
                  <span className="hidden sm:inline">{killing ? "Stopping…" : "Stop sandbox"}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop the sandbox, terminal, and preview</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Delete session"
                onClick={() => void removeSession()}
                disabled={deleting}
              >
                <IconTrash />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete this session and its history</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button
                variant={prefs.open ? "outline" : "secondary"}
                size="icon-sm"
                aria-label={prefs.open ? "Hide workspace panel" : "Show workspace panel"}
                onClick={() => setPrefs({ ...prefs, open: !prefs.open })}
              >
                <IconLayoutSidebarRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{prefs.open ? "Hide workspace panel" : "Show workspace panel"}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col bg-background">
          <div className="chat-scroll mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto px-4 py-7 sm:px-8">
            {provisioning && (
              <div className="mb-5 flex items-center gap-2.5 rounded-lg border bg-card px-3 py-3 text-[13px] text-muted-foreground">
                <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                Spinning up sandbox and cloning repo… the agent gets full workspace access once
                ready.
              </div>
            )}
            {degraded && !failed && (
              <div className="mb-5 rounded-lg border border-warning/40 bg-warning-muted/40 px-3 py-2.5 text-[13px]">
                Sandbox unreachable — this answer is from general knowledge. Reconnect for workspace
                tools.
              </div>
            )}
            {failed && (
              <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                <p className="text-sm font-medium text-destructive">
                  Sandbox failed: {status?.lastError || detail?.lastError || "unknown error"}
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => void reconnect()}
                  disabled={reconnecting}
                >
                  <IconRefresh className="size-4" />{" "}
                  {reconnecting ? "Reconnecting…" : "Reconnect sandbox"}
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

            <div className="flex-1 space-y-6">
              {messages.length === 0 && (
                <EmptyState
                  icon={<IconTerminal className="size-4" />}
                  title="Agent is ready"
                  description="Ask it to inspect, plan, or build."
                />
              )}
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={message.role === "user" ? "group flex justify-end" : "group"}
                >
                  {message.role === "user" ? (
                    <p className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[13.5px] leading-6 text-primary-foreground shadow-sm sm:max-w-[75%]">
                      {message.content}
                    </p>
                  ) : message.content ? (
                    <div className="max-w-[94%] rounded-2xl rounded-tl-md border border-border/70 bg-card px-4 py-3 text-[13.5px] leading-7 shadow-sm sm:max-w-[88%]">
                      <Message
                        content={message.content}
                        onAnswer={(text) => void sendMessage(text)}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 py-1" aria-label="Thinking">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
                    </div>
                  )}
                </article>
              ))}
            </div>
            <div ref={bottomRef} />

            <form
              onSubmit={(e) => void send(e)}
              className="sticky bottom-0 mt-6 rounded-2xl border border-border bg-card shadow-lg shadow-black/[0.06] transition-shadow focus-within:border-ring focus-within:shadow-xl"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
              }}
            >
              <div className="">
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-3 pt-2">
                    {attachments.map((a) => (
                      <span
                        key={a.name}
                        className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[11px]"
                      >
                        {a.name} · {(a.content.length / 1024).toFixed(1)}KB
                        <button
                          type="button"
                          onClick={() =>
                            setAttachments((cur) => cur.filter((x) => x.name !== a.name))
                          }
                          className="text-muted-foreground hover:text-foreground"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={(e) => {
                    if (e.clipboardData.files.length > 0) void addFiles(e.clipboardData.files);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (sending) stop();
                      else void send(e as unknown as FormEvent);
                    }
                  }}
                  rows={1}
                  ref={textareaRef}
                  placeholder="Tell the agent what to do…"
                  className="min-h-14 w-full resize-none rounded-2xl border-0 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
                />
                <div className="flex items-center justify-between gap-2 px-2 pb-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) void addFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => fileRef.current?.click()}
                      disabled={sending}
                      className="px-2 text-[12px]"
                    >
                      <PaperclipIcon />
                    </Button>
                    <p className="hidden px-1 text-[11px] text-muted-foreground lg:block">
                      {status?.plan && status.plan.length > 0
                        ? `Plan ${status.plan.filter((t) => t.status === "done").length}/${status.plan.length}`
                        : ""}
                      {status?.usage?.totalTokens
                        ? ` · ${(Number(status.usage.totalTokens) / 1000).toFixed(1)}k tok`
                        : ""}
                    </p>
                  </div>
                  {sending ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={stop}
                      className="gap-1.5"
                    >
                      <IconPlayerStop className="size-4" /> Stop
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      size="sm"
                      variant="default"
                      disabled={!input.trim() && attachments.length === 0}
                      className="gap-1.5 rounded-xl px-3"
                    >
                      <span className="hidden sm:inline">Send</span>
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
            workspacePath={status?.workspacePath || detail?.workspacePath || ""}
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
