"use client";

import { useState } from "react";
import {
  BrainIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  LoaderCircleIcon,
  RouteIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";

// Compositions from https://ui.shadcn.com/docs/ai-elements.
export function Tool({
  name,
  argument,
  output,
  state,
}: {
  name: string;
  argument?: string;
  output?: string;
  state: "running" | "complete" | "error" | "interrupted";
}) {
  const running = state === "running";
  const failed = state === "error";
  const line = (
    <TraceLine status={running ? "running" : failed ? "error" : undefined}>
      <TraceIcon>
        {running ? (
          <LoaderCircleIcon className="motion-safe:animate-spin" />
        ) : failed ? (
          <XIcon />
        ) : name === "run_command" ? (
          <TerminalIcon />
        ) : (
          <WrenchIcon />
        )}
      </TraceIcon>
      <TraceTitle className="whitespace-normal break-words">
        {name.replaceAll("_", " ")}
        {argument ? ` · ${argument}` : ""}
      </TraceTitle>
      <TraceDescription className="text-xs">
        {running ? "Running" : failed ? "Failed" : state === "interrupted" ? "Interrupted" : "Done"}
      </TraceDescription>
    </TraceLine>
  );

  return (
    <Trace>
      {output ? (
        <TraceCollapsible defaultOpen={failed}>
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <CodeBlock size="sm" variant={failed ? "destructive" : "default"}>
              <CodeBlockContent wrap className="max-h-64">
                {output}
              </CodeBlockContent>
            </CodeBlock>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        line
      )}
    </Trace>
  );
}

export function Reasoning({ text = "", running = false }: { text?: string; running?: boolean }) {
  const [open, setOpen] = useState<boolean>();
  const line = (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>
        {running ? <LoaderCircleIcon className="motion-safe:animate-spin" /> : <BrainIcon />}
      </TraceIcon>
      <TraceTitle>{running ? "Thinking" : "Thought"}</TraceTitle>
    </TraceLine>
  );

  return (
    <Trace>
      {text ? (
        <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="whitespace-pre-wrap">{text}</TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        <div role="status">{line}</div>
      )}
    </Trace>
  );
}

export function Plan({
  tasks,
  streaming = false,
}: {
  tasks: { title: string; status: string }[];
  streaming?: boolean;
}) {
  const done = tasks.filter((task) => task.status === "done").length;
  return (
    <Trace>
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine status={streaming && done < tasks.length ? "running" : undefined}>
            <TraceIcon>
              <RouteIcon />
            </TraceIcon>
            <TraceTitle>Plan</TraceTitle>
            <TraceDescription>
              {done} of {tasks.length} done
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace role="list" aria-label="Plan steps">
            {tasks.map((task, index) => (
              <TraceLine
                key={`${index}-${task.title}`}
                role="listitem"
                status={
                  task.status === "pending"
                    ? "pending"
                    : streaming && task.status === "in_progress"
                      ? "running"
                      : undefined
                }
              >
                <TraceIcon>
                  {task.status === "done" ? (
                    <CircleCheckIcon />
                  ) : task.status === "in_progress" ? (
                    <CircleDotIcon />
                  ) : (
                    <CircleIcon />
                  )}
                </TraceIcon>
                <TraceTitle className="whitespace-normal">{task.title}</TraceTitle>
                <span className="sr-only">{task.status.replaceAll("_", " ")}</span>
              </TraceLine>
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
