"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { MessageCircle, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, API } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";

type BotMessage = { id: string; role: "user" | "assistant"; content: string };
type BotState = {
  id: string;
  status: string;
  sandboxStatus: string;
  lastError: string | null;
  messages: BotMessage[];
};

export default function BotPage() {
  const [bot, setBot] = useState<BotState | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
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

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending) return;
    setInput("");
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    setBot((current) =>
      current
        ? {
            ...current,
            messages: [
              ...current.messages,
              { id: `local-${Date.now()}`, role: "user", content: message },
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
        body: JSON.stringify({ message }),
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
      await refresh();
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

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-muted">
            <MessageCircle className="size-4" />
          </span>
          <div>
            <h1 className="text-sm font-semibold">Bot</h1>
            <p className="text-[11px] text-muted-foreground">Your personal OpenDevin assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {sending && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Stop Bot"
              onClick={() => void stop()}
            >
              <Square className="size-4" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Delete Bot history"
            onClick={() => void clearHistory()}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
          {bot?.messages.map((message) => (
            <div
              key={message.id}
              className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={
                  message.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground"
                    : "max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-4 py-2.5 text-sm leading-6"
                }
              >
                {message.role === "assistant" ? (
                  message.content ? (
                    <Markdown>{message.content}</Markdown>
                  ) : (
                    <span className="text-muted-foreground">Working…</span>
                  )
                ) : (
                  <span className="whitespace-pre-wrap">{message.content}</span>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
      <form
        onSubmit={(event) => void send(event)}
        className="mx-auto mb-4 flex w-[calc(100%-2rem)] max-w-2xl items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm"
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={1}
          placeholder="Message Bot"
          aria-label="Message Bot"
          className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="sm" disabled={sending || !input.trim()}>
          Send
        </Button>
      </form>
    </main>
  );
}
