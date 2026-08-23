"use client";

import { isValidElement, memo, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

/** Pulls the raw source and language out of react-markdown's `<pre><code>`. */
function readCodeBlock(children: ReactNode) {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) {
    return { code: String(children ?? ""), language: undefined };
  }
  const className = children.props.className ?? "";
  const language = /language-([\w+-]+)/.exec(className)?.[1];
  const code = String(children.props.children ?? "").replace(/\n$/, "");
  return { code, language };
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy code"}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }}
      className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color,background-color] duration-100 hover:bg-surface-4 hover:text-foreground focus-visible:opacity-100 group-hover/code:opacity-100"
    >
      {copied ? (
        <Check className="size-3 text-success" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  );
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const { code, language } = readCodeBlock(children);
  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border bg-surface-1">
      <div className="flex h-8 items-center gap-2 border-b border-border/60 pr-1 pl-2.5">
        <span className="eyebrow flex-1 truncate">{language ?? "text"}</span>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[12px] leading-[1.7]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const COMPONENTS = {
  pre: CodeBlock,
  code: ({ className, ...props }: React.ComponentProps<"code">) => (
    <code
      className={cn(
        "rounded-[4px] border border-border/70 bg-surface-1 px-1 py-px font-mono text-[0.9em]",
        className,
      )}
      {...props}
    />
  ),
  a: ({ className, ...props }: React.ComponentProps<"a">) => (
    <a
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "text-brand underline decoration-brand/30 underline-offset-2 transition-colors hover:decoration-brand",
        className,
      )}
      {...props}
    />
  ),
} as const;

/**
 * Assistant prose. Memoized on `text` because a streaming turn re-renders the
 * whole message list on every chunk.
 */
export const Prose = memo(function Prose({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={cn("typeset typeset-chat", className)}>
      <Markdown components={COMPONENTS}>{text}</Markdown>
    </div>
  );
});
