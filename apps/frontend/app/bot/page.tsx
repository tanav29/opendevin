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
  }, [bot?.messages.length, bot?.messages.at(-1)?.content, sending]);

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
  const chatDisabled = sending;

  return (
    <main className="h-screen bg-background w-full overflow-clip">
      <header className="absolute top-0 left-0 right-0 z-10 flex shrink-0 items-center justify-between gap-3 bg-sidebar border-b px-3 py-2">
        <div className="flex items-center justify-center gap-2">
          <HugeiconsIcon icon={Robot02Icon} className="h-5" />
          <h1 className="text-md font-medium">Bot</h1>
        </div>
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

        <section className="flex max-w-5xl h-full gap-4 sm:mx-8 mx-4 pt-16 pb-32 flex-col bg-background overflow-y-auto scrollbar-none">
          {bot?.messages
            .filter((message) => message.id !== "streaming" || message.content)
            .map((message) => (
              <ChatMessageRow
                key={message.id}
                role={message.role}
                content={message.content}
                presentation="bot"
                workingLabel=""
                onAnswer={(text) => void send(text)}
              />
            ))}
          {sending && (
            <ChatMessageRow
              key="working"
              role="assistant"
              content=""
              presentation="bot"
              workingLabel="Bot is working"
            />
          )}
        <div ref={bottomRef} />
      </section>

      <div className="absolute bottom-0 left-0 right-0 shrink-0 sm:mx-8 mx-4 pb-4">
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
