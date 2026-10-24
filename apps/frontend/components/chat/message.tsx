"use client";

import { memo, useState } from "react";
import Markdown from "react-markdown";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon, File02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";

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
  const statusIcon = status === "working" ? "◌" : status === "done" ? "✓" : "×";
  return (
    <div key={id} className="flex min-w-0 items-center gap-2 font-mono text-md">
      <span
        className="flex size-4 shrink-0 items-center justify-center text-md"
        aria-label={status}
      >
        {statusIcon}
      </span>
      <span className="shrink-0 font-medium text-foreground text-md">{name}</span>
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

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function FileCard({
  name,
  url,
  size,
  id,
}: {
  name: string;
  url: string;
  size: number;
  id: string;
}) {
  const [downloading, setDownloading] = useState(false);

  // Fetch the presigned URL into a blob so the browser saves the file instead of
  // rendering it inline. Falls back to opening the link if CORS blocks the fetch.
  async function download() {
    setDownloading(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      key={id}
      className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 shadow-sm"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <HugeiconsIcon icon={File02Icon} size={16} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium" title={name}>
          {name}
        </p>
        <p className="text-[11px] text-muted-foreground">{formatBytes(size) || "Sandbox file"}</p>
      </div>
      <Button
        size="xs"
        variant="outline"
        onClick={() => void download()}
        disabled={downloading}
        aria-label={`Download ${name}`}
      >
        <HugeiconsIcon icon={Download01Icon} size={16} strokeWidth={1.8} />{" "}
        {downloading ? "Downloading…" : "Download"}
      </Button>
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

function parseFile(line: string): { name: string; url: string; size: number } | null {
  const m = line.match(/<div data-file='(.*)'>/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1].replace(/&#39;/g, "'")) as Record<string, unknown>;
    const url = typeof parsed.url === "string" ? parsed.url : "";
    if (!url) return null;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "File",
      url,
      size: typeof parsed.size === "number" ? parsed.size : 0,
    };
  } catch {}
  return null;
}

type Block =
  | { kind: "md"; text: string }
  | { kind: "tool"; name: string; argument: string; failed: boolean; running: boolean }
  | { kind: "question"; question: string; options: string[] }
  | { kind: "plan"; tasks: { title: string; status: string }[] }
  | { kind: "file"; name: string; url: string; size: number }
  | { kind: "error"; name: string; body: string };

// Split prose into standalone sections so each paragraph renders as its own
// bubble. Fenced code blocks stay intact even when they contain blank lines.
function splitSections(text: string): string[] {
  const sections: string[] = [];
  let buffer: string[] = [];
  let fenced = false;
  const flush = () => {
    const section = buffer.join("\n").trim();
    buffer = [];
    if (section) sections.push(section);
  };
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && line.trim() === "") {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

function splitBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split("\n");
  let i = 0;
  let mdBuf: string[] = [];
  const flushMd = () => {
    const text = mdBuf.join("\n");
    mdBuf = [];
    for (const section of splitSections(text)) blocks.push({ kind: "md", text: section });
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
    if (line.includes("<div data-file=")) {
      flushMd();
      const file = parseFile(line);
      i += 1;
      while (i < lines.length && lines[i].trim() !== "</div>") i += 1;
      i += 1;
      if (file) blocks.push({ kind: "file", ...file });
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The model sees the presigned URL in the tool result and may echo it in prose.
// The file card already shows the file, so drop matching links and bare URLs.
function stripSharedLinks(blocks: Block[]): Block[] {
  const urls = [
    ...new Set(
      blocks.flatMap((block) =>
        block.kind === "file" ? [block.url, block.url.split("?")[0]] : [],
      ),
    ),
  ].filter(Boolean);
  if (urls.length === 0) return blocks;
  const linkPattern = new RegExp(
    `\\[([^\\]]*)\\]\\((${urls.map(escapeRegExp).join("|")})[^)]*\\)`,
    "g",
  );
  return blocks
    .map((block) => {
      if (block.kind !== "md") return block;
      let text = block.text.replace(linkPattern, "");
      for (const url of urls) text = text.split(url).join("");
      return { ...block, text: text.replace(/`\s*`/g, "").trim() };
    })
    .filter((block) => block.kind !== "md" || block.text.length > 0);
}

function Message({ content, onAnswer }: { content: string; onAnswer?: (text: string) => void }) {
  const blocks = stripSharedLinks(splitBlocks(content));
  return (
    <div className="space-y-2">
      {blocks.map((b, k) => {
        if (b.kind === "md") {
          return (
            <div
              key={`b-${k}`}
              className="typeset typeset-docs rounded-2xl rounded-tl-md bg-muted px-4 py-2.5 text-sm"
            >
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
        if (b.kind === "file") {
          return <FileCard key={`b-${k}`} id={`b-${k}`} name={b.name} url={b.url} size={b.size} />;
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
