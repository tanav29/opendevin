"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Attachment01Icon, Robot02Icon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import { api, ApiError, API } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import ChatComposer from "@/components/chat/composer";
import ChatMessageRow from "@/components/chat/message-row";
import ChatStatusBadges from "@/components/chat/status-badges";
import {
  MAX_MESSAGE_CHARS,
  serializeAttachments,
  useAttachments,
} from "@/components/chat/use-attachments";

type BotMessage = { id: string; role: "user" | "assistant"; content: string };
type BotState = {
  id: string;
  status: string;
  sandboxStatus: string;
  sandboxId: string;
  lastError: string | null;
  messages: BotMessage[];
};

export default function BotPage() {
  const [bot, setBot] = useState<BotState | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const { attachments, addFiles, removeAttachment, resetAttachments } = useAttachments();
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const confirm = useConfirm();

  async function refresh() {
    try {
      setBot(await api<BotState>("/api/bot"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not load Bot.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bot?.messages.length, sending]);

  async function send(text = input) {
    const message = text.trim();
    const blocks = serializeAttachments(attachments);
    const full = message ? (blocks ? `${message}\n\n${blocks}` : message) : blocks;
    if (!full || sending) return;
    if (full.length > MAX_MESSAGE_CHARS) {
      toast.error(`Message exceeds the ${MAX_MESSAGE_CHARS.toLocaleString()}-character limit.`);
      return;
    }
    setInput("");
    resetAttachments();
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    setBot((current) =>
      current
        ? {
            ...current,
            status: "running",
            lastError: null,
            messages: [
              ...current.messages,
              { id: `local-${Date.now()}`, role: "user", content: full },
              { id: "streaming", role: "assistant", content: "" },
            ],
          }
        : current,
    );
    try {
      const response = await fetch(`${API}/api/bot/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: full }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(response.status, body.error || "Bot could not respond.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setBot((current) =>
          current
            ? {
                ...current,
                messages: current.messages.map((item) =>
                  item.id === "streaming" ? { ...item, content: item.content + chunk } : item,
                ),
              }
            : current,
        );
      }
      const tail = decoder.decode();
      if (tail) {
        setBot((current) =>
          current
            ? {
                ...current,
                messages: current.messages.map((item) =>
                  item.id === "streaming" ? { ...item, content: item.content + tail } : item,
                ),
              }
            : current,
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        toast.info("Bot stopped.");
      } else {
        toast.error(error instanceof ApiError ? error.message : "Could not reach Bot.");
        setBot((current) =>
          current
            ? { ...current, messages: current.messages.filter((item) => item.id !== "streaming") }
            : current,
        );
      }
    } finally {
      abortRef.current = null;
      setSending(false);
      await refresh();
    }
  }

  async function stop() {
    abortRef.current?.abort();
    await api("/api/bot/stop", { method: "POST" }).catch(() => undefined);
  }

  async function clearHistory() {
    const ok = await confirm({
      title: "Delete Bot history?",
      description:
        "This deletes the Bot messages and its sandbox. A new empty workspace will be created when needed.",
      confirmLabel: "Delete history",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api("/api/bot", { method: "DELETE" });
      await refresh();
      toast.success("Bot history deleted.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not delete Bot history.");
    }
  }

  const sandboxStatus = bot?.sandboxStatus ?? "pending";
  const failed = bot?.status === "failed" || sandboxStatus === "error";
  const chatDisabled = sending;

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/95 px-4 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
            <HugeiconsIcon icon={Robot02Icon} size={16} strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[13px] font-medium tracking-[-0.01em]">Bot</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              Your personal OpenDevin assistant
            </p>
          </div>
        </div>
        <ChatStatusBadges sandbox={sandboxStatus} agent={bot?.status ?? "idle"} />
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Delete Bot history"
            onClick={() => void clearHistory()}
            disabled={sending}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </header>

      <div className="chat-scroll mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-y-auto px-4 pb-4 pt-8 sm:px-8">
        {failed && bot?.lastError && (
          <div className="mb-5 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
            <p className="text-sm font-medium">Bot couldn&apos;t finish that task.</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{bot.lastError}</p>
          </div>
        )}

        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-end gap-7 pb-4">
          {bot?.messages.length === 0 && (
            <div className="flex min-h-[38vh] flex-col items-center justify-center text-center">
              <div className="mb-4 flex size-10 items-center justify-center rounded-xl border bg-card shadow-sm">
                <HugeiconsIcon
                  icon={Robot02Icon}
                  size={18}
                  strokeWidth={1.8}
                  className="text-muted-foreground"
                />
              </div>
              <h2 className="text-lg font-medium tracking-tight">What can I help with?</h2>
              <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
                Ask about your sessions or give me a quick task to run in my own workspace.
              </p>
            </div>
          )}
          {bot?.messages.map((message) => (
            <ChatMessageRow
              key={message.id}
              role={message.role}
              content={message.content}
              presentation="bot"
              workingLabel=""
              onAnswer={(text) => void send(text)}
            />
          ))}
        </div>
        <div ref={bottomRef} />
      </div>
      <div className="shrink-0 border-t border-border/60 bg-background/95 px-4 pb-3 pt-3 backdrop-blur sm:px-8">
        <ChatComposer
          value={input}
          onValueChange={setInput}
          onSubmit={() => void send()}
          onStop={() => void stop()}
          busy={sending}
          disabled={chatDisabled}
          canSend={Boolean(input.trim()) || attachments.length > 0}
          placeholder="Message Bot…"
          className="sticky bottom-0 mt-3"
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
            </>
          }
        />
      </div>
    </main>
  );
}
