"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import dynamic from "next/dynamic";
import { IconArrowLeft, IconGitBranch, IconLayoutSidebarRight } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiErrorState, asApiError, isNotFoundError } from "@/components/api-error-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { usePanelPrefs } from "./panel-prefs";
import { api, ApiError } from "@/lib/api";
import DevRunButton from "./dev-run-button";
import SessionInfo from "./session-info";
import ChatComposer from "@/components/chat/composer";
import { parseSuggestions } from "@/components/chat/suggestions";
import ChatQuestionnaire, { parseQuestion } from "@/components/chat/questionnaire";
import { Conversation } from "@/components/ai-elements/conversation";
import { PromptAttachments } from "@/components/ai-elements/attachments";
import { Reasoning } from "@/components/ai-elements/activity";
import { MessageScrollerItem } from "@/components/ui/message-scroller";
import { ContextDetails } from "@/components/chat/context-details";
import {
  MAX_MESSAGE_CHARS,
  serializeAttachments,
  useAttachments,
} from "@/components/chat/use-attachments";
import { serializeSkills, useSkills } from "@/components/chat/use-skills";
import { SkillChips, SkillsButton } from "@/components/chat/skills-modal";
const ChatMessageRow = dynamic(() => import("@/components/chat/message-row"), {
  ssr: false,
});
const SessionPanel = dynamic(() => import("./session-panel"), {
  ssr: false,
  loading: () => <aside className="hidden w-[min(30vw,480px)] shrink-0 md:block" />,
});
import { API, isWorking, type ChatMessage, type SessionDetail, type SessionStatus } from "./lib";
import { HugeiconsIcon } from "@hugeicons/react";
import { Attachment01Icon } from "@hugeicons/core-free-icons";
import { useComposerDraft } from "@/hooks/use-composer-draft";

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
  const { id: sessionId } = use(params);
  const currentSession = useRef(sessionId);
  currentSession.current = sessionId;
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput, draftReady, clearDraft] = useComposerDraft(
    sessionId ? `session:${sessionId}` : null,
  );
  const pendingDraft = useRef<(() => void) | null>(null);
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
        prepareSendMessagesRequest: ({ messages: outgoing, body }) => ({
          body: {
            message:
              outgoing
                .at(-1)
                ?.parts.filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("") ?? "",
            ...body,
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
  } = useChat({
    id: sessionId,
    transport: chatTransport,
    onError: (error) => toast.error(error.message),
    onFinish: ({ isAbort, isError, isDisconnect }) => {
      if (!isAbort && !isError && !isDisconnect) pendingDraft.current?.();
      pendingDraft.current = null;
    },
  });
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

  useEffect(() => {
    try {
      window.localStorage.setItem("opendevin:selected-session", sessionId);
    } catch {}
    void refresh(sessionId, true, true);
  }, [sessionId, refresh]);

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

  async function sendMessage(text: string, questionMessageId?: string) {
    const trimmed = text.trim();
    if (
      (!trimmed && attachments.length === 0 && skills.length === 0) ||
      !sessionId ||
      sending ||
      agentBusy ||
      !ready
    )
      return;
    const blocks = (
      questionMessageId ? [] : [serializeAttachments(attachments), serializeSkills(skills)]
    )
      .filter(Boolean)
      .join("\n\n");
    const full = trimmed ? (blocks ? `${trimmed}\n\n${blocks}` : trimmed) : blocks;
    if (full.length > MAX_MESSAGE_CHARS) {
      toast.error(`Message exceeds the ${MAX_MESSAGE_CHARS.toLocaleString()}-character limit.`);
      return;
    }
    pendingDraft.current =
      !questionMessageId && text === input
        ? () => {
            clearDraft(input);
            if (currentSession.current === sessionId) {
              resetAttachments();
              resetSkills();
            }
          }
        : null;
    setSending(true);
    try {
      if (questionMessageId) {
        await streamMessage(undefined, {
          body: { message: full, questionAnswer: { messageId: questionMessageId } },
        });
      } else {
        await streamMessage({ text: full });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.info("Stopped. The server run was cancelled.");
      } else {
        toast.error(err instanceof Error ? err.message : "Couldn't reach the agent. Try again.");
      }
    } finally {
      await refresh(sessionId, true);
      setLiveMessages([]);
      setSending(false);
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
  const latestMessage = messages.at(-1);
  const question =
    latestMessage?.role === "assistant" ? parseQuestion(latestMessage.content) : null;
  const suggestions =
    latestMessage?.role === "assistant" ? parseSuggestions(latestMessage.content) : [];

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
    <main className="flex h-screen w-full min-w-0 flex-col bg-background">
      <header className="z-10 flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-background px-3">
        <div className="flex min-w-0 items-center gap-2">
          <SidebarTrigger className="md:hidden" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to project"
            onClick={() => (window.location.href = detail ? `/p/${detail.projectId}` : "/")}
          >
            <IconArrowLeft />
          </Button>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <h1 className="truncate font-medium">{detail?.title || "Loading session…"}</h1>
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
            <TooltipContent>
              {prefs.open ? "Hide workspace panel" : "Show workspace panel"}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1">
        <section
          aria-label="Agent conversation"
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
        >
          <Conversation className="flex-1">
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
              >
                <ChatMessageRow
                  role={message.role === "user" ? "user" : "assistant"}
                  content={message.content}
                />
              </MessageScrollerItem>
            ))}
            {/* Historical and streaming messages have different source shapes. */}
            {liveMessages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
              >
                <ChatMessageRow
                  role={message.role === "user" ? "user" : "assistant"}
                  parts={message.parts}
                  isStreaming={sending && message === liveMessages.at(-1)}
                />
              </MessageScrollerItem>
            ))}
            {agentStatus === "failed" && (status?.lastError || detail?.lastError) && (
              <div role="alert" className="rounded-md border border-destructive/40 p-4 text-sm">
                <p className="font-medium text-destructive">Agent run failed</p>
                <p className="mt-1 whitespace-pre-wrap">{status?.lastError || detail?.lastError}</p>
                {messages.at(-1)?.role === "user" && (
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    disabled={chatDisabled}
                    onClick={() => void sendMessage(messages.at(-1)!.content)}
                  >
                    Retry last message
                  </Button>
                )}
              </div>
            )}
            {(activeAgent || sending) && liveMessages.at(-1)?.role !== "assistant" && (
              <Reasoning running />
            )}
            {messages.length === 0 && liveMessages.length === 0 && !activeAgent && !sending && (
              <p className="my-auto py-12 text-center text-sm text-muted-foreground">
                {ready
                  ? "Send a message to start working with the agent."
                  : "Your workspace is being prepared. Chat will be available when it is ready."}
              </p>
            )}
          </Conversation>
          <div className="z-20 w-full shrink-0 px-4 pb-4 pt-2">
            <ChatComposer
              sessionId={sessionId}
              suggestions={suggestions}
              onSuggestion={(suggestion) => void sendMessage(suggestion)}
              questionnaire={
                question && !question.answered ? (
                  <ChatQuestionnaire
                    key={latestMessage!.id}
                    question={question}
                    disabled={chatDisabled}
                    onSubmit={(answer) => void sendMessage(answer, latestMessage!.id)}
                  />
                ) : undefined
              }
              value={input}
              onValueChange={setInput}
              onSubmit={send}
              onStop={stop}
              busy={sending || activeAgent}
              disabled={chatDisabled || !draftReady}
              canSend={Boolean(input.trim()) || attachments.length > 0 || skills.length > 0}
              placeholder="Tell the agent what to do…"
              onPasteFiles={(files) => void addFiles(files)}
              onDropFiles={(files) => void addFiles(files)}
              attachments={<PromptAttachments files={attachments} onRemove={removeAttachment} />}
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
                  <SkillsButton selected={skills} onToggle={toggleSkill} disabled={chatDisabled} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
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
                  </p>
                  <ContextDetails usage={status?.usage} model={status?.model || detail?.model} />
                  {(status?.branch || detail?.branch) && (
                    <span
                      className="flex min-w-0 max-w-28 items-center gap-1 text-xs text-muted-foreground sm:max-w-48"
                      title={status?.branch || detail?.branch}
                    >
                      <IconGitBranch className="size-3.5 shrink-0" />
                      <span className="truncate">{status?.branch || detail?.branch}</span>
                    </span>
                  )}
                </>
              }
            />
          </div>
        </section>

        <SessionPanel
          sessionId={sessionId}
          sandboxId={status?.sandboxId || detail?.sandboxId || ""}
          sandboxReady={ready}
          defaultTitle={detail?.title || ""}
          prefs={prefs}
          onPrefs={setPrefs}
          sessionInfo={
            <SessionInfo
              sessionId={sessionId}
              detail={detail}
              status={status}
              onReconnect={() => void reconnect()}
              onKill={() => void kill()}
              reconnecting={reconnecting}
              killing={killing}
              onDelete={() => void removeSession()}
              deleting={deleting}
            />
          }
          onReconnect={() => void reconnect()}
          onCommitted={() => void refresh(sessionId, false)}
          defaultPort={status?.devPort}
        />
      </div>
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
