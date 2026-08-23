"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, ChevronRight, CircleAlert } from "lucide-react";

import { ActivityNode, ActivitySpine } from "@/components/chat/activity";
import {
  AuthorizationCard,
  InputRequestCard,
} from "@/components/chat/approval";
import { Prose } from "@/components/chat/markdown";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { duration, plural } from "@/lib/format";
import { describeTool } from "@/lib/tools";
import { cn } from "@/lib/utils";

import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessagePart,
} from "eve/react";

type Segment =
  | { kind: "text" | "reasoning"; key: string; text: string; streaming: boolean }
  | { kind: "tools"; key: string; parts: EveDynamicToolPart[] }
  | { kind: "auth"; key: string; part: EveAuthorizationPart };

/** Groups consecutive tool calls so each run becomes one spine. */
function toSegments(parts: readonly EveMessagePart[]): Segment[] {
  const segments: Segment[] = [];
  parts.forEach((part, index) => {
    if (part.type === "dynamic-tool") {
      const last = segments.at(-1);
      if (last?.kind === "tools") {
        last.parts.push(part);
        return;
      }
      segments.push({ kind: "tools", key: `tools-${index}`, parts: [part] });
      return;
    }
    if (part.type === "authorization") {
      segments.push({ kind: "auth", key: `auth-${index}`, part });
      return;
    }
    if (part.type === "text" || part.type === "reasoning") {
      if (!part.text) return;
      segments.push({
        kind: part.type,
        key: `${part.type}-${index}`,
        text: part.text,
        streaming: part.state === "streaming",
      });
    }
    // `file` and `step-start` carry no content of their own to render.
  });
  return segments;
}

/** "read 4 files · ran 2 commands · edited 3 files" */
function summarize(parts: EveDynamicToolPart[]) {
  const tally = { read: 0, search: 0, shell: 0, write: 0, web: 0, agent: 0, other: 0 };
  for (const part of parts) {
    const { kind } = describeTool(part);
    if (kind === "read") tally.read += 1;
    else if (kind === "search") tally.search += 1;
    else if (kind === "shell") tally.shell += 1;
    else if (kind === "write" || kind === "edit") tally.write += 1;
    else if (kind === "web") tally.web += 1;
    else if (kind === "agent") tally.agent += 1;
    else if (kind !== "plan") tally.other += 1;
  }
  const phrases: string[] = [];
  if (tally.read) phrases.push(`read ${plural(tally.read, "file")}`);
  if (tally.search) phrases.push(plural(tally.search, "search", "searches"));
  if (tally.shell) phrases.push(`ran ${plural(tally.shell, "command")}`);
  if (tally.write) phrases.push(`edited ${plural(tally.write, "file")}`);
  if (tally.web) phrases.push(plural(tally.web, "lookup"));
  if (tally.agent) phrases.push(plural(tally.agent, "subagent"));
  if (!phrases.length && tally.other)
    phrases.push(plural(tally.other, "tool call"));
  return phrases.slice(0, 3).join(" · ");
}

/** The model's scratchpad — available, never in the way. */
function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <Collapsible className="my-1.5" defaultOpen={streaming}>
      <CollapsibleTrigger className="group/think flex items-center gap-1.5 rounded-md py-0.5 text-muted-foreground transition-colors duration-100 hover:text-foreground">
        <Brain className="size-3" />
        <span className={cn("text-xs", streaming && "shimmer")}>
          {streaming ? "Thinking…" : "Thought process"}
        </span>
        <ChevronRight className="size-3 transition-transform duration-150 group-data-[panel-open]/think:rotate-90" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="mt-1 border-l border-border pl-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {text}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function ToolSegment({
  parts,
  live,
  onRespond,
  responding,
}: {
  parts: EveDynamicToolPart[];
  live: boolean;
  onRespond: (response: { requestId: string; optionId?: string; text?: string }) => void;
  responding: boolean;
}) {
  return (
    <ActivitySpine live={live}>
      {parts.map((part) => {
        const request =
          part.state === "approval-requested"
            ? part.toolMetadata?.eve?.inputRequest
            : undefined;
        return (
          <div key={part.toolCallId}>
            <ActivityNode part={part} />
            {request && (
              <div className="pl-6">
                <InputRequestCard
                  request={request}
                  disabled={responding}
                  onRespond={(response) =>
                    onRespond({ requestId: request.requestId, ...response })
                  }
                />
              </div>
            )}
          </div>
        );
      })}
    </ActivitySpine>
  );
}

