"use client";

import { FormEvent, ReactNode, useEffect, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, StopIcon } from "@hugeicons/core-free-icons";
import { Button } from "../ui/button";

// Shared composer shell for Bot and session chats, so both keep the same input,
// send/stop controls, drag-and-drop, and height behavior.
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
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Autogrow instead of a fixed 3-row box.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form
      onSubmit={submit}
      className={`mx-auto w-full max-w-3xl rounded-[2rem] backdrop-blur-xl squircle border border-border bg-card/39 ${className}`}
      onDragOver={(event) => {
        if (onDropFiles) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!onDropFiles) return;
        event.preventDefault();
        if (!disabled && event.dataTransfer.files.length > 0) onDropFiles(event.dataTransfer.files);
      }}
    >
      {attachments}
      {skills}
      {notice}
      <textarea
        ref={textareaRef}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        onPaste={(event) => {
          if (onPasteFiles && event.clipboardData.files.length > 0)
            onPasteFiles(event.clipboardData.files);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (busy) onStop?.();
            else if (!disabled) onSubmit();
          }
        }}
        rows={1}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-h-14 w-full resize-none rounded-2xl scrollbar-none border-0 bg-transparent px-4 py-3 text-md outline-none placeholder:text-muted-foreground focus-visible:ring-0"
      />
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <div className="flex items-center gap-1.5">{actions}</div>
        {busy ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onStop}
            aria-label="Stop generation"
          >
            <HugeiconsIcon icon={StopIcon} />
          </Button>
        ) : (
          <Button
            type="submit"
            variant="default"
            size="icon"
            disabled={disabled || !canSend}
            aria-label="Send message"
          >
            <HugeiconsIcon icon={ArrowUp01Icon} />
          </Button>
        )}
      </div>
    </form>
  );
}
