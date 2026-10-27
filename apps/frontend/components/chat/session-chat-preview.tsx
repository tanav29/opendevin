"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  IconArrowLeft,
  IconCheck,
  IconEye,
  IconFolder,
  IconInfoCircle,
  IconLayoutSidebarRight,
  IconMessageChatbot,
  IconPaperclip,
  IconPlayerPlay,
  IconSparkles,
  IconTerminal2,
  IconTrash,
} from "@tabler/icons-react";
import { useAttachments } from "@/components/chat/use-attachments";
import ChatComposer from "@/components/chat/composer";
import ChatMessageRow from "@/components/chat/message-row";
import { Button } from "@/components/ui/button";

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  workDuration?: number;
};

const starters = [
  { label: "Explore an idea", prompt: "Help me add a dark mode toggle to my app" },
  { label: "Review a bug", prompt: "Find and fix the bug in my checkout flow" },
  { label: "Make a plan", prompt: "What should we build first?" },
  { label: "See a question", prompt: "Help me choose a direction for the new dashboard" },
];

const panelTabs = [
  { id: "files", label: "Files", icon: IconFolder },
  { id: "terminal", label: "Terminal", icon: IconTerminal2 },
  { id: "preview", label: "Preview", icon: IconEye },
] as const;

function mockReply(prompt: string) {
  const lower = prompt.toLowerCase();
  const tools = [
    [
      "src/app/page.tsx",
      "Inspect route",
      "Found the page entry point and the current loading boundary.",
    ],
    [
      "src/components/chat/message.tsx",
      "Read component",
      "The message renderer supports Markdown, tool activity, plans, and follow-up questions.",
    ],
    [
      "src/components/chat/composer.tsx",
      "Inspect composer",
      "The composer owns keyboard submit, attachments, and the busy stop control.",
    ],
    [
      "src/app/globals.css",
      "Search design tokens",
      "Found the existing surface, border, focus, and muted text colors.",
    ],
    [
      "src/app/s/[id]/page.tsx",
      "Trace session state",
      "Live text arrives incrementally; completed messages are refreshed into session history.",
    ],
    [
      "package.json",
      "Check project scripts",
      "Found the available development, lint, formatting, and build commands.",
    ],
    [
      "src/components/chat/message-row.tsx",
      "Review message states",
      "Session messages use a plain assistant surface with activity that can collapse after a turn.",
    ],
    [
      "src/app/s/[id]/session-panel.tsx",
      "Inspect workspace panel",
      "Files, terminal, changes, and preview live beside the session conversation.",
    ],
  ]
    .sort(() => Math.random() - 0.5)
    .slice(0, 4 + Math.floor(Math.random() * 4));
  const verificationIndex = tools.findIndex(
    ([, name]) => name.includes("Check") || name.includes("Review"),
  );
  const simulateFailure = Math.random() < 0.2 && verificationIndex >= 0;
  const activity = tools
    .map(([path, name, result], index) => {
      const status =
        simulateFailure && index === verificationIndex
          ? '\n<span data-tool-status="failed">One optional check needs a configured local service.</span>'
          : "";
      return `<details data-tool="call" data-arg="${path}"><summary>${name}</summary>${result}${status}\n</details>`;
    })
    .join("\n\n");
  const plan =
    lower.includes("first") || lower.includes("plan") || Math.random() < 0.35
      ? `<div data-plan='[{"title":"Map the current interaction","status":"done"},{"title":"Make the smallest useful change","status":"in_progress"},{"title":"Check loading, error, and success states","status":"pending"},{"title":"Review keyboard and narrow-screen behavior","status":"pending"}]'>\n</div>\n\n`
      : "";
  const question =
    lower.includes("choose") || lower.includes("direction")
      ? `<div data-question='{"question":"Which direction should I explore first?","options":["Keep the current layout","Make the controls more compact","Give the workspace more room"]}'>\n</div>\n\n`
      : "";
  const opening =
    lower.includes("bug") || lower.includes("checkout")
      ? "I traced the checkout interaction from the submit handler through the confirmation state. The main risk is duplicate work while a request is pending, so I’m checking both the button state and the route transition before settling on a fix."
      : lower.includes("plan") || lower.includes("first")
        ? "I mapped the existing structure and separated the work into a few reviewable steps. The goal is to preserve the current interaction model, make the next action obvious, and avoid introducing state that the page does not need."
        : "I traced the request through the page, shared chat components, and workspace shell. The existing patterns give us a clean way to make this change without adding another state layer or making the conversation harder to scan.";
  const analysis = [
    "The useful boundary is between the conversation and the workspace. The conversation should keep its rhythm while tools are running, and the workspace controls should remain available without competing with the current turn.",
    "There are a few states worth treating separately: before the first response, while text is arriving, while a tool is active, after the final response, and when a check fails. Keeping those states visible makes the interface feel responsive without adding noise.",
    "For smaller screens, the main tradeoff is width. Message text needs a comfortable line length, but long file paths and tool arguments should truncate safely instead of pushing the layout sideways.",
  ];
  const implementation = [
    "I’d keep the assistant response in the normal message flow and use a compact activity row for the work. That lets the final answer stay readable, while the supporting detail remains one click away after the turn finishes.",
    "The interaction should have a clear start and finish: show a brief working state immediately, stream the assistant text as it arrives, mark each tool complete as its result lands, then fold the activity away when the response is done.",
    "Controls should keep the same location and behavior throughout the turn. Stop replaces Send while work is active; once the turn completes, the composer returns to its ready state and the user can continue without hunting for the input.",
  ];
  const answer = `${opening}\n\n### What I found\n\n${analysis
    .sort(() => Math.random() - 0.5)
    .slice(0, 2)
    .join("\n\n")}\n\n### Suggested change\n\n${implementation
    .sort(() => Math.random() - 0.5)
    .slice(0, 2)
    .join(
      "\n\n",
    )}\n\n\`\`\`tsx\nconst canSend = !isStreaming && message.trim().length > 0;\n\nreturn isStreaming ? <StopButton onClick={stop} /> : <SendButton disabled={!canSend} />;\n\`\`\`\n\n### Checks\n\nI’d check the empty state, a long response, multiple sequential tool calls, a failed check, and a follow-up question. I’d also verify Enter to send, Shift+Enter for a new line, Stop during an active tool, and the composer at a narrow viewport.\n\nThe important detail is when the activity folds: keep the tool list and earlier progress visible during generation, then collapse that work after the final answer arrives so the completed response is the first thing the user sees.`;
  return `I’ll trace the current flow, then work through the relevant components and checks.\n\n${activity}\n\n${plan}${question}${answer}`;
}

