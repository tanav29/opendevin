"use client";

import Message from "./message";

export default function ChatMessageRow({
  role,
  content,
  onAnswer,
  workDuration,
  collapseActivity,
  workingLabel = "Working",
  presentation = "chat",
}: {
  role: "user" | "assistant";
  content: string;
  onAnswer?: (text: string) => void;
  workDuration?: number;
  collapseActivity?: boolean;
  workingLabel?: string;
  presentation?: "chat" | "bot" | "session";
}) {
    if (role === "user") {
      return (
        <article className="group flex justify-end py-1">
          <p className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-muted px-4 py-3 text-[14px] leading-6 text-foreground sm:max-w-[78%]">
            {content}
          </p>
        </article>
      );
    }
    return (
      <article className="min-w-0 text-md leading-6">
        {content ? (
          <Message
            content={content}
            onAnswer={onAnswer}
            collapseActivity={collapseActivity ?? workDuration !== undefined}
            workDuration={workDuration}
            bubble={false}
          />
        ) : (
          <div
            className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground"
            aria-label="Thinking"
          >
            <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
          </div>
        )}
      </article>
    );
}
