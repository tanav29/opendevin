"use client";

import { memo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon, File02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Plan, Tool } from "@/components/ai-elements/activity";
import { Response } from "@/components/ai-elements/response";
import { parseQuestion, type Question } from "./questionnaire";
import {
  Attachment,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileCard({
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
    <Attachment key={id} className="w-full">
      <AttachmentMedia>
        <HugeiconsIcon icon={File02Icon} size={16} strokeWidth={1.8} />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle title={name}>{name}</AttachmentTitle>
        <AttachmentDescription>{formatBytes(size) || "Sandbox file"}</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
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
      </AttachmentActions>
    </Attachment>
  );
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
  | {
      kind: "tool";
      name: string;
      argument: string;
      body: string;
      failed: boolean;
      running: boolean;
    }
  | ({ kind: "question" } & Question)
  | { kind: "plan"; tasks: { title: string; status: string }[] }
  | { kind: "file"; name: string; url: string; size: number }
  | { kind: "error"; name: string; body: string };

function splitBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split("\n");
  let i = 0;
  let fence = "";
  let mdBuf: string[] = [];
  const flushMd = () => {
    const text = mdBuf.join("\n").trim();
    mdBuf = [];
    if (text) blocks.push({ kind: "md", text });
  };

  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence || fenceMatch) {
      mdBuf.push(line);
      if (fenceMatch) {
        if (!fence) fence = fenceMatch[1];
        else if (
          fenceMatch[1][0] === fence[0] &&
          fenceMatch[1].length >= fence.length &&
          !line.slice(fenceMatch[0].length).trim()
        )
          fence = "";
      }
      i += 1;
      continue;
    }
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
      const inner: string[] = [line.match(/<\/summary>(.*)$/)?.[1] || ""];
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
        body: joined.trim(),
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
    if (line.includes("<div data-suggestions=")) {
      flushMd();
      i += 1;
      while (i < lines.length && lines[i].trim() !== "</div>") i += 1;
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
      return { ...block, text: text.replace(/(?<!`)`[ \t]*`(?!`)/g, "").trim() };
    })
    .filter((block) => block.kind !== "md" || block.text.length > 0);
}

function Message({
  content,
  textOnly = false,
  bubble = true,
  isStreaming = false,
}: {
  content: string;
  textOnly?: boolean;
  bubble?: boolean;
  isStreaming?: boolean;
}) {
  const parsedBlocks = stripSharedLinks(splitBlocks(content));
  const blocks = textOnly
    ? parsedBlocks.filter((block) => block.kind === "md" || block.kind === "file")
    : parsedBlocks;

  return (
    <div className="min-w-0 space-y-3">
      {blocks.map((b, k) => {
        if (b.kind === "md") {
          return (
            <div
              key={`b-${k}`}
              className={bubble && !textOnly ? "rounded-xl bg-muted px-4 py-2.5" : ""}
            >
              <Response>{b.text}</Response>
            </div>
          );
        }
        if (b.kind === "tool") {
          return (
            <Tool
              key={`b-${k}`}
              name={b.name}
              argument={b.argument}
              output={b.body.replace(/<\/?(?:span|div)\b[^>]*>/g, "").trim()}
              state={
                b.failed
                  ? "error"
                  : b.running
                    ? isStreaming
                      ? "running"
                      : "interrupted"
                    : "complete"
              }
            />
          );
        }
        if (b.kind === "question") {
          return (
            <Tool key={`b-${k}`} name="Questionnaire" state={b.answered ? "complete" : "waiting"} />
          );
        }
        if (b.kind === "plan") {
          return <Plan key={`b-${k}`} tasks={b.tasks} streaming={isStreaming} />;
        }
        if (b.kind === "file") {
          return <FileCard key={`b-${k}`} id={`b-${k}`} name={b.name} url={b.url} size={b.size} />;
        }
        return (
          <div
            key={`b-${k}`}
            role="alert"
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
