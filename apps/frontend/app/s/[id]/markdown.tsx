"use client";

import { memo, useState } from "react";

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  // Minimal inline: `code`, **bold**, *italic*, [label](url)
  const parts: React.ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      parts.push(
        <code
          key={`${keyPrefix}-${k++}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      parts.push(<strong key={`${keyPrefix}-${k++}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      parts.push(<em key={`${keyPrefix}-${k++}`}>{tok.slice(1, -1)}</em>);
    } else {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        const href = lm[2].trim();
        const safe =
          /^(https?:|mailto:|\/|#)/i.test(href) &&
          !/^\s*javascript:/i.test(href) &&
          !/^\s*data:/i.test(href);
        if (safe) {
          parts.push(
            <a
              key={`${keyPrefix}-${k++}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {lm[1]}
            </a>,
          );
        } else {
          parts.push(`${lm[1]} (${href})`);
        }
      } else {
        parts.push(tok);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function CodeBlock({ lang, code, id }: { lang: string; code: string; id: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard
      ?.writeText(code)
      ?.then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      ?.catch(() => undefined);
  }
  return (
    <pre
      key={id}
      className="group/code overflow-x-auto rounded-md bg-[#0a0a0b] p-3 text-[12px] leading-5 text-zinc-200"
    >
      <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase text-zinc-500">
        <span>{lang || "code"}</span>
        <button
          type="button"
          onClick={copy}
          className="rounded px-1.5 py-0.5 normal-case opacity-0 transition-opacity group-hover/code:opacity-100 hover:bg-white/10 hover:text-zinc-200"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code className="font-mono whitespace-pre">{code}</code>
    </pre>
  );
}

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

function Markdown({ content, onAnswer }: { content: string; onAnswer?: (text: string) => void }) {
  const blocks: React.ReactNode[] = [];
  const lines = content.split("\n");
  let i = 0;
  let k = 0;
  let inFence = false;
  let fenceLang = "";
  let fenceBuf: string[] = [];

  const flushFence = () => {
    const code = fenceBuf.join("\n");
    blocks.push(<CodeBlock key={`b-${k++}`} id={`b-${k}`} lang={fenceLang} code={code} />);
    fenceBuf = [];
  };

  let listBuf: string[] = [];
  const flushList = () => {
    if (!listBuf.length) return;
    blocks.push(
      <ul key={`b-${k++}`} className="list-disc space-y-0.5 pl-5">
        {listBuf.map((item, j) => (
          <li key={j}>{renderInline(item, `li-${k}-${j}`)}</li>
        ))}
      </ul>,
    );
    listBuf = [];
  };

  let tableBuf: string[] = [];
  const flushTable = () => {
    if (!tableBuf.length) return;
    const rows = tableBuf.map((r) =>
      r
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim()),
    );
    const body = rows.filter((_, idx) => !(idx === 1 && rows[1]?.every((c) => /^:?-+:?$/.test(c))));
    blocks.push(
      <div key={`b-${k++}`} className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {body.map((cells, r) => (
              <tr key={r}>
                {cells.map((cell, c) => (
                  <td key={c} className="border border-border px-2 py-1 align-top">
                    {renderInline(cell, `t-${k}-${r}-${c}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      if (!inFence) {
        flushList();
        flushTable();
        inFence = true;
        fenceLang = line.trim().slice(3).trim();
      } else {
        inFence = false;
        flushFence();
      }
      i += 1;
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
      i += 1;
      continue;
    }
    // Error part streamed after headers are sent.
    if (line.includes('<details data-tool="error">')) {
      flushList();
      flushTable();
      const name = line.replace(/.*<summary>(.*)<\/summary>.*/, "$1") || "⚠️ Agent run failed";
      const inner: string[] = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== "</details>") {
        inner.push(lines[i]);
        i += 1;
      }
      i += 1; // skip </details>
      blocks.push(
        <div
          key={`b-${k++}`}
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[13px]"
        >
          <p className="font-medium text-destructive">{name}</p>
          {inner.join("\n").trim() && (
            <p className="mt-1 whitespace-pre-wrap text-destructive/90">
              {inner.join("\n").trim()}
            </p>
          )}
        </div>,
      );
      continue;
    }
    // Tool-activity markers streamed by the backend.
    if (line.includes('<details data-tool="call">')) {
      flushList();
      flushTable();
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
      blocks.push(
        <ToolCallCard
          key={`b-${k++}`}
          id={`b-${k}`}
          name={name}
          input={extractFenced(joined, "input")}
          output={extractFenced(joined, "output")}
          error={extractFenced(joined, "error")}
          running={!closed}
        />,
      );
      continue;
    }
    if (line.trim() === "</details>") {
      i += 1;
      continue;
    }
    // Questionnaire part emitted by the ask_user tool.
    if (line.includes("<div data-question=")) {
      flushList();
      flushTable();
      const parsed = parseQuestion(line);
      i += 1;
      while (i < lines.length && lines[i].trim() !== "</div>") i += 1;
      i += 1; // skip </div>
      if (parsed) {
        blocks.push(
          <QuestionCard
            key={`b-${k++}`}
            id={`b-${k}`}
            question={parsed.question}
            options={parsed.options}
            onAnswer={onAnswer}
          />,
        );
      }
      continue;
    }
    if (line.trim() === "</div>") {
      i += 1;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList();
      tableBuf.push(line);
      i += 1;
      continue;
    }
    flushTable();
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      listBuf.push(line.replace(/^\s*([-*]|\d+\.)\s+/, ""));
      i += 1;
      continue;
    }
    flushList();
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.startsWith("### ")) {
      blocks.push(
        <h4 key={`b-${k++}`} className="text-sm font-semibold">
          {renderInline(line.slice(4), `h-${k}`)}
        </h4>,
      );
    } else if (line.startsWith("## ")) {
      blocks.push(
        <h3 key={`b-${k++}`} className="text-[15px] font-semibold">
          {renderInline(line.slice(3), `h-${k}`)}
        </h3>,
      );
    } else if (line.startsWith("# ")) {
      blocks.push(
        <h2 key={`b-${k++}`} className="text-base font-semibold">
          {renderInline(line.slice(2), `h-${k}`)}
        </h2>,
      );
    } else if (line.startsWith("> ")) {
      blocks.push(
        <blockquote
          key={`b-${k++}`}
          className="border-l-2 border-border pl-3 text-muted-foreground"
        >
          {renderInline(line.slice(2), `q-${k}`)}
        </blockquote>,
      );
    } else {
      blocks.push(
        <p key={`b-${k++}`} className="whitespace-pre-wrap">
          {renderInline(line, `p-${k}`)}
        </p>,
      );
    }
    i += 1;
  }
  flushList();
  flushTable();
  if (inFence) flushFence();
  return <div className="space-y-2">{blocks}</div>;
}

export default memo(Markdown);
