"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  IconArrowLeft,
  IconArrowUp,
  IconCopy,
  IconInfoCircle,
  IconPlayerStop,
  IconRefresh,
  IconTrash,
  IconTerminal,
  IconLayoutSidebarRight,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiErrorState, asApiError, isNotFoundError } from "@/components/api-error-state";
import { Badge } from "@/components/ui/badge";
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
  formatDate,
  isWorking,
  type ChatMessage,
  type SessionDetail,
  type SessionStatus,
} from "./lib";
import { PaperclipIcon } from "lucide-react";

type Attachment = { id: string; name: string; content: string };
const MAX_ATTACHMENT_COUNT = 3;
const MAX_MESSAGE_CHARS = 20_000;

function serializeAttachments(attachments: Attachment[]) {
  return attachments
    .map(
      (attachment) =>
        `<attachment name="${attachment.name}">\n${attachment.content}\n</attachment>`,
    )
    .join("\n\n");
}

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
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="hidden md:inline-flex"
                onClick={onReview}
                disabled={reconnecting}
              >
                Review patch
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="md:hidden"
                onClick={onDownload}
                disabled={reconnecting}
              >
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
  const [degraded, setDegraded] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [prefs, setPrefs] = usePanelPrefs();

  async function addFiles(files: FileList | File[]) {
    const all = Array.from(files);
    const remaining = Math.max(0, MAX_ATTACHMENT_COUNT - attachments.length);
    if (remaining === 0) {
      toast.error(`Only ${MAX_ATTACHMENT_COUNT} attachments can be added.`);
      return;
    }
    const list = all.slice(0, remaining);
    if (all.length > list.length) {
      toast.error(`Only ${MAX_ATTACHMENT_COUNT} attachments can be added.`);
    }
    let nextAttachments = [...attachments];
    for (const f of list) {
      if (f.size > 200_000) {
        toast.error(`Attachment ${f.name} too large (max 200KB).`);
        continue;
      }
      try {
        const text = await f.text();
        const next = [
          ...nextAttachments,
          { id: crypto.randomUUID(), name: f.name.slice(0, 100), content: text },
        ];
        if (serializeAttachments(next).length > MAX_MESSAGE_CHARS) {
          toast.error(
            `Attachments exceed the ${MAX_MESSAGE_CHARS.toLocaleString()}-character message limit.`,
          );
          continue;
        }
        nextAttachments = next;
        setAttachments(nextAttachments);
      } catch {
        toast.error(`Could not read ${f.name}.`);
      }
    }
  }
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
  const verification = lifecycle?.verification ?? "pending";
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
    if ((!trimmed && attachments.length === 0) || !sessionId || sending || agentBusy || !ready)
      return;
    const blocks = serializeAttachments(attachments);
    const full = trimmed ? (blocks ? `${trimmed}\n\n${blocks}` : trimmed) : blocks;
    if (full.length > MAX_MESSAGE_CHARS) {
      toast.error(`Message exceeds the ${MAX_MESSAGE_CHARS.toLocaleString()}-character limit.`);
      return;
    }
    setInput("");
    setAttachments([]);
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
        let message = "The agent couldn't respond. Please try again.";
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {}
        toast.error(message);
        // Server is the source of truth: drop the optimistic local messages
        // (the server may have persisted nothing, e.g. 409 already-running)
        // and re-sync from the DB instead of leaving ghosts behind.
        setMessages((current) =>
          current.filter(
            (message) => message.id !== "streaming" && !message.id.startsWith("local-"),
          ),
        );
        await refresh(sessionId, true);
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
        toast.info("Stopped. The server run was cancelled.");
      } else {
        toast.error("Couldn't reach the agent. Check your connection and try again.");
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
    if (lastUser && !sending && !activeAgent) void sendMessage(lastUser.content);
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

  async function send(event: FormEvent) {
    event.preventDefault();
    await sendMessage(input);
  }

  const provisioning = PROVISIONING_SANDBOX.has(provisioningPhase);
  const workspaceUnavailable =
    provisioningPhase === "error" ||
    provisioningPhase === "unavailable" ||
    (sandboxStatus === "ready" && status?.sandboxAvailable === false);
  const agentFailed = agentStatus === "failed" || agentStatus === "interrupted";
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
    <>
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
        onDownload={() => {
          setReconnectConflict(null);
          void downloadRecoveryPatch();
        }}
        onConfirm={() => void reconnect(true)}
      />
      <main className="flex h-screen flex-col bg-background">
        <header className="z-10 flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/95 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger className="md:hidden" />
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
                  <h1 className="max-w-[min(42vw,24rem)] truncate text-[13px] font-medium tracking-[-0.01em]">
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
          <div className="hidden items-center gap-1.5 lg:flex" aria-live="polite">
            <Badge variant="outline">Sandbox: {provisioningPhase.replace("-", " ")}</Badge>
            <Badge variant="outline">Agent: {agentStatus}</Badge>
            <Badge variant="outline">Result: {verification}</Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
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

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="chat-scroll mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-y-auto px-4 pb-4 pt-8 sm:px-8">
              {Boolean(loadError) && detail && (
                <ApiErrorState
                  error={loadError}
                  title="Some session data could not be refreshed"
                  description="The last known state is shown. Retry to check the API again."
                  onRetry={() => void refresh(sessionId, true, true)}
                  compact
                  className="mb-5"
                />
              )}
              {provisioning && (
                <div className="mb-5 flex items-center gap-2.5 rounded-lg border bg-card px-3 py-3 text-sm text-muted-foreground">
                  <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                  {provisioningPhase === "setting-up"
                    ? "Setting up the workspace… the agent starts when setup completes."
                    : "Spinning up sandbox and cloning repo… the agent gets full workspace access once ready."}
                </div>
              )}
              {degraded && !workspaceUnavailable && (
                <div className="mb-5 rounded-lg border border-warning/40 bg-warning-muted/40 px-3 py-2.5 text-sm">
                  Sandbox unreachable — this answer is from general knowledge. Reconnect for
                  workspace tools.
                </div>
              )}
              {workspaceUnavailable && (
                <div className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {provisioningPhase === "error"
                        ? "Workspace setup failed"
                        : "Workspace unavailable"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {status?.lastError || "Reconnect the sandbox to continue."}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void reconnect()}
                    disabled={reconnecting}
                  >
                    <IconRefresh className="size-4" />{" "}
                    {reconnecting ? "Reconnecting…" : "Reconnect"}
                  </Button>
                </div>
              )}
              {agentFailed && !sending && (
                <div className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">The agent couldn’t finish that task.</p>
                    {status?.lastError && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{status.lastError}</p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={retry}>
                    <IconRefresh className="size-4" /> Try again
                  </Button>
                </div>
              )}

              <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-end gap-7 pb-4">
                {messages.length === 0 && (
                  <div className="flex min-h-[38vh] flex-col items-center justify-center text-center">
                    <div className="mb-4 flex size-10 items-center justify-center rounded-xl border bg-card shadow-sm">
                      <IconTerminal className="size-[18px] text-muted-foreground" />
                    </div>
                    <h2 className="text-lg font-medium tracking-tight">What should we work on?</h2>
                    <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
                      Ask the agent to explore this workspace, make a change, or run a command.
                    </p>
                  </div>
                )}
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={
                      message.role === "user" ? "group flex justify-end" : "group flex gap-3"
                    }
                  >
                    {message.role === "user" ? (
                      <p className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-muted px-4 py-3 text-[14px] leading-6 text-foreground sm:max-w-[78%]">
                        {message.content}
                      </p>
                    ) : message.content ? (
                      <>
                        <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg border bg-card text-[11px] font-semibold shadow-sm">
                          A
                        </div>
                        <div className="min-w-0 max-w-[94%] flex-1 py-1 text-[14px] leading-6">
                          <div className="mb-1 text-xs font-medium text-muted-foreground">
                            Agent
                          </div>
                          <Message
                            content={message.content}
                            onAnswer={(text) => void sendMessage(text)}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-3 py-1" aria-label="Thinking">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-card text-[11px] font-semibold shadow-sm">
                          A
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>Working</span>
                          <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground" />
                          <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
                          <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <div ref={bottomRef} />

              <form
                onSubmit={(e) => void send(e)}
                className={`sticky bottom-0 mx-auto mt-3 w-full max-w-3xl rounded-2xl border border-border bg-card shadow-[0_8px_30px_rgba(0,0,0,0.07)] transition-shadow focus-within:border-ring focus-within:shadow-[0_10px_36px_rgba(0,0,0,0.11)] ${!ready ? "opacity-60" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (ready && e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
                }}
              >
                <div className="">
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-3 pt-2">
                      {attachments.map((a) => (
                        <span
                          key={a.id}
                          className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[11px]"
                        >
                          {a.name} · {(a.content.length / 1024).toFixed(1)}KB
                          <button
                            type="button"
                            onClick={() =>
                              setAttachments((cur) => cur.filter((x) => x.id !== a.id))
                            }
                            className="text-muted-foreground hover:text-foreground"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {(activeAgent || agentQueued) && !sending && (
                    <p className="px-4 pt-3 text-xs text-muted-foreground" role="status">
                      {agentQueued
                        ? "The agent is preparing this task. It will be ready for a new message shortly."
                        : "An agent turn is running, possibly in another tab. Stop it before sending a new message."}
                    </p>
                  )}
                  <textarea
                    value={input}
                    disabled={chatDisabled}
                    onChange={(e) => setInput(e.target.value)}
                    onPaste={(e) => {
                      if (e.clipboardData.files.length > 0) void addFiles(e.clipboardData.files);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (sending || activeAgent) stop();
                        else if (!agentQueued) void send(e as unknown as FormEvent);
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
                        disabled={chatDisabled}
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
                        disabled={chatDisabled}
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
                    {sending || activeAgent ? (
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
                        disabled={chatDisabled || (!input.trim() && attachments.length === 0)}
                        className="gap-1.5 rounded-xl px-3"
                        aria-label="Send message"
                      >
                        <IconArrowUp className="size-4" />
                        <span className="hidden sm:inline">Send</span>
                      </Button>
                    )}
                  </div>
                </div>
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
              onCommitted={() => void refresh(sessionId, false)}
              defaultPort={status?.devPort}
            />
          )}
        </div>
      </main>
    </>
  );
}