function streamChunks(content: string) {
  const chunks: { text: string; delay: number }[] = [];
  const addText = (text: string) => {
    const words = text.match(/\S+\s*/g) ?? [];
    for (let i = 0; i < words.length;) {
      const count = 1 + Math.floor(Math.random() * 4);
      chunks.push({ text: words.slice(i, i + count).join(""), delay: 25 + Math.random() * 100 });
      i += count;
    }
  };
  const detailsPattern =
    /(<details data-tool="call"[^>]*><summary>.*?<\/summary>)([\s\S]*?)(<\/details>)/g;
  let cursor = 0;
  for (const match of content.matchAll(detailsPattern)) {
    const start = match.index ?? 0;
    addText(content.slice(cursor, start));
    const [, opening, body, closing] = match;
    chunks.push({ text: `${opening}\n`, delay: 80 + Math.random() * 180 });
    chunks.push({ text: `${body.trim()}\n`, delay: 350 + Math.random() * 900 });
    chunks.push({ text: `${closing}\n\n`, delay: 80 + Math.random() * 180 });
    cursor = start + match[0].length;
  }
  addText(content.slice(cursor));
  return chunks;
}

export default function SessionChatPreview({
  title = "Add a dark mode toggle",
  projectInfo = "storefront / feature/dark-mode",
  modeLabel = "Session preview",
}: {
  title?: string;
  projectInfo?: string;
  modeLabel?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [panelTab, setPanelTab] = useState<(typeof panelTabs)[number]["id"] | "info">("files");
  const [panelOpen, setPanelOpen] = useState(false);
  const { attachments, addFiles, removeAttachment, resetAttachments } = useAttachments();
  const nextId = useRef(1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const replyTimer = useRef<number | null>(null);
  const streamToken = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);
  useEffect(
    () => () => {
      if (replyTimer.current !== null) window.clearTimeout(replyTimer.current);
    },
    [],
  );

  function send(text = input) {
    const prompt = text.trim();
    const fullPrompt = [
      prompt,
      ...attachments.map((attachment) => `[Attached: ${attachment.name}]`),
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!fullPrompt || busy) return;
    setInput("");
    resetAttachments();
    const assistantId = nextId.current++;
    const startedAt = Date.now();
    const response = mockReply(fullPrompt);
    const chunks = streamChunks(response);
    const token = ++streamToken.current;
    setMessages((current) => [
      ...current,
      { id: nextId.current++, role: "user", content: fullPrompt },
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setBusy(true);
    let chunkIndex = 0;
    function streamNext() {
      if (token !== streamToken.current) return;
      if (chunkIndex >= chunks.length) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  workDuration: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
                }
              : message,
          ),
        );
        setBusy(false);
        replyTimer.current = null;
        return;
      }
      const chunk = chunks[chunkIndex++];
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, content: message.content + chunk.text }
            : message,
        ),
      );
      replyTimer.current = window.setTimeout(streamNext, chunk.delay);
    }
    replyTimer.current = window.setTimeout(streamNext, 300 + Math.random() * 700);
  }

  function clearChat() {
    streamToken.current++;
    if (replyTimer.current !== null) window.clearTimeout(replyTimer.current);
    replyTimer.current = null;
    setBusy(false);
    setMessages([]);
    setInput("");
    resetAttachments();
  }

  function stopReply() {
    streamToken.current++;
    if (replyTimer.current !== null) window.clearTimeout(replyTimer.current);
    replyTimer.current = null;
    setBusy(false);
  }

  return (
    <main className="relative h-dvh overflow-hidden bg-background">
      <header className="absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-between gap-3 border-b bg-sidebar px-2 sm:px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            aria-label="Back to project"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconArrowLeft size={16} />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium">{title}</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">{projectInfo}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {busy && (
            <span
              className="mr-1 inline-flex items-center gap-2 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-success" />
              Agent is working
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Run preview"
            title="Run preview"
            onClick={() => {
              setPanelTab("preview");
              setPanelOpen(true);
            }}
          >
            <IconPlayerPlay />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Session information"
            title="Session information"
            onClick={() => {
              setPanelTab("info");
              setPanelOpen(true);
            }}
          >
            <IconInfoCircle />
          </Button>
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label="Clear session"
            title="Clear session"
            onClick={clearChat}
          >
            <IconTrash />
          </Button>
          <Button
            variant={panelOpen ? "outline" : "secondary"}
            size="icon-sm"
            aria-label={panelOpen ? "Hide workspace panel" : "Show workspace panel"}
            title="Toggle workspace panel"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            <IconLayoutSidebarRight />
          </Button>
        </div>
      </header>

      <section
        aria-label="Session chat preview"
        className={`absolute inset-x-0 top-0 flex h-full flex-col gap-4 overflow-y-auto px-4 pb-36 pt-16 scrollbar-none sm:px-8 ${panelOpen ? "lg:right-[min(36vw,480px)] lg:pr-8" : ""}`}
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center pb-8">
            <div className="mb-5 flex size-11 items-center justify-center rounded-2xl border bg-card text-muted-foreground shadow-sm">
              <IconMessageChatbot size={21} stroke={1.7} />
            </div>
            <h1 className="max-w-xl text-3xl font-medium leading-tight tracking-tight sm:text-[2.5rem]">
              Shape the session chat.
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
              Try the composer, sample replies, and message layout. This preview stays in your
              browser and never calls an AI service.
            </p>

            <div className="mt-8">
              <p className="mb-3 text-xs font-medium text-muted-foreground">Try a sample</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {starters.map(({ label, prompt }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => send(prompt)}
                    className="group min-h-24 rounded-xl border bg-card p-3.5 text-left transition-colors hover:border-border-strong hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                      <IconSparkles size={14} /> {label}
                    </span>
                    <span className="mt-2 block text-sm leading-5">{prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <ChatMessageRow
                key={message.id}
                role={message.role}
                content={message.content}
                presentation="session"
                workDuration={message.workDuration}
                collapseActivity={message.workDuration !== undefined}
                workingLabel="Working"
                onAnswer={(answer) => send(answer)}
              />
            ))}
            {busy && messages.at(-1)?.role === "assistant" && !messages.at(-1)?.content && (
              <ChatMessageRow
                role="assistant"
                content=""
                presentation="session"
                workingLabel="Working"
              />
            )}
            <div ref={bottomRef} />
          </>
        )}
      </section>

      {panelOpen && (
        <aside className="absolute bottom-0 right-0 top-12 z-10 flex w-full flex-col border-l bg-background shadow-xl lg:w-[min(36vw,480px)]">
          <div className="flex h-11 items-center justify-between border-b px-3">
            <span className="text-sm font-medium">
              {panelTab === "info" ? "Session information" : "Workspace"}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close workspace panel"
              onClick={() => setPanelOpen(false)}
            >
              ×
            </Button>
          </div>
          {panelTab !== "info" && (
            <div className="flex border-b px-2">
              {panelTabs.map(({ id, label, icon: TabIcon }) => (
                <button
                  key={id}
                  onClick={() => setPanelTab(id)}
                  className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs ${panelTab === id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"}`}
                >
                  <TabIcon size={14} />
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto p-4 text-sm text-muted-foreground">
            {panelTab === "info" ? (
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs">Session</dt>
                  <dd className="mt-1 text-foreground">{title}</dd>
                </div>
                <div>
                  <dt className="text-xs">Branch</dt>
                  <dd className="mt-1 text-foreground">feature/dark-mode</dd>
                </div>
                <div>
                  <dt className="text-xs">Workspace</dt>
                  <dd className="mt-1 text-foreground">Ready · local mock</dd>
                </div>
                <div>
                  <dt className="text-xs">Agent</dt>
                  <dd className="mt-1 text-foreground">Idle</dd>
                </div>
              </dl>
            ) : panelTab === "files" ? (
              <div className="space-y-1 font-mono text-xs">
                <p className="rounded bg-muted px-2 py-1.5 text-foreground">▾ storefront</p>
                <p className="px-5 py-1">▸ src</p>
                <p className="px-5 py-1">▸ app</p>
                <p className="px-5 py-1">package.json</p>
              </div>
            ) : panelTab === "terminal" ? (
              <pre className="rounded-lg bg-muted p-3 font-mono text-xs leading-6 text-foreground">
                $ pnpm dev{"\n"}Ready on localhost:3000{"\n"}${" "}
                <span className="animate-pulse">▍</span>
              </pre>
            ) : (
              <div className="flex h-full min-h-48 items-center justify-center rounded-lg border bg-muted/30 text-sm">
                Preview is ready to open
              </div>
            )}
          </div>
        </aside>
      )}

      <div className="absolute bottom-0 left-0 right-0 z-10 shrink-0 px-3 pb-4 sm:mx-8">
        <ChatComposer
          value={input}
          onValueChange={setInput}
          onSubmit={() => send()}
          onStop={stopReply}
          busy={busy}
          canSend={Boolean(input.trim()) || attachments.length > 0}
          placeholder="Tell the agent what to do..."
          onPasteFiles={(files) => void addFiles(files)}
          onDropFiles={(files) => void addFiles(files)}
          attachments={
            attachments.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-3 pt-2">
                {attachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className="flex items-center gap-1.5 rounded-md border bg-muted px-2 py-0.5 font-mono text-[11px]"
                  >
                    {attachment.name}
                    <button
                      type="button"
                      aria-label={`Remove ${attachment.name}`}
                      onClick={() => removeAttachment(attachment.id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : undefined
          }
          actions={
            <>
              <input
                type="file"
                multiple
                className="hidden"
                id="session-preview-files"
                onChange={(event) => {
                  if (event.target.files) void addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Attach files"
                onClick={() => document.getElementById("session-preview-files")?.click()}
              >
                <IconPaperclip size={17} />
              </Button>
            </>
          }
        />
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <IconCheck size={13} className="text-success" />
          {modeLabel} · randomized text and tool streaming · no inference costs
        </p>
      </div>
    </main>
  );
}
