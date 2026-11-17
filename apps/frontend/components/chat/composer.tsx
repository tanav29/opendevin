"use client";

import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";

export default function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  busy = false,
  disabled = false,
  canSend = true,
  placeholder,
  attachments,
  skills,
  notice,
  actions,
  onPasteFiles,
  onDropFiles,
  className = "",
  questionnaire,
  suggestions = [],
  onSuggestion,
  sessionId,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy?: boolean;
  disabled?: boolean;
  canSend?: boolean;
  placeholder: string;
  attachments?: ReactNode;
  skills?: ReactNode;
  notice?: ReactNode;
  actions?: ReactNode;
  onPasteFiles?: (files: FileList) => void;
  onDropFiles?: (files: FileList) => void;
  className?: string;
  questionnaire?: ReactNode;
  suggestions?: string[];
  onSuggestion?: (suggestion: string) => void;
  sessionId?: string;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(
    null,
  );
  const [paths, setPaths] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [truncated, setTruncated] = useState(false);
  const [active, setActive] = useState(0);
  const matches = mention
    ? paths.filter((path) => path.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 20)
    : [];

  useEffect(() => {
    if (!mention || !sessionId) return;
    let cancelled = false;
    setState("loading");
    api<{ paths: string[]; truncated: boolean }>(
      `/api/sessions/${sessionId}/files`,
      undefined,
      60_000,
    )
      .then((result) => {
        if (!cancelled) {
          setPaths(result.paths);
          setTruncated(result.truncated);
          setState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, Boolean(mention)]);

  function updateMention(element: HTMLTextAreaElement) {
    const end = element.selectionStart;
    const before = element.value.slice(0, end);
    const match = /(?:^|\s)@([^@\n"\r]*)$/.exec(before);
    setMention(
      sessionId && element.selectionStart === element.selectionEnd && match
        ? { start: end - match[1].length - 1, end, query: match[1] }
        : null,
    );
  }

  function selectPath(path: string) {
    if (!mention) return;
    const inserted = `@${JSON.stringify(path)} `;
    const next = value.slice(0, mention.start) + inserted + value.slice(mention.end);
    const caret = mention.start + inserted.length;
    onValueChange(next);
    setMention(null);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(caret, caret);
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && !disabled && canSend) onSubmit();
  }

  return (
    <>
      {questionnaire && <div hidden={busy}>{questionnaire}</div>}
      <form
        hidden={Boolean(questionnaire) && !busy}
        onSubmit={submit}
        className={`mx-auto w-full max-w-3xl ${className}`}
        onDragOver={(event) => {
          if (onDropFiles) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!onDropFiles) return;
          event.preventDefault();
          if (!disabled && event.dataTransfer.files.length > 0)
            onDropFiles(event.dataTransfer.files);
        }}
      >
        {suggestions.length > 0 && !busy && (
          <div
            role="group"
            aria-label="Suggested prompts"
            className="scrollbar-none mb-3 flex scroll-fade-x gap-2 overflow-x-auto overscroll-x-contain"
          >
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={disabled || !onSuggestion}
                onClick={() => onSuggestion?.(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        )}
        {mention && (
          <div className="mb-2 rounded-lg border bg-popover p-1 text-sm shadow-md">
            {state === "loading" ? (
              <p className="px-3 py-2" role="status">
                Searching workspace?
              </p>
            ) : state === "error" ? (
              <p className="px-3 py-2" role="status">
                Workspace files unavailable.
              </p>
            ) : matches.length === 0 ? (
              <p className="px-3 py-2" role="status">
                No matching files{truncated ? " in the available file list" : ""}.
              </p>
            ) : (
              <div
                id={listId}
                role="listbox"
                aria-label="Workspace files"
                className="max-h-56 overflow-auto"
              >
                {matches.map((path, index) => (
                  <div
                    key={path}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectPath(path)}
                    className={`cursor-pointer break-all rounded px-3 py-2 ${index === active ? "bg-accent" : ""}`}
                  >
                    {path}
                  </div>
                ))}
              </div>
            )}
            {truncated && state === "ready" && (
              <p className="px-3 py-1 text-xs text-muted-foreground">File list is truncated.</p>
            )}
          </div>
        )}
        <InputGroup className="rounded-2xl bg-card dark:bg-card">
          {(attachments || skills || notice) && (
            <InputGroupAddon
              align="block-start"
              className="flex-col items-stretch p-0 text-foreground font-normal select-text"
            >
              {attachments}
              {skills}
              {notice}
            </InputGroupAddon>
          )}
          <InputGroupTextarea
            ref={textarea}
            value={value}
            aria-autocomplete={sessionId ? "list" : undefined}
            aria-controls={mention && matches.length ? listId : undefined}
            aria-activedescendant={mention && matches.length ? `${listId}-${active}` : undefined}
            onChange={(event) => {
              onValueChange(event.target.value);
              setActive(0);
              updateMention(event.currentTarget);
            }}
            onSelect={(event) => updateMention(event.currentTarget)}
            onPaste={(event) => {
              if (onPasteFiles && event.clipboardData.files.length > 0)
                onPasteFiles(event.clipboardData.files);
            }}
            onKeyDown={(event) => {
              if (mention && !event.nativeEvent.isComposing) {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMention(null);
                  return;
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (matches.length)
                    setActive(
                      (current) =>
                        (current + (event.key === "ArrowDown" ? 1 : -1) + matches.length) %
                        matches.length,
                    );
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (matches[active] && state === "ready") selectPath(matches[active]);
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!busy && !disabled && canSend) event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={1}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-h-14 max-h-48 px-4 py-3 text-sm"
          />
          <InputGroupAddon align="block-end" className="justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">{actions}</div>
            {busy ? (
              <InputGroupButton
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={(event) => {
                  event.preventDefault();
                  onStop?.();
                }}
                disabled={!onStop}
                aria-label="Stop generation"
              >
                <SquareIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                disabled={disabled || !canSend}
                aria-label="Send message"
              >
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </>
  );
}
