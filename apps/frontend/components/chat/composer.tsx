"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowUp, LoaderCircle, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

const MAX_HEIGHT = 200;

export function Composer({
  busy,
  disabled,
  onSend,
  onStop,
  autoFocus = true,
  placeholder = "Ask OpenDevin to investigate, build, or fix…",
}: {
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  /** Omit when the work in flight cannot be cancelled. */
  onStop?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  // Grow with the content, then scroll.
  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  // The composer is the primary control, so it takes focus on mount.
  useEffect(() => {
    if (autoFocus && !disabled) field.current?.focus();
  }, [autoFocus, disabled]);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || busy || disabled) return;
    setValue("");
    onSend(text);
  }, [busy, disabled, onSend, value]);

  const ready = value.trim().length > 0;

  return (
    <div className={cn("shrink-0 px-3 pb-3 sm:px-4 sm:pb-4", disabled && "opacity-60")}>
      <div className="mx-auto max-w-2xl">
        <div
          className={cn(
            "raised rounded-xl border bg-surface-2 transition-all duration-150",
            focused ? "border-border-strong shadow-sm" : "border-border hover:border-border-strong",
            disabled && "pointer-events-none",
          )}
        >
          <textarea
            ref={field}
            value={value}
            rows={1}
            disabled={disabled}
            aria-label="Message"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            className="block max-h-[200px] w-full resize-none bg-transparent px-3 pt-3 pb-1 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <p className="hidden min-w-0 truncate pl-1 text-[11px] text-muted-foreground/60 sm:block">
              <Kbd>↵</Kbd> send · <Kbd>⇧↵</Kbd> new line
            </p>
            <span className="pl-1 text-[11px] text-muted-foreground/60 sm:hidden">
              {value.length > 0 ? `${value.length} chars` : ""}
            </span>
            {busy ? (
              <Button
                size="icon-sm"
                variant="secondary"
                disabled={!onStop}
                aria-label={onStop ? "Stop the agent" : "Working"}
                onClick={onStop}
                className="shrink-0"
              >
                {onStop ? <Square className="size-2.5 fill-current" /> : <LoaderCircle className="animate-spin" />}
              </Button>
            ) : (
              <Button
                size="icon-sm"
                aria-label="Send message"
                disabled={!ready || disabled}
                onClick={submit}
                className="shrink-0 disabled:opacity-40"
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
