"use client";

import { getToolOrDynamicToolName, isToolOrDynamicToolUIPart, type UIMessage } from "ai";
import { ArrowUpRightIcon, GlobeIcon } from "lucide-react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import { Reasoning, Tool } from "@/components/ai-elements/activity";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import LegacyMessage, { FileCard } from "./message";

function formatValue(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export default function ChatMessageRow({
  role,
  content = "",
  parts,
  isStreaming = false,
  onAnswer,
}: {
  role: "user" | "assistant";
  content?: string;
  parts?: UIMessage["parts"];
  isStreaming?: boolean;
  onAnswer?: (text: string) => void;
}) {
  const text = parts
    ? parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
    : content;
  if (role === "user") {
    return (
      <Message align="end" aria-label="Your message">
        <MessageContent>
          <Bubble align="end" variant="muted" className="max-w-[88%] sm:max-w-[80%]">
            <BubbleContent className="whitespace-pre-wrap px-4 py-3">{text}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }

  const sources = parts?.filter((part) => part.type === "source-url") ?? [];
  const uniqueSources = [...new Map(sources.map((source) => [source.url, source])).values()];
  const hasContent =
    text || parts?.some((part) => part.type === "reasoning" || isToolOrDynamicToolUIPart(part));

  return (
    <Message aria-label="Agent message" aria-busy={isStreaming}>
      <MessageContent className="gap-3">
        {parts ? (
          parts.map((part, index) => {
            if (part.type === "text")
              return (
                <LegacyMessage
                  key={index}
                  content={part.text}
                  onAnswer={onAnswer}
                  bubble={false}
                  isStreaming={isStreaming}
                />
              );
            if (part.type === "reasoning")
              return (
                <Reasoning
                  key={index}
                  text={part.text}
                  running={isStreaming && part.state === "streaming"}
                />
              );
            if (isToolOrDynamicToolUIPart(part)) {
              return (
                <Tool
                  key={part.toolCallId}
                  name={getToolOrDynamicToolName(part)}
                  argument={formatValue(part.input)}
                  output={
                    part.state === "output-error"
                      ? part.errorText
                      : part.state === "output-available"
                        ? formatValue(part.output)
                        : undefined
                  }
                  state={
                    part.state === "output-error"
                      ? "error"
                      : part.state === "output-available"
                        ? "complete"
                        : isStreaming
                          ? "running"
                          : "interrupted"
                  }
                />
              );
            }
            if (part.type === "file") {
              return (
                <FileCard
                  key={index}
                  id={String(index)}
                  name={part.filename || "Attachment"}
                  url={part.url}
                  size={0}
                />
              );
            }
            return null;
          })
        ) : text ? (
          <LegacyMessage
            content={text}
            onAnswer={onAnswer}
            bubble={false}
            isStreaming={isStreaming}
          />
        ) : null}
        {!hasContent && isStreaming && <Reasoning running />}
        {uniqueSources.length > 0 && (
          <Trace>
            <TraceCollapsible>
              <TraceCollapsibleTrigger>
                <TraceLine>
                  <TraceIcon>
                    <GlobeIcon />
                  </TraceIcon>
                  <TraceTitle>
                    {uniqueSources.length} {uniqueSources.length === 1 ? "source" : "sources"}
                  </TraceTitle>
                </TraceLine>
              </TraceCollapsibleTrigger>
              <TraceCollapsibleContent>
                <Trace>
                  {uniqueSources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <TraceLine>
                        <TraceTitle>{source.title || source.url}</TraceTitle>
                        <TraceIcon>
                          <ArrowUpRightIcon />
                        </TraceIcon>
                        <span className="sr-only">Opens in a new tab</span>
                      </TraceLine>
                    </a>
                  ))}
                </Trace>
              </TraceCollapsibleContent>
            </TraceCollapsible>
          </Trace>
        )}
      </MessageContent>
    </Message>
  );
}
