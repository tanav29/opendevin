"use client";

import { useState, type ReactNode } from "react";
import {
  Bot,
  ChevronRight,
  FilePlus,
  FileText,
  Globe,
  KeyRound,
  ListChecks,
  PencilLine,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { describeTool, toolBaseName, type ChipTone, type ToolKind } from "@/lib/tools";
import { cn } from "@/lib/utils";

import type { EveDynamicToolPart } from "eve/react";

const ICONS: Record<ToolKind, LucideIcon> = {
  shell: Terminal,
  read: FileText,
  write: FilePlus,
  edit: PencilLine,
  search: Search,
  web: Globe,
  plan: ListChecks,
  ask: KeyRound,
  agent: Bot,
  skill: Sparkles,
  task: ListChecks,
  done: Sparkles,
  generic: Wrench,
};

const CHIP: Record<ChipTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  brand: "text-brand",
};

/* -------------------------------------------------------------------------- */
/* Detail bodies                                                              */
/* -------------------------------------------------------------------------- */

function Pane({
  label,
  children,
  tone,
}: {
  label: string;
  children: ReactNode;
  tone?: "danger";
}) {
  return (
    <div className="min-w-0">
      <p className={cn("eyebrow mb-1", tone === "danger" && "text-danger")}>
        {label}
      </p>
      {children}
    </div>
  );
}

function Block({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        "max-h-64 overflow-auto rounded-md border bg-surface-1 px-2 py-1.5 font-mono text-[11.5px] leading-[1.65] whitespace-pre-wrap break-words",
        className,
      )}
    >
      {children}
    </pre>
  );
}

function field(source: unknown, key: string): unknown {
  return source && typeof source === "object"
    ? (source as Record<string, unknown>)[key]
    : undefined;
}

