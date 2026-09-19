"use client";

import { memo } from "react";
import Markdown from 'react-markdown';

function ToolCallCard({
  name,
  argument,
  status,
  id,
}: {
  name: string;
  argument: string;
  status: "working" | "done" | "failed";
  id: string;
}) {
  const statusStyles = {
    working: "text-warning",
    done: "text-success",
    failed: "text-destructive",
  } as const;
  const statusIcon = status === "working" ? "◌" : status === "done" ? "✓" : "×";
  return (
    <div
      key={id}
      className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-muted/35 px-2.5 py-1.5 font-mono text-[11px]"
    >
      <span
        className={`flex size-4 shrink-0 items-center justify-center rounded-full bg-background font-sans text-[10px] ${statusStyles[status]}`}
        aria-label={status}
      >
        {statusIcon}
      </span>
      <span className="shrink-0 capitalize text-muted-foreground">{status}</span>
      <span className="shrink-0 font-medium text-foreground">{name}</span>
      {argument && <span className="truncate text-muted-foreground">{argument}</span>}
    </div>
  );
}

function QuestionCard({
  question,
  options,
  onAnswer,
  id,
}: {
  question: string;
  options: string[];
  onAnswer?: (text: string) => void;
  id: string;
}) {
  return (
    <div key={id} className="rounded-xl border border-warning/40 bg-warning-muted/40 p-3.5">
      <p className="text-[13px] font-medium leading-5">{question}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={!onAnswer}
            onClick={() => onAnswer?.(opt)}
            className="rounded-md border border-border bg-card px-2.5 py-1 text-[12px] hover:bg-muted disabled:cursor-default disabled:opacity-60"
          >
            {opt}
          </button>
        ))}
      </div>
      {!onAnswer && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Reply with your choice to continue.
        </p>
      )}
    </div>
  );
}

function PlanCard({ tasks, id }: { tasks: { title: string; status: string }[]; id: string }) {
  return (
    <div key={id} className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Plan · {tasks.filter((t) => t.status === "done").length}/{tasks.length}
      </p>
      <ul className="mt-2 space-y-1.5">
        {tasks.map((t, i) => (
          <li key={`${i}-${t.title}`} className="flex items-start gap-2 text-[13px]">
            <span
              className={
                t.status === "done"
                  ? "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-success text-[10px] text-white"
                  : t.status === "in_progress"
                    ? "mt-0.5 size-4 shrink-0 animate-pulse rounded-full border-2 border-warning border-t-transparent"
                    : "mt-0.5 size-4 shrink-0 rounded-full border border-border"
              }
            >
              {t.status === "done" ? "✓" : ""}
            </span>
            <span className={t.status === "done" ? "text-muted-foreground line-through" : ""}>
              {t.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function parseQuestion(line: string): { question: string; options: string[] } | null {
  const m = line.match(/<div data-question='(.*)'>/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1].replace(/&#39;/g, "'")) as unknown;
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      return {
        question: typeof rec.question === "string" ? rec.question : "Question",
        options: Array.isArray(rec.options)
          ? rec.options.filter((o): o is string => typeof o === "string")
          : [],
      };
    }
  } catch {}
  return null;
}

function parsePlan(line: string): { title: string; status: string }[] | null {
  const m = line.match(/<div data-plan='(.*)'>/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1].replace(/&#39;/g, "'")) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
        .map((t) => ({
          title: typeof t.title === "string" ? t.title : "",
          status: typeof t.status === "string" ? t.status : "pending",
        }))
        .filter((t) => t.title);
    }
  } catch {}
  return null;
}

type Block =
  | { kind: "md"; text: string }
  | { kind: "tool"; name: string; argument: string; failed: boolean; running: boolean }
  | { kind: "question"; question: string; options: string[] }
  | { kind: "plan"; tasks: { title: string; status: string }[] }
  | { kind: "error"; name: string; body: string };

function splitBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split("\n");
  let i = 0;
  let mdBuf: string[] = [];
  const flushMd = () => {
    const text = mdBuf.join("\n").trim();
    mdBuf = [];
    if (text) blocks.push({ kind: "md", text });
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.includes('<details data-tool="error">')) {
      flushMd();
      const name = line.replace(/.*<summary>(.*)<\/summary>.*/, "$1") || "⚠️ Agent run failed";
      const inner: string[] = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== "</details>") {
        inner.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: "error", name, body: inner.join("\n").trim() });
      continue;
    }
    if (line.includes('<details data-tool="call"')) {
      flushMd();
      const name = line.replace(/.*<summary>(.*)<\/summary>.*/, "$1") || "🛠 tool";
      const argMatch = line.match(/data-arg="([^"]*)"/);
      const argument = (argMatch?.[1] || "")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, ">")
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&");
      const inner: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trim() === "</details>") {
          closed = true;
          i += 1;
          break;
        }
        inner.push(lines[i]);
        i += 1;
      }
      const joined = inner.join("\n");
      blocks.push({
        kind: "tool",
        name,
        argument,
        failed: joined.includes('data-tool-status="failed"'),
        running: !closed,
      });
      continue;
    }
    if (line.trim() === "</details>") {
      i += 1;
      continue;
    }
    if (line.includes("<div data-question=")) {
      flushMd();
      const parsed = parseQuestion(line);
      i += 1;
      while (i < lines.length && lines[i].trim() !== "</div>") i += 1;
      i += 1;
      if (parsed) blocks.push({ kind: "question", ...parsed });
      continue;
    }
    if (line.includes("<div data-plan=")) {
      flushMd();
      const tasks = parsePlan(line);
      i += 1;
      while (i < lines.length && lines[i].trim() !== "</div>") i += 1;
      i += 1;
      if (tasks && tasks.length > 0) blocks.push({ kind: "plan", tasks });
      continue;
    }
    if (line.trim() === "</div>") {
      i += 1;
      continue;
    }
    mdBuf.push(line);
    i += 1;
  }
  flushMd();
  return blocks;
}

function Message({ content, onAnswer }: { content: string; onAnswer?: (text: string) => void }) {
  const blocks = splitBlocks(content);
  return (
    <div className="space-y-2">
      {blocks.map((b, k) => {
        if (b.kind === "md") {
          return (
            <div key={`b-${k}`} className="typeset typeset-docs text-sm">
              <Markdown>{b.text}</Markdown>
            </div>
          );
        }
        if (b.kind === "tool") {
          return (
            <ToolCallCard
              key={`b-${k}`}
              id={`b-${k}`}
              name={b.name}
              argument={b.argument}
              status={b.running ? "working" : b.failed ? "failed" : "done"}
            />
          );
        }
        if (b.kind === "question") {
          return (
            <QuestionCard
              key={`b-${k}`}
              id={`b-${k}`}
              question={b.question}
              options={b.options}
              onAnswer={onAnswer}
            />
          );
        }
        if (b.kind === "plan") {
          return <PlanCard key={`b-${k}`} id={`b-${k}`} tasks={b.tasks} />;
        }
        return (
          <div
            key={`b-${k}`}
            className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-[13px]"
          >
            <p className="font-medium text-destructive">{b.name}</p>
            {b.body && <p className="mt-1 whitespace-pre-wrap text-destructive/90">{b.body}</p>}
          </div>
        );
      })}
    </div>
  );
}

export default memo(Message);
