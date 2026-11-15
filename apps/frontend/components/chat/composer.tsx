"use client";

import { FormEvent, ReactNode } from "react";
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
}) {
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
            value={value}
            disabled={disabled}
            onChange={(event) => onValueChange(event.target.value)}
            onPaste={(event) => {
              if (onPasteFiles && event.clipboardData.files.length > 0)
                onPasteFiles(event.clipboardData.files);
            }}
            onKeyDown={(event) => {
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
