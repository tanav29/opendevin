"use client";

import Message from "./message";

export default function ChatMessageRow({
  role,
  content,
  onAnswer,
  workingLabel = "Working",
}: {
  role: "user" | "assistant";
  content: string;
  onAnswer?: (text: string) => void;
  workingLabel?: string;
}) {
  if (role === "user") {
    return (
      <article className="group flex justify-end">
        <p className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-muted px-4 py-3 text-[14px] leading-6 text-foreground sm:max-w-[78%]">
          {content}
        </p>
      </article>
    );
  }
  return (
    <article className="group flex gap-3">
      <div className="min-w-0 max-w-[94%] flex-1 py-1 text-[14px] leading-6">
        {content ? (
          <Message content={content} onAnswer={onAnswer} />
        ) : (
          <div
            className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground"
            aria-label="Thinking"
          >
            <span>{workingLabel}</span>
            <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
          </div>
        )}
      </div>
    </article>
  );
}
