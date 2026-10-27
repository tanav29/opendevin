"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import dynamic from "next/dynamic";
import {
  IconArrowLeft,
  IconCopy,
  IconInfoCircle,
  IconPlayerStop,
  IconRefresh,
  IconTrash,
  IconLayoutSidebarRight,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiErrorState, asApiError, isNotFoundError } from "@/components/api-error-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { usePanelPrefs } from "./panel-prefs";
import { api, ApiError } from "@/lib/api";
import DevRunButton from "./dev-run-button";
import ChatComposer from "@/components/chat/composer";
import {
  MAX_MESSAGE_CHARS,
  serializeAttachments,
  useAttachments,
} from "@/components/chat/use-attachments";
import { serializeSkills, useSkills } from "@/components/chat/use-skills";
import { SkillChips, SkillsButton } from "@/components/chat/skills-modal";
const ChatMessageRow = dynamic(() => import("@/components/chat/message-row"), {
  ssr: false,
  loading: () => <span className="text-muted-foreground">Loading response…</span>,
});
const SessionPanel = dynamic(() => import("./session-panel"), {
  ssr: false,
  loading: () => <aside className="hidden w-[min(30vw,480px)] shrink-0 md:block" />,
});
import {
  API,
  formatDate,
  isWorking,
  type ChatMessage,
  type SessionDetail,
  type SessionStatus,
} from "./lib";
import { HugeiconsIcon } from "@hugeicons/react";
import { Attachment01Icon } from "@hugeicons/core-free-icons";

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 border-b border-border/60 py-2.5 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-xs font-medium">{value || "—"}</dd>
    </div>
  );
}

