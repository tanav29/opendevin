"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useEveAgent } from "eve/react";
import type { ClientSessionState, MessageStreamEvent } from "eve/client";
import { ArrowDown } from "lucide-react";
import { toast } from "sonner";

import { Composer } from "@/components/chat/composer";
import { Message } from "@/components/chat/message";
import { Button } from "@/components/ui/button";
import type { Session } from "@/components/providers";
import { repoName } from "@/lib/format";
import { api } from "@convex/_generated/api";

type SavedChat = {
  events: readonly MessageStreamEvent[];
  session?: ClientSessionState;
};

const storageKey = (sessionId: string) => `opendevin:eve:${sessionId}`;

function loadChat(sessionId: string): SavedChat {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(storageKey(sessionId)) ?? "null",
    ) as Partial<SavedChat> | null;
    return {
      events: Array.isArray(value?.events) ? value.events : [],
      session: value?.session,
    };
  } catch {
    return { events: [] };
  }
}

function saveChat(sessionId: string, value: SavedChat) {
  try {
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(value));
  } catch {
    // Storage may be full or blocked; the eve stream stays durable.
  }
}

/** How close to the bottom still counts as "following along". */
const PINNED_SLACK = 80;

export function Chat({ session }: { session: Session }) {
  const update = useMutation(api.sessions.update);
  const saved = useMemo(() => loadChat(session.id), [session.id]);
  const eventsRef = useRef<readonly MessageStreamEvent[]>(saved.events);
  const [responding, setResponding] = useState(false);

  const agent = useEveAgent({
    initialEvents: saved.events,
    initialSession: saved.session,
    onEvent(event) {
      eventsRef.current = [...eventsRef.current, event];
    },
    onSessionChange(next) {
      if (!next?.sessionId) return;
      saveChat(session.id, { events: eventsRef.current, session: next });
      // Link the durable eve session id to the convex row once.
      if (next.sessionId !== session.eveSessionId) {
        void update({ id: session.id as never, eveSessionId: next.sessionId });
      }
    },
    onFinish(snapshot) {
      const value = { events: snapshot.events, session: snapshot.session };
      saveChat(session.id, value);
      void update({ id: session.id as never, parts: JSON.stringify(value) });
    },
  });

  const messages = agent.data.messages;
  const working = agent.status === "submitted" || agent.status === "streaming";
  const busy = working || session.status === "running";
  const lastId = messages.at(-1)?.id;

  useEffect(() => {
    if (agent.error?.message) toast.error(agent.error.message);
  }, [agent.error?.message]);

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
        await agent.send(text.trim());
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
    if (busy) return;
    const initial = window.sessionStorage.getItem("opendevin:initial-prompt");
    if (!initial) return;
    window.sessionStorage.removeItem("opendevin:initial-prompt");
    queueMicrotask(() => void send(initial));
  }, [send, busy]);

  const stop = async () => {
    if (!working) return;
    try {
      await agent.cancel();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not stop the agent.",
      );
    }
  };

  const respond = useCallback(
    (response: { requestId: string; optionId?: string; text?: string }) => {
      setResponding(true);
      void agent
        .respond([response])
        .catch((error: unknown) =>
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not send your answer.",
          ),
        )
        .finally(() => setResponding(false));
    },
    [agent],
  );

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      <div
        ref={viewport}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-5 sm:px-6">
          {messages.length === 0 && <EmptyState git={session.git} />}
          {messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              streaming={working && message.id === lastId}
              responding={responding}
              onRespond={respond}
            />
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

      <Composer busy={busy} onSend={(text) => void send(text)} onStop={() => void stop()} />
    </div>
  );
}

function EmptyState({ git }: { git: string }) {
  return (
    <div className="animate-rise pt-10">
      <p className="eyebrow">Ready</p>
      <h2 className="mt-2 text-xl font-medium tracking-[-0.02em]">
        What should we change?
      </h2>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
        Describe the outcome you want in{" "}
        <span className="mono text-foreground">{repoName(git)}</span>. The agent
        reads the repository, makes the changes, and shows you the diff.
      </p>
    </div>
  );
}