export function Message({
  message,
  streaming,
  onRespond,
  responding = false,
}: {
  message: EveMessage;
  streaming: boolean;
  onRespond?: (response: {
    requestId: string;
    optionId?: string;
    text?: string;
  }) => void;
  responding?: boolean;
}) {
  const segments = toSegments(message.parts);

  if (message.role === "user") {
    const text = segments
      .filter((segment) => segment.kind === "text")
      .map((segment) => (segment as { text: string }).text)
      .join("\n\n");
    return (
      <div className="animate-rise flex justify-end">
        <div
          className={cn(
            "max-w-[min(85%,32rem)] rounded-xl rounded-br-sm bg-surface-3 px-3 py-1.5 text-[13.5px] leading-relaxed whitespace-pre-wrap",
            message.metadata?.optimistic && "opacity-60",
            message.metadata?.status === "failed" &&
              "border border-danger/40 text-danger",
          )}
        >
          {text}
        </div>
      </div>
    );
  }

  return (
    <AssistantTurn
      message={message}
      segments={segments}
      streaming={streaming}
      onRespond={onRespond}
      responding={responding}
    />
  );
}

function AssistantTurn({
  message,
  segments,
  streaming,
  onRespond,
  responding,
}: {
  message: EveMessage;
  segments: Segment[];
  streaming: boolean;
  onRespond?: (response: {
    requestId: string;
    optionId?: string;
    text?: string;
  }) => void;
  responding: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const elapsed = useElapsed(streaming);

  const lastToolIndex = segments.reduce(
    (last, segment, index) => (segment.kind === "tools" ? index : last),
    -1,
  );
  const toolParts = segments.flatMap((segment) =>
    segment.kind === "tools" ? segment.parts : [],
  );
  const awaitingUser = toolParts.some(
    (part) => part.state === "approval-requested",
  );
  // Once a turn settles, the trace collapses to one line and the answer leads.
  const collapsed =
    !streaming && lastToolIndex >= 0 && !expanded && !awaitingUser;
  const visible = collapsed
    ? segments.filter(
        (segment, index) => index > lastToolIndex && segment.kind === "text",
      )
    : segments;
  const respond = onRespond ?? (() => {});

  return (
    <div className="animate-fade min-w-0">
      {collapsed && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="group/summary mb-1.5 flex w-full items-center gap-1.5 rounded-md py-0.5 text-left text-xs text-muted-foreground transition-colors duration-100 hover:text-foreground"
        >
          <span className="truncate">
            {summarize(toolParts) || "Worked"}
            {elapsed !== null && ` · ${duration(elapsed)}`}
          </span>
          <ChevronRight className="size-3 shrink-0 opacity-60 transition-transform duration-150 group-hover/summary:translate-x-0.5" />
        </button>
      )}

      {expanded && lastToolIndex >= 0 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mb-1 text-xs text-muted-foreground transition-colors duration-100 hover:text-foreground"
        >
          Hide work
        </button>
      )}

      {visible.map((segment) => {
        if (segment.kind === "tools")
          return (
            <ToolSegment
              key={segment.key}
              parts={segment.parts}
              live={streaming}
              responding={responding}
              onRespond={respond}
            />
          );
        if (segment.kind === "auth")
          return <AuthorizationCard key={segment.key} part={segment.part} />;
        if (segment.kind === "reasoning")
          return (
            <Reasoning
              key={segment.key}
              text={segment.text}
              streaming={segment.streaming}
            />
          );
        return <Prose key={segment.key} text={segment.text} />;
      })}

      {streaming && !awaitingUser && (
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          <span className="shimmer">Working…</span>
        </p>
      )}

      {message.metadata?.status === "failed" && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-danger">
          <CircleAlert className="size-3" />
          This turn failed.
        </p>
      )}
    </div>
  );
}

/**
 * Measures a turn only while we actually watch it stream — a duration we
 * never observed would be a guess, so it stays hidden instead.
 */
function useElapsed(streaming: boolean) {
  const startedAt = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!streaming) {
      if (startedAt.current !== null) {
        setElapsed(Date.now() - startedAt.current);
        startedAt.current = null;
      }
      return;
    }
    startedAt.current ??= Date.now();
    const timer = window.setInterval(() => {
      if (startedAt.current !== null) setElapsed(Date.now() - startedAt.current);
    }, 500);
    return () => window.clearInterval(timer);
  }, [streaming]);

  return elapsed;
}
