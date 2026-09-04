"use client";

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
        parts.push(
          <a
            key={`${keyPrefix}-${k++}`}
            href={lm[2]}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {lm[1]}
          </a>,
        );
      } else {
        parts.push(tok);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function Markdown({ content }: { content: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = content.split("\n");
  let i = 0;
  let k = 0;
  let inFence = false;
  let fenceLang = "";
  let fenceBuf: string[] = [];

  const flushFence = () => {
    const code = fenceBuf.join("\n");
    blocks.push(
      <pre
        key={`b-${k++}`}
        className="overflow-x-auto rounded-md bg-[#0a0a0b] p-3 text-[12px] leading-5 text-zinc-200"
      >
        {fenceLang && (
          <div className="mb-1 font-mono text-[10px] uppercase text-zinc-500">{fenceLang}</div>
        )}
        <code className="font-mono whitespace-pre">{code}</code>
      </pre>,
    );
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

  while (i < lines.length) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      if (!inFence) {
        flushList();
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
    // Tool-activity markers streamed by the backend.
    if (line.includes('<details data-tool="call">')) {
      flushList();
      const name = line.replace(/.*<summary>(.*)<\/summary>.*/, "$1") || "🛠 tool";
      blocks.push(
        <div
          key={`b-${k++}`}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 font-mono text-[11px] text-muted-foreground"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
          {name}
        </div>,
      );
      i += 1;
      continue;
    }
    if (line.trim() === "</details>") {
      i += 1;
      continue;
    }
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
  if (inFence) flushFence();
  return <div className="space-y-2">{blocks}</div>;
}
