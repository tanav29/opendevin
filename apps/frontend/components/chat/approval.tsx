"use client";

import { useState } from "react";
import { ExternalLink, KeyRound, MessageCircleQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type {
  EveAuthorizationPart,
  EveMessageInputRequest,
} from "eve/react";

/** Cards that block the turn share a frame, so "you're needed" reads at a glance. */
function Prompt({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof KeyRound;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-rise my-2 overflow-hidden rounded-lg border border-brand/25 bg-brand-muted/40">
      <div className="flex items-center gap-1.5 border-b border-brand/20 px-2.5 py-1.5">
        <Icon className="size-3 text-brand" />
        <span className="eyebrow text-brand">{label}</span>
      </div>
      <div className="p-2.5">{children}</div>
    </div>
  );
}

/**
 * A pending HITL request. Without this the agent waits forever, so every
 * branch here has to be able to send an answer.
 */
export function InputRequestCard({
  request,
  onRespond,
  disabled,
}: {
  request: EveMessageInputRequest;
  onRespond: (response: { optionId?: string; text?: string }) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const options = request.options ?? [];
  const freeform = request.display === "text" || request.allowFreeform;

  return (
    <Prompt icon={MessageCircleQuestion} label="Needs your answer">
      <p className="text-[13px] leading-relaxed text-foreground">
        {request.prompt}
      </p>

      {options.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {options.map((option) => (
            <Button
              key={option.id}
              size="sm"
              disabled={disabled}
              variant={
                option.style === "danger"
                  ? "destructive"
                  : option.style === "primary"
                    ? "default"
                    : "outline"
              }
              title={option.description}
              onClick={() => onRespond({ optionId: option.id })}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}

      {freeform && (
        <form
          className="mt-2 flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!text.trim()) return;
            onRespond({ text: text.trim() });
            setText("");
          }}
        >
          <Input
            value={text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            placeholder="Type your answer…"
            className="h-7 text-[13px]"
          />
          <Button type="submit" size="sm" disabled={disabled || !text.trim()}>
            Send
          </Button>
        </form>
      )}
    </Prompt>
  );
}

/** A sign-in challenge the agent raised — the user completes it out of band. */
export function AuthorizationCard({ part }: { part: EveAuthorizationPart }) {
  if (part.state === "completed") {
    const ok = part.outcome === "authorized";
    return (
      <p
        className={cn(
          "my-1.5 flex items-center gap-1.5 text-xs",
          ok ? "text-success" : "text-muted-foreground",
        )}
      >
        <KeyRound className="size-3" />
        {ok
          ? `Connected ${part.displayName}`
          : `${part.displayName} not connected${part.reason ? ` — ${part.reason}` : ""}`}
      </p>
    );
  }

  const challenge = part.authorization;
  return (
    <Prompt icon={KeyRound} label="Sign-in required">
      <p className="text-[13px] leading-relaxed text-foreground">
        {part.description || `Connect ${part.displayName} to continue.`}
      </p>
      {challenge?.instructions && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {challenge.instructions}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {challenge?.url && (
          <Button
            size="sm"
            nativeButton={false}
            render={
              <a href={challenge.url} target="_blank" rel="noreferrer noopener" />
            }
          >
            Open {part.displayName}
            <ExternalLink />
          </Button>
        )}
        {challenge?.userCode && (
          <span className="mono rounded-md border bg-surface-1 px-2 py-1 text-[12px] tracking-[0.12em] select-all">
            {challenge.userCode}
          </span>
        )}
      </div>
    </Prompt>
  );
}
