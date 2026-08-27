"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowDown, Hammer, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Composer } from "@/components/chat/composer";
import { Message } from "@/components/chat/message";
import { Button } from "@/components/ui/button";
import type { Project, Session } from "@/components/providers";
import { repoName } from "@/lib/format";
import { api } from "@convex/_generated/api";

function loadChat(sessionId: string): UIMessage[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(`opendevin:chat:${sessionId}`) ?? "null");
    if (Array.isArray(stored)) return stored as UIMessage[];
    return [];
  } catch {
    return [];
  }
}

/** How close to the bottom still counts as "following along". */
const PINNED_SLACK = 80;

export function Chat({ session, project }: { session: Session; project?: Project }) {
  const update = useMutation(api.sessions.update);
  const initialMessages = useMemo(() => {
    try {
      const saved = loadChat(session.id);
      if (saved.length) return saved;
      const persisted = JSON.parse(session.parts ?? "[]");
      return Array.isArray(persisted) ? persisted as UIMessage[] : [];
    } catch { return []; }
  }, [session.id, session.parts]);
  const [responding, setResponding] = useState(false);
  const initialPromptStarted = useRef(false);

  // Debounce status writes — avoid spamming Convex on every status tick.
  const pendingStatus = useRef<string | null>(null);
  const statusTimer = useRef<number | null>(null);
  const flushStatus = useCallback(
    (status: string) => {
      pendingStatus.current = status;
      if (statusTimer.current) window.clearTimeout(statusTimer.current);
      statusTimer.current = window.setTimeout(() => {
        const next = pendingStatus.current;
        pendingStatus.current = null;
        if (next && next !== session.status) {
          void update({ id: session.id as never, status: next }).catch(() => {});
        }
      }, 400);
    },
    [session.id, session.status, update],
  );

  const agent = useChat({
    id: session.id,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/chat", body: { sessionId: session.id, git: session.git, baseBranch: session.baseBranch, envVars: project?.envVars, devCommand: project?.devCommand, buildCommand: project?.buildCommand } }),
    onFinish({ messages }) {
      try { window.localStorage.setItem(`opendevin:chat:${session.id}`, JSON.stringify(messages)); } catch { /* best effort */ }
      void fetch(`/api/chat/diff?sessionId=${encodeURIComponent(session.id)}`)
        .then((response) => response.json() as Promise<{ diff?: string }>)
        .then(({ diff }) => update({ id: session.id as never, parts: JSON.stringify(messages), status: "idle", diff, title: messages.find((m) => m.role === "user")?.parts.find((p) => p.type === "text")?.text?.slice(0, 80) }))
        .catch(() => {});
    },
  });

  const messages = agent.messages;
  const working = agent.status === "submitted" || agent.status === "streaming";
  const busy = working || session.status === "running";
  const lastId = messages.at(-1)?.id;

  useEffect(() => {
    if (agent.error?.message) toast.error(agent.error.message);
  }, [agent.error?.message]);

  useEffect(() => {
    if (agent.status === "submitted" || agent.status === "streaming") flushStatus("running");
    else if (agent.status === "error") flushStatus("failed");
    else if (agent.status === "ready" && session.status === "running") flushStatus("idle");
  }, [agent.status, session.status, flushStatus]);

  /* -- Scrolling: follow the stream, but never yank a reading user down. -- */
  const viewport = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const onScroll = useCallback(() => {
    const node = viewport.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    pinned.current = distance < PINNED_SLACK;
    setShowJump(!pinned.current);
  }, []);

  useEffect(() => {
    if (pinned.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, agent.status]);

  const jumpToLatest = () => {
    pinned.current = true;
    setShowJump(false);
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  /* -- Sending -- */
  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      pinned.current = true;
      try {
        await agent.sendMessage({ text: text.trim() });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not send the message.",
        );
      }
    },
    [agent, busy],
  );

  // A prompt typed on the project page starts the session's first turn here.
  useEffect(() => {
    if (busy || initialPromptStarted.current) return;
    const initial = window.sessionStorage.getItem("opendevin:initial-prompt");
    if (!initial) return;
    initialPromptStarted.current = true;
    queueMicrotask(() => {
      void send(initial).then(() => {
        window.sessionStorage.removeItem("opendevin:initial-prompt");
      }).catch(() => {
        initialPromptStarted.current = false;
      });
    });
  }, [send, busy]);

  const stop = async () => {
    if (!working) return;
    try {
      await agent.stop();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not stop the agent.",
      );
    }
  };

  const quickRun = (kind: "dev" | "build") => {
    const command = kind === "dev" ? project?.devCommand : project?.buildCommand;
    if (!command?.trim() || busy) return;
    void send(`Run this ${kind} command exactly and show me the output: ${command.trim()}`);
  };

  const respond = useCallback(
    () => setResponding(false),
    [],
  );

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      <div
        ref={viewport}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-5 sm:px-6">
          {messages.length === 0 && <EmptyState git={session.git} onSelect={send} />}
          {messages.map((message) => (
            <Message key={message.id} message={message} streaming={working && message.id === lastId} />
          ))}
          <div ref={bottom} className="h-px" />
        </div>
      </div>

      {showJump && (
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Jump to latest"
          onClick={jumpToLatest}
          className="animate-rise overlay absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full"
        >
          <ArrowDown />
        </Button>
      )}

      <div className="flex items-center gap-1.5 bg-background px-4 sm:px-6">
        {project?.devCommand && <Button size="xs" variant="outline" disabled={busy} onClick={() => quickRun("dev")}><Play /> Dev <span className="mono hidden text-muted-foreground sm:inline">{project.devCommand}</span></Button>}
        {project?.buildCommand && <Button size="xs" variant="outline" disabled={busy} onClick={() => quickRun("build")}><Hammer /> Build <span className="mono hidden text-muted-foreground sm:inline">{project.buildCommand}</span></Button>}
      </div>
      <Composer busy={busy} onSend={(text) => void send(text)} onStop={() => void stop()} />
    </div>
  );
}

function EmptyState({ git, onSelect }: { git: string; onSelect: (text: string) => void }) {
  const suggestions = ["Give me a quick tour of this repository", "Find a small bug worth fixing", "Add tests for the most important path"];

  return (
    <div className="animate-rise rounded-xl border bg-surface-1/50 px-5 py-7 sm:px-6">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-brand-muted text-brand"><Sparkles className="size-3.5" /></span>
        <p className="eyebrow">Ready when you are</p>
      </div>
      <h2 className="mt-4 text-base font-medium tracking-[-0.025em]">What should we change?</h2>
      <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
        Describe the outcome you want in <span className="mono text-foreground">{repoName(git)}</span>. The agent reads
        the repository, makes the changes, and shows you the diff.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSelect(suggestion)}
            className="rounded-md border bg-background/60 px-2.5 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:border-brand/50 hover:bg-brand-muted hover:text-foreground"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
