"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { UIMessage } from "ai";
import { ActivityNode, ActivitySpine, type AgentToolPart } from "@/components/chat/activity";
import { Prose } from "@/components/chat/markdown";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { describeTool } from "@/lib/tools";

function isTool(part: { type?: string }): part is AgentToolPart { return Boolean(part.type?.startsWith("tool-")); }
export function Message({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  if (message.role === "user") return <div className="animate-rise flex justify-end"><div className="max-w-[min(85%,32rem)] rounded-xl rounded-br-sm bg-surface-3 px-3 py-1.5 text-[13.5px] leading-relaxed whitespace-pre-wrap">{text}</div></div>;
  const toolParts = message.parts.filter(isTool) as AgentToolPart[];
  return <div className="animate-fade min-w-0">{toolParts.length > 0 && <ToolList parts={toolParts} live={streaming} />}{text && <Prose text={text} />}{streaming && <p className="mt-1.5 text-[12.5px] text-muted-foreground"><span className="shimmer">Working…</span></p>}</div>;
}
function ToolList({ parts, live }: { parts: AgentToolPart[]; live: boolean }) {
  const [expanded, setExpanded] = useState(live);
  const summary = parts.map((part) => describeTool(part).verb).join(" · ");
  return <>{!expanded && <button type="button" onClick={() => setExpanded(true)} className="group/summary mb-1.5 flex w-full items-center gap-1.5 rounded-md py-0.5 text-left text-xs text-muted-foreground hover:text-foreground"><span className="truncate">{summary || "Worked"}</span><ChevronRight className="size-3" /></button>}{expanded && <Collapsible open className="my-1"><CollapsibleTrigger className="mb-1 text-xs text-muted-foreground" onClick={() => setExpanded(false)}>Hide work</CollapsibleTrigger><CollapsiblePanel><ActivitySpine live={live}>{parts.map((part) => <ActivityNode key={part.toolCallId} part={part} />)}</ActivitySpine></CollapsiblePanel></Collapsible>}</>;
}
