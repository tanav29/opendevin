"use client";

import { Prose } from "@/components/chat/markdown";
import { describeTool, type ToolPartLike } from "@/lib/tools";
import { firstLine } from "@/lib/format";
import type { Session } from "@/components/providers";

type LegacyPart = {
  type?: string;
  text?: string;
} & Partial<ToolPartLike>;

type LegacyMessage = { id?: string; role: string; parts: LegacyPart[] };

/**
 * Sessions recorded before the eve runtime stored a plain UIMessage array.
 * They are read-only history, so they render as text plus a flat list of the
 * tool calls — enough to reread the session, without a live trace.
 */
export function legacyMessages(session: Session): LegacyMessage[] {
  try {
    const value = JSON.parse(session.parts ?? "[]");
    if (!Array.isArray(value)) return [];
    return (value as LegacyMessage[]).filter(
      (message) => message?.role === "user" || message?.role === "assistant",
    );
  } catch {
    // A malformed stored transcript should not blank the page.
    return [];
  }
}

const isTool = (part: LegacyPart) =>
  part.type === "dynamic-tool" || Boolean(part.type?.startsWith("tool-"));

function toolName(part: LegacyPart) {
  if (part.toolName) return part.toolName;
  return part.type?.startsWith("tool-") ? part.type.slice(5) : "tool";
}

function ToolLine({ part }: { part: LegacyPart }) {
  const { verb, subject, failed } = describeTool({
    ...part,
    toolName: toolName(part),
  });
  return (
    <p className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
      <span className="shrink-0">{verb}</span>
      {subject && (
        <span className="mono min-w-0 truncate text-[11.5px] text-foreground/70">
          {firstLine(subject, 80)}
        </span>
      )}
      {failed && <span className="shrink-0 text-danger">failed</span>}
    </p>
  );
}

export function LegacyTranscript({ session }: { session: Session }) {
  const messages = legacyMessages(session);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-5 sm:px-6">
        {messages.length === 0 && (
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">
            This session has no live agent and no saved transcript. Start a new
            session from the project page.
          </p>
        )}
        {messages.map((message, index) => {
          const text = message.parts
            .filter((part) => part.type === "text" && part.text)
            .map((part) => part.text)
            .join("\n\n");
          const tools = message.parts.filter(isTool);

          if (message.role === "user")
            return (
              <div key={message.id ?? index} className="flex justify-end">
                <div className="max-w-[min(85%,32rem)] rounded-xl rounded-br-sm bg-surface-3 px-3 py-1.5 text-[13.5px] leading-relaxed whitespace-pre-wrap">
                  {text}
                </div>
              </div>
            );

          return (
            <div key={message.id ?? index} className="min-w-0">
              {tools.length > 0 && (
                <div className="mb-2 space-y-0.5 border-l pl-2.5">
                  {tools.map((part, toolIndex) => (
                    <ToolLine key={toolIndex} part={part} />
                  ))}
                </div>
              )}
              {text && <Prose text={text} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