function str(source: unknown, key: string) {
  const value = field(source, key);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function json(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const TODO_MARK = {
  completed: "text-success line-through decoration-success/40",
  in_progress: "text-foreground",
  pending: "text-muted-foreground",
  cancelled: "text-muted-foreground line-through",
} as const;

/** The plan the agent is working to — a checklist reads far better than JSON. */
function TodoList({ input }: { input: unknown }) {
  const todos = field(input, "todos");
  if (!Array.isArray(todos)) return null;
  return (
    <ol className="space-y-1">
      {todos.map((todo, index) => {
        const status = String(field(todo, "status") ?? "pending");
        const content = String(field(todo, "content") ?? "");
        const done = status === "completed";
        return (
          <li
            key={`${index}-${content}`}
            className="flex items-baseline gap-2 text-[12.5px] leading-snug"
          >
            <span
              aria-hidden
              className={cn(
                "mt-[1px] font-mono text-[10px]",
                status === "in_progress" ? "text-brand" : "text-muted-foreground",
              )}
            >
              {done ? "✓" : status === "in_progress" ? "▸" : "·"}
            </span>
            <span
              className={cn(
                TODO_MARK[status as keyof typeof TODO_MARK] ??
                  TODO_MARK.pending,
              )}
            >
              {content}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Terminal transcript: the command, then whatever it printed. */
function ShellDetail({ part }: { part: EveDynamicToolPart }) {
  const command = str(part.input, "command");
  const stdout = str(part.output, "stdout");
  const stderr = str(part.output, "stderr");
  const failed = part.state === "output-error";
  return (
    <div className="space-y-2">
      {command && (
        <Block className="text-foreground">
          <span className="mr-1.5 text-muted-foreground select-none">$</span>
          {command}
        </Block>
      )}
      {stdout && <Pane label="stdout"><Block>{stdout}</Block></Pane>}
      {stderr && (
        <Pane label="stderr" tone="danger">
          <Block className="text-danger">{stderr}</Block>
        </Pane>
      )}
      {failed && part.errorText && (
        <Pane label="error" tone="danger">
          <Block className="text-danger">{part.errorText}</Block>
        </Pane>
      )}
      {!command && !stdout && !stderr && !part.errorText && (
        <p className="text-xs text-muted-foreground">No output.</p>
      )}
    </div>
  );
}

function ToolDetail({ part }: { part: EveDynamicToolPart }) {
  const base = toolBaseName(part.toolName);

  if (base === "bash") return <ShellDetail part={part} />;
  if (base === "todo") return <TodoList input={part.input} />;

  if (part.state === "output-error" && part.errorText) {
    return (
      <Pane label="error" tone="danger">
        <Block className="text-danger">{part.errorText}</Block>
      </Pane>
    );
  }

  // Tools whose result is already a formatted string: read_file, grep, glob.
  const content = str(part.output, "content");
  if (content) {
    return (
      <Pane label={base === "write_file" ? "wrote" : "result"}>
        <Block>{content}</Block>
      </Pane>
    );
  }
  if (base === "write_file") {
    const written = str(part.input, "content");
    if (written)
      return (
        <Pane label="wrote">
          <Block>{written}</Block>
        </Pane>
      );
  }

  const input = json(part.input);
  const output = json(part.output);
  return (
    <div className="space-y-2">
      {input && <Pane label="input"><Block>{input}</Block></Pane>}
      {output && <Pane label="result"><Block>{output}</Block></Pane>}
      {!input && !output && (
        <p className="text-xs text-muted-foreground">Nothing recorded.</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Spine                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One action, on one line. Expands in place to the full input and output —
 * the sequence stays readable while any single step can be inspected.
 */
export function ActivityNode({ part }: { part: EveDynamicToolPart }) {
  const [open, setOpen] = useState(false);
  const tool = describeTool(part);
  const Icon = ICONS[tool.kind];
  const active = tool.running || tool.waiting;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="relative">
      <CollapsibleTrigger
        className={cn(
          "group/node flex w-full items-center gap-2 rounded-md py-[3px] pr-1.5 pl-1 text-left transition-colors duration-100 hover:bg-surface-3/60",
        )}
      >
        {/* Marker sits on the rail; its background masks the line behind it. */}
        <span
          aria-hidden
          className={cn(
            "relative z-10 grid size-4 shrink-0 place-items-center rounded-full bg-background",
            active && "animate-halo",
          )}
        >
          <Icon
            className={cn(
              "size-3 transition-colors duration-100",
              tool.failed
                ? "text-danger"
                : tool.denied
                  ? "text-warning"
                  : active
                    ? "text-brand"
                    : "text-muted-foreground group-hover/node:text-foreground",
            )}
          />
        </span>

        <span
          className={cn(
            "shrink-0 text-[12.5px] leading-5",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {tool.verb}
        </span>

        {tool.subject && (
          <span className="mono min-w-0 flex-1 truncate text-[12px] leading-5 text-foreground/85">
            {tool.subject}
          </span>
        )}
        {!tool.subject && <span className="flex-1" />}

        {tool.chip && (
          <span
            data-numeric
            className={cn(
              "mono shrink-0 text-[11px] tabular-nums",
              CHIP[tool.chip.tone],
            )}
          >
            {tool.chip.text}
          </span>
        )}

        <ChevronRight
          aria-hidden
          className="size-3 shrink-0 text-muted-foreground/70 transition-transform duration-150 group-data-[panel-open]/node:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="pt-1.5 pr-1 pb-2.5 pl-6">
          <ToolDetail part={part} />
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/**
 * The vertical rail the agent's actions hang off. The agent's work genuinely
 * is an ordered sequence, so a timeline encodes something true about it.
 */
export function ActivitySpine({
  live,
  children,
}: {
  live: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-live={live || undefined}
      className={cn(
        "relative my-1",
        // The rail: a hairline behind the markers, animated while live.
        "before:absolute before:top-3 before:bottom-3 before:left-[9px] before:w-px before:bg-border before:content-['']",
        live &&
          "before:animate-crawl before:bg-[length:1px_12px] before:bg-repeat-y before:bg-[linear-gradient(to_bottom,var(--brand)_0_6px,transparent_6px_12px)]",
      )}
    >
      {children}
    </div>
  );
}
