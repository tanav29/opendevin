"use client";

import { memo } from "react";
import { Streamdown } from "streamdown";

function ToolCallCard({
  name,
  input,
  output,
  error,
  running,
  id,
}: {
  name: string;
  input: string;
  output: string;
  error: string;
  running: boolean;
  id: string;
}) {
  return (
    <details
      key={id}
      open={running || Boolean(error)}
      className="rounded-md border border-border bg-card px-2 py-1.5 text-[12px]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? "animate-pulse bg-warning" : error ? "bg-destructive" : "bg-success"}`}
        />
        <span className="truncate">
          {name}
          {running ? " — running…" : error ? " — failed" : ""}
        </span>
      </summary>
      {input && (
        <div className="mt-1.5">
          <p className="mb-0.5 font-mono text-[10px] uppercase text-muted-foreground">Input</p>
          <pre className="max-h-40 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">
            {input}
          </pre>
        </div>
      )}
      {error ? (
        <div className="mt-1.5">
          <p className="mb-0.5 font-mono text-[10px] uppercase text-destructive">Error</p>
          <pre className="max-h-40 overflow-auto rounded bg-destructive/10 p-2 font-mono text-[11px] whitespace-pre-wrap text-destructive">
            {error}
          </pre>
        </div>
      ) : (
        output && (
          <div className="mt-1.5">
            <p className="mb-0.5 font-mono text-[10px] uppercase text-muted-foreground">Output</p>
            <pre className="max-h-60 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">
              {output}
            </pre>
          </div>
        )
      )}
    </details>
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
    <div key={id} className="rounded-md border border-warning/40 bg-warning-muted/40 p-3">
      <p className="text-[13px] font-medium">{question}</p>
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
    <div key={id} className="rounded-md border border-border bg-card p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
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

function extractFenced(inner: string, label: string): string {
  // Matches "label:\n\n```[lang]\n…\n```" as emitted by the chat endpoint.
  const re = new RegExp(`${label}:\\s*\\\`\\\`\\\`(?:json|\\w*)?\\n([\\s\\S]*?)\\n\\\`\\\`\\\``);
  const m = inner.match(re);
  return m ? m[1].trim() : "";
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
  | { kind: "tool"; name: string; input: string; output: string; error: string; running: boolean }
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
    if (line.includes('<details data-tool="call">')) {
      flushMd();
      const name = line.replace(/.*<summary>(.*)<\/summary>.*/, "$1") || "🛠 tool";
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
        input: extractFenced(joined, "input"),
        output: extractFenced(joined, "output"),
        error: extractFenced(joined, "error"),
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

function Markdown({ content, onAnswer }: { content: string; onAnswer?: (text: string) => void }) {
  const blocks = splitBlocks(content);
  return (
    <div className="space-y-2">
      {blocks.map((b, k) => {
        if (b.kind === "md") {
          return (
            <Streamdown key={`b-${k}`} className="text-[13.5px] leading-7">
              {b.text}
            </Streamdown>
          );
        }
        if (b.kind === "tool") {
          return (
            <ToolCallCard
              key={`b-${k}`}
              id={`b-${k}`}
              name={b.name}
              input={b.input}
              output={b.output}
              error={b.error}
              running={b.running}
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
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[13px]"
          >
            <p className="font-medium text-destructive">{b.name}</p>
            {b.body && <p className="mt-1 whitespace-pre-wrap text-destructive/90">{b.body}</p>}
          </div>
        );
      })}
    </div>
  );
}

export default memo(Markdown);