function CompactValue({ value, onCopy }: { value: string; onCopy: (value: string) => void }) {
  if (!value) return <span>—</span>;
  const visible = value.length > 5 ? `${value.slice(0, 5)}…` : value;
  return (
    <span className="inline-flex max-w-full items-center justify-end gap-1">
      <span className="truncate font-mono" title={value}>
        {visible}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Copy ${value}`}
        onClick={() => onCopy(value)}
      >
        <IconCopy />
      </Button>
    </span>
  );
}

function SessionInfoDialog({
  sessionId,
  detail,
  status,
  onReconnect,
  onKill,
  reconnecting,
  killing,
}: {
  sessionId: string;
  detail: SessionDetail | null;
  status: SessionStatus | null;
  onReconnect: () => void;
  onKill: () => void;
  reconnecting: boolean;
  killing: boolean;
}) {
  const sandboxStatus =
    status?.lifecycle?.provisioning || status?.sandboxStatus || detail?.sandboxStatus || "pending";
  const agentStatus = status?.lifecycle?.agent || status?.status || detail?.status || "idle";
  const verification = status?.lifecycle?.verification || "pending";
  const plan = status?.plan || [];
  const usage = status?.usage;
  const createdAt = detail?.createdAt || status?.createdAt;
  const [copied, setCopied] = useState("");
  const sandboxId = status?.sandboxId || detail?.sandboxId || "";
  const canReconnect =
    sandboxStatus === "error" ||
    sandboxStatus === "unavailable" ||
    (status?.sandboxStatus === "ready" && !status?.sandboxAvailable);

  function copyValue(value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(value);
      window.setTimeout(() => setCopied(""), 1400);
    });
  }

  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="View session information" />}
      >
        <IconInfoCircle />
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Session information</DialogTitle>
          <DialogDescription>
            Runtime details for {detail?.title || "this session"}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-lg border bg-muted/20 px-3">
            <h3 className="border-b border-border/60 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Session
            </h3>
            <dl>
              <InfoRow
                label="Session ID"
                value={<CompactValue value={sessionId} onCopy={copyValue} />}
              />
              <InfoRow
                label="Project"
                value={<CompactValue value={detail?.projectId || ""} onCopy={copyValue} />}
              />
              <InfoRow label="Branch" value={status?.branch || detail?.branch || ""} />
              <InfoRow label="Agent status" value={agentStatus} />
              <InfoRow label="Result" value={verification} />
              <InfoRow label="Model" value={status?.model || detail?.model || ""} />
            </dl>
          </section>
          <section className="rounded-lg border bg-muted/20 px-3">
            <h3 className="border-b border-border/60 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Workspace
            </h3>
            <dl>
              <InfoRow label="Sandbox" value={sandboxStatus} />
              <InfoRow
                label="Availability"
                value={status ? (status.sandboxAvailable ? "Connected" : "Unreachable") : ""}
              />
              <InfoRow
                label="Sandbox ID"
                value={<CompactValue value={sandboxId} onCopy={copyValue} />}
              />
              <InfoRow label="Path" value={status?.workspacePath || detail?.workspacePath || ""} />
              <InfoRow label="Repository" value={status?.repo || ""} />
            </dl>
          </section>
          <section className="rounded-lg border bg-muted/20 px-3 sm:col-span-2">
            <h3 className="border-b border-border/60 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Activity
            </h3>
            <dl className="grid sm:grid-cols-2 sm:gap-x-6">
              <InfoRow label="Created" value={createdAt ? formatDate(createdAt) : ""} />
              <InfoRow
                label="Updated"
                value={detail?.updatedAt ? formatDate(detail.updatedAt) : ""}
              />
              <InfoRow
                label="Plan"
                value={
                  plan.length
                    ? `${plan.filter((item) => item.status === "done").length}/${plan.length} complete`
                    : "No plan"
                }
              />
              <InfoRow
                label="Tokens"
                value={usage?.totalTokens ? usage.totalTokens.toLocaleString() : "—"}
              />
              <InfoRow
                label="Last error"
                value={status?.lastError || detail?.lastError || "None"}
              />
            </dl>
          </section>
        </div>
        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <span className="text-xs text-muted-foreground">
            {copied ? "Copied full value" : "IDs are shortened for readability"}
          </span>
          <div className="flex gap-2">
            {canReconnect && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onReconnect}
                disabled={reconnecting}
              >
                <IconRefresh /> {reconnecting ? "Reconnecting…" : "Reconnect"}
              </Button>
            )}
            {sandboxId && sandboxStatus !== "error" && sandboxStatus !== "unavailable" && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onKill}
                disabled={killing}
              >
                <IconPlayerStop /> {killing ? "Stopping…" : "Kill sandbox"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ReconnectConflict = {
  message: string;
  patchAvailable: boolean;
  capturedAt: string | null;
};

function ReconnectConflictDialog({
  conflict,
  reconnecting,
  onOpenChange,
  onReview,
  onDownload,
  onConfirm,
}: {
  conflict: ReconnectConflict | null;
  reconnecting: boolean;
  onOpenChange: (open: boolean) => void;
  onReview: () => void;
  onDownload: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(conflict)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Replace the unavailable sandbox?</DialogTitle>
          <DialogDescription>
            This session may contain uncommitted work. A fresh clone does not restore the previous
            workspace.
          </DialogDescription>
        </DialogHeader>
        {conflict?.patchAvailable && (
          <div className="rounded-lg border bg-muted/30 p-3 text-[13px] leading-5">
            <p className="font-medium">A saved patch is available.</p>
            <p className="mt-1 text-muted-foreground">
              It is review/download only and will not be applied to the replacement sandbox.
              {conflict.capturedAt
                ? ` Captured ${new Date(conflict.capturedAt).toLocaleString()}.`
                : ""}
            </p>
          </div>
        )}
        <p className="text-sm text-muted-foreground">{conflict?.message}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {conflict?.patchAvailable && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onReview}>
                Review patch
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onDownload}>
                Download patch
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={reconnecting}
          >
            {reconnecting ? "Creating fresh sandbox…" : "Create fresh sandbox"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const [sessionId, setSessionId] = useState("");
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectConflict, setReconnectConflict] = useState<ReconnectConflict | null>(null);
  const [killing, setKilling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { attachments, addFiles, removeAttachment, resetAttachments } = useAttachments();
  const { skills, toggle: toggleSkill, remove: removeSkill, resetSkills } = useSkills();
  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${API}/api/sessions/${sessionId}/chat`,
        credentials: "include",
        prepareSendMessagesRequest: ({ messages: outgoing }) => ({
          body: {
            message:
              outgoing
                .at(-1)
                ?.parts.filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("") ?? "",
          },
        }),
      }),
    [sessionId],
  );
  const {
    messages: liveMessages,
    sendMessage: streamMessage,
    stop: stopStreaming,
    setMessages: setLiveMessages,
  } = useChat({ id: sessionId, transport: chatTransport });
  const latestLiveText = liveMessages
    .at(-1)
    ?.parts.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [prefs, setPrefs] = usePanelPrefs();

  const refresh = useCallback(async (id: string, includeMessages: boolean, showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const [detailResult, statusResult, messagesResult] = await Promise.allSettled([
        api<SessionDetail>(`/api/sessions/${id}`),
        api<SessionStatus>(`/api/sessions/${id}/status`),
        includeMessages ? api<ChatMessage[]>(`/api/sessions/${id}/messages`) : Promise.resolve([]),
      ]);

      if (detailResult.status === "fulfilled") setDetail(detailResult.value);
      if (statusResult.status === "fulfilled") setStatus(statusResult.value);
      if (messagesResult.status === "fulfilled" && includeMessages) {
        setMessages(messagesResult.value);
      }

      const failure = [detailResult, statusResult, messagesResult].find(
        (result) => result.status === "rejected",
      );
      if (failure && failure.status === "rejected") {
        setLoadError(asApiError(failure.reason));
      } else {
        setLoadError(null);
      }
      return detailResult.status === "fulfilled" ? detailResult.value : null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // Keep the latest turn visible while streaming or after history loads.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending, liveMessages.length, latestLiveText]);

  useEffect(() => {
    void params.then(({ id }) => {
      setSessionId(id);
      try {
        window.localStorage.setItem("opendevin:selected-session", id);
      } catch {}
      void refresh(id, true, true);
    });
  }, [params, refresh]);

  const sandboxStatus = status?.sandboxStatus ?? detail?.sandboxStatus ?? "pending";
  const lifecycle = status?.lifecycle;
  const provisioningPhase =
    lifecycle?.provisioning ??
    (sandboxStatus === "ready" && status?.sandboxAvailable === false
      ? "unavailable"
      : sandboxStatus);
  const agentStatus = lifecycle?.agent ?? status?.status ?? detail?.status ?? "idle";
  const activeAgent = agentStatus === "running" || lifecycle?.activeTurn === true;
  const agentQueued = agentStatus === "queued";
  const agentBusy = activeAgent || agentQueued;
  const busy = isWorking(agentStatus, sandboxStatus, lifecycle?.agent) || sending;

  useEffect(() => {
    if (!sessionId || !busy) return;
    const timer = setInterval(() => void refresh(sessionId, !sending), 3000);
    return () => clearInterval(timer);
  }, [sessionId, busy, sending, refresh]);

  async function reconnect(confirmReplace = false) {
    if (!sessionId || reconnecting) return;
    setReconnecting(true);
    try {
      const result = await api<{
        replaced?: boolean;
        reattached?: boolean;
        continuity?: "fresh-clone" | "existing-sandbox";
      }>(
        `/api/sessions/${sessionId}/reconnect`,
        {
          method: "POST",
          body: JSON.stringify({ confirmReplace }),
        },
        60_000,
      );
      setReconnectConflict(null);
      if (result.replaced) {
        toast.info("Fresh sandbox created. The previous workspace was not restored.");
      } else if (result.reattached) {
        toast.success("Reconnected to the existing sandbox.");
      }
      await refresh(sessionId, false);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === "sandbox_reconnect_dirty"
      ) {
        const details = error.details as
          | { patch?: { available?: boolean; capturedAt?: string | null } }
          | undefined;
        setReconnectConflict({
          message: error.message,
          patchAvailable: Boolean(details?.patch?.available),
          capturedAt: details?.patch?.capturedAt ?? null,
        });
      } else if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Could not reconnect sandbox: the server is unreachable.");
      }
    } finally {
      setReconnecting(false);
    }
  }

  async function downloadRecoveryPatch() {
    try {
      const result = await api<{ diff?: string }>(
        `/api/sessions/${sessionId}/diff`,
        undefined,
        60_000,
      );
      if (!result.diff) {
        toast.info("No recovery patch is available for this session.");
        return;
      }
      const url = URL.createObjectURL(new Blob([result.diff], { type: "text/x-patch" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `session-${sessionId.slice(-8)}-recovery.patch`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not download the recovery patch.",
      );
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (
      (!trimmed && attachments.length === 0 && skills.length === 0) ||
      !sessionId ||
      sending ||
      agentBusy ||
      !ready
    )
      return;
    const blocks = [serializeAttachments(attachments), serializeSkills(skills)]
      .filter(Boolean)
      .join("\n\n");
    const full = trimmed ? (blocks ? `${trimmed}\n\n${blocks}` : trimmed) : blocks;
    if (full.length > MAX_MESSAGE_CHARS) {
      toast.error(`Message exceeds the ${MAX_MESSAGE_CHARS.toLocaleString()}-character limit.`);
      return;
    }
    setInput("");
    resetAttachments();
    resetSkills();
    setSending(true);
    try {
      await streamMessage({ text: full });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.info("Stopped. The server run was cancelled.");
      } else {
        toast.error(err instanceof Error ? err.message : "Couldn't reach the agent. Try again.");
      }
    } finally {
      setSending(false);
      await refresh(sessionId, true);
      setLiveMessages([]);
    }
  }

  function stop() {
    stopStreaming();
    // Server-side abort: actually stops the model turn, not just the stream.
    if (sessionId) {
      void api(`/api/sessions/${sessionId}/stop`, {
        method: "POST",
      })
        .then(() => refresh(sessionId, true))
        .catch(() => undefined);
    }
  }

  async function kill() {
    if (
      !sessionId ||
      killing ||
      !window.confirm("Kill this sandbox? The terminal and preview stop; chat history stays.")
    )
      return;
    setKilling(true);
    try {
      await api(`/api/sessions/${sessionId}/kill`, { method: "POST" });
      await refresh(sessionId, false);
    } catch {
      toast.error("Could not kill sandbox: the server is unreachable.");
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
      toast.error("Could not delete session: the server is unreachable.");
      setDeleting(false);
    }
  }

  function send() {
    void sendMessage(input);
  }

  const ready = provisioningPhase === "ready" && (status?.sandboxAvailable ?? false);
  const chatDisabled = !ready || sending || agentBusy;
  const sessionNotFound = isNotFoundError(loadError);

  if (loading && !detail && !status) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="absolute left-3 top-3">
          <SidebarTrigger className="md:hidden" />
        </div>
        <p className="text-sm text-muted-foreground">Loading session…</p>
      </main>
    );
  }

  if (loadError && !detail) {
    return (
      <main className="relative flex min-h-screen items-center justify-center bg-background p-6">
        <div className="absolute left-3 top-3">
          <SidebarTrigger className="md:hidden" />
        </div>
        <div className="w-full max-w-md space-y-4">
          <ApiErrorState
            error={loadError}
            title={sessionNotFound ? "Session not found" : "Session unavailable"}
            description={
              sessionNotFound
                ? "It may have been deleted or you may not have access."
                : "We couldn't load this session. Retry when the API is reachable."
            }
            onRetry={
              sessionNotFound
                ? undefined
                : () => {
                    void refresh(sessionId, true, true);
                  }
            }
          />
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = "/")}>
            <IconArrowLeft /> Back to dashboard
          </Button>
        </div>
      </main>
    );
  }

  return (
      <main className="h-screen bg-background w-full overflow-clip">
        <header className="absolute top-0 left-0 right-0 z-10 flex shrink-0 items-center justify-between gap-3 bg-sidebar border-b px-3 py-2">
          <div className="flex items-center gap-2 justify-center">
            <SidebarTrigger className="md:hidden" />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back to project"
              onClick={() => (window.location.href = detail ? `/p/${detail.projectId}` : "/")}
            >
              <IconArrowLeft />
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate">
                {detail?.title || "Loading session…"}
              </h1>
              {detail?.branch && <p>repoName/{detail.branch}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <DevRunButton
              sessionId={sessionId}
              sandboxReady={ready}
              devCommand={status?.devCommand}
              devPort={status?.devPort}
              onOpened={() => setPrefs({ ...prefs, open: true, tab: "preview" })}
              onError={(message) => toast.error(message)}
            />
            <SessionInfoDialog
              sessionId={sessionId}
              detail={detail}
              status={status}
              onReconnect={() => void reconnect()}
              onKill={() => void kill()}
              reconnecting={reconnecting}
              killing={killing}
            />
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
                  disabled={!ready}
                  title={!ready ? "Workspace panel needs a running sandbox" : undefined}
                >
                  <IconLayoutSidebarRight />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {prefs.open ? "Hide workspace panel" : "Show workspace panel"}
              </TooltipContent>
            </Tooltip>
          </div>
        </header>

          <section className="flex max-w-5xl h-full gap-4 sm:mx-8 pt-16 pb-32 flex-col bg-background overflow-y-auto scrollbar-none">
              {messages.map((message, index) => {
                const startedAt = messages
                  .slice(0, index)
                  .reverse()
                  .find((previous) => previous.role === "user")?.createdAt;
                const elapsedMs = startedAt
                  ? Date.parse(message.createdAt) - Date.parse(startedAt)
                  : NaN;
                const workDuration = Number.isFinite(elapsedMs)
                  ? Math.max(1, Math.round(elapsedMs / 1000))
                  : undefined;
                return (
                  <ChatMessageRow
                    key={message.id}
                    role={message.role === "user" ? "user" : "assistant"}
                    content={message.content}
                    workDuration={message.role === "assistant" ? workDuration : undefined}
                    presentation="session"
                    workingLabel="Working"
                    onAnswer={(text) => void sendMessage(text)}
                  />
                );
              })}
              {/*Why chat messages and live messages are diff component fuck you ai*/}
                {liveMessages.map((message) => (
                  <ChatMessageRow
                    key={message.id}
                    role={message.role === "user" ? "user" : "assistant"}
                    content={message.parts
                      .filter((part) => part.type === "text")
                      .map((part) => part.text)
                      .join("")}
                    presentation="session"
                    workingLabel="Working"
                    onAnswer={(text) => void sendMessage(text)}
                  />
                ))}
              <div ref={bottomRef} />
          </section>

            <div className="absolute bottom-0 left-0 right-0 shrink-0 sm:mx-8 mx-4 pb-4">
              <ChatComposer
                value={input}
                onValueChange={setInput}
                onSubmit={send}
                onStop={stop}
                busy={sending || activeAgent}
                disabled={chatDisabled}
                canSend={Boolean(input.trim()) || attachments.length > 0 || skills.length > 0}
                placeholder="Tell the agent what to do…"
                onPasteFiles={(files) => void addFiles(files)}
                onDropFiles={(files) => void addFiles(files)}
                attachments={
                  attachments.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 px-3 pt-2">
                      {attachments.map((a) => (
                        <span
                          key={a.id}
                          className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[11px]"
                        >
                          {a.name} · {(a.content.length / 1024).toFixed(1)}KB
                          <button
                            type="button"
                            onClick={() => removeAttachment(a.id)}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Remove ${a.name}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : undefined
                }
                skills={
                  skills.length > 0 ? (
                    <SkillChips skills={skills} onRemove={removeSkill} />
                  ) : undefined
                }
                notice={
                  (activeAgent || agentQueued) && !sending ? (
                    <p className="px-4 pt-3 text-xs text-muted-foreground" role="status">
                      {agentQueued
                        ? "The agent is preparing this task. It will be ready for a new message shortly."
                        : "An agent turn is running, possibly in another tab. Stop it before sending a new message."}
                    </p>
                  ) : undefined
                }
                actions={
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      className="hidden"
                      disabled={chatDisabled}
                      onChange={(e) => {
                        if (e.target.files) void addFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <SkillsButton
                      selected={skills}
                      onToggle={toggleSkill}
                      disabled={chatDisabled}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => fileRef.current?.click()}
                      disabled={chatDisabled}
                      className="px-2 text-[12px]"
                      aria-label="Attach files"
                    >
                      <HugeiconsIcon icon={Attachment01Icon} size={18} strokeWidth={1.8} />
                    </Button>
                    <p className="hidden px-1 text-[11px] text-muted-foreground lg:block">
                      {status?.plan && status.plan.length > 0
                        ? `Plan ${status.plan.filter((t) => t.status === "done").length}/${status.plan.length}`
                        : ""}
                      {status?.usage?.totalTokens
                        ? `Context: ${(Number(status.usage.totalTokens) / 1000).toFixed(1)}k tok`
                        : ""}
                    </p>
                  </>
                }
              />
            </div>

          {prefs.open && (
            <SessionPanel
              sessionId={sessionId}
              sandboxId={status?.sandboxId || detail?.sandboxId || ""}
              sandboxReady={ready}
              defaultTitle={detail?.title || ""}
              prefs={prefs}
              onPrefs={setPrefs}
              onReconnect={() => void reconnect()}
              onCommitted={() => void refresh(sessionId, false)}
              defaultPort={status?.devPort}
            />
          )}
          <ReconnectConflictDialog
            conflict={reconnectConflict}
            reconnecting={reconnecting}
            onOpenChange={(open) => {
              if (!open) setReconnectConflict(null);
            }}
            onReview={() => {
              setReconnectConflict(null);
              setPrefs({ ...prefs, open: true, tab: "changes" });
            }}
            onDownload={() => void downloadRecoveryPatch()}
            onConfirm={() => void reconnect(true)}
          />
      </main>
  );
}
