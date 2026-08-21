"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useEveAgent } from "eve/react";
import type { ClientSessionState, MessageStreamEvent } from "eve/client";
import { useQuery as useConvexQuery, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PatchDiff } from "@pierre/diffs/react";
import Markdown from "react-markdown";
import { IconBrandGithub } from "@tabler/icons-react";
import {
  Archive,
  CircleStop,
  Command,
  FileDiff,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  SendHorizontal,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Terminal as TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  mapSessions,
  sessionTitle,
  useSessionSelection,
  type Session,
} from "@/components/providers";
import { api } from "@convex/_generated/api";

type SavedChat = {
  events: readonly MessageStreamEvent[];
  session?: ClientSessionState;
};

const storageKey = (sessionId: string) => `opendevin:eve:${sessionId}`;

function loadChat(sessionId: string): SavedChat {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(storageKey(sessionId)) ?? "null",
    ) as Partial<SavedChat> | null;
    return {
      events: Array.isArray(value?.events) ? value!.events : [],
      session: value?.session,
    };
  } catch {
    return { events: [] };
  }
}

function saveChat(sessionId: string, value: SavedChat) {
  try {
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(value));
  } catch {
    // Storage may be full or blocked; the eve stream stays durable.
  }
}

type ToolPart = {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type ChatPart = { type?: string; text?: string } & Partial<ToolPart>;
type ChatMessage = { id?: string; role: string; parts: ChatPart[] };

function toolValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const TOOL_DONE_STATES = new Set([
  "output-available",
  "output-denied",
  "output-error",
  "successful-parse",
  "complete",
  "done",
]);
const TOOL_ERROR_STATES = new Set(["output-error", "failed-parse", "error"]);

function ToolCall({ part }: { part: ToolPart }) {
  const name =
    part.toolName ||
    (part.type.startsWith("tool-") ? part.type.slice(5) : "tool");
  const done = Boolean(part.state && TOOL_DONE_STATES.has(part.state));
  const error = Boolean(part.state && TOOL_ERROR_STATES.has(part.state));
  const status = error ? "Failed" : done ? "Completed" : "Running";
  const input = toolValue(part.input);
  const output = toolValue(part.errorText ?? part.output);
  const verb =
    name === "bash" || name === "run_command"
      ? "Running command"
      : `Using ${name}`;

  return (
    <details className="group mb-2 overflow-hidden rounded-md border text-xs" open={!done && !error}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 hover:bg-muted/60">
        <TerminalIcon className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{verb}</span>
        <code className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:block">{name}</code>
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", error ? "bg-destructive" : done ? "bg-emerald-500" : "bg-amber-500")} />
          {status}
        </span>
      </summary>
      {(input || output) && (
        <div className="space-y-1.5 border-t px-2.5 py-1.5 text-[11px]">
          {input && <div><p className="mb-1 text-muted-foreground">Input</p><pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted/70 p-1.5 font-mono">{input}</pre></div>}
          {output && <div><p className={cn("mb-1", error ? "text-destructive" : "text-muted-foreground")}>{error ? "Error" : "Result"}</p><pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted/70 p-1.5 font-mono">{output}</pre></div>}
        </div>
      )}
    </details>
  );
}

function Message({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming: boolean;
}) {
  const startedAt = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showWorkDetails, setShowWorkDetails] = useState(false);
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );
  const hasToolParts = message.parts.some(
    (part) => part.type?.startsWith("tool-") || part.type === "dynamic-tool",
  );

  useEffect(() => {
    const beganAt = startedAt.current ?? Date.now();
    startedAt.current = beganAt;
    if (!streaming) {
      setElapsed(Math.max(0, Date.now() - beganAt));
      return;
    }
    const timer = window.setInterval(
      () => setElapsed(Date.now() - beganAt),
      250,
    );
    return () => window.clearInterval(timer);
  }, [streaming]);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[min(85%,34rem)] rounded-md bg-muted px-3 py-1.5 text-sm leading-5">
          {message.parts.map((part, i) =>
            part.type === "text" ? <p key={`${message.id}-${i}`}>{part.text}</p> : null,
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex">
      <div className="min-w-0 flex-1">
        <div className="text-sm leading-6">
          {message.parts.map((part, i) => {
            // Once the turn is complete, keep the final answer readable and
            // replace the verbose tool trace above it with one compact summary.
            if (!streaming && hasToolParts && i === 0) {
              const summary = (
                <button
                  type="button"
                  onClick={() => setShowWorkDetails((value) => !value)}
                  className="mb-2 flex w-full items-center gap-2 py-0.5 text-left text-xs text-muted-foreground hover:text-foreground">
                  <span className="flex-1">Worked for {Math.max(1, Math.round(elapsed / 1000))} sec</span>
                  {showWorkDetails ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>
              );
              if (!showWorkDetails) return summary;
              return (
                <div key={`${message.id}-${i}`}>
                  {summary}
                  {part.type === "text" ? (
                    <div className="typeset typeset-chat">{part.text}</div>
                  ) : part.type?.startsWith("tool-") || part.type === "dynamic-tool" ? (
                    <ToolCall part={part as ToolPart} />
                  ) : null}
                </div>
              );
            }
            if (!streaming && hasToolParts && !showWorkDetails && i < lastTextIndex) {
              return null;
            }
            if (part.type === "text")
              return (
                <div
                  key={`${message.id}-${i}`}
                  className="typeset typeset-chat">
                  <Markdown>
                    {part.text ?? ""}
                  </Markdown>
                </div>
              );
            if (part.type?.startsWith("tool-") || part.type === "dynamic-tool")
              return (
                <ToolCall key={`${message.id}-${i}`} part={part as ToolPart} />
              );
            return null;
          })}
        </div>
        {streaming && (
          <p className="mt-2 flex items-center gap-1.5 text-sidebar-foreground/60">
            <LoaderCircle className="size-3 animate-spin" />
            <span className="text-xs">Working</span>
          </p>
        )}
      </div>
    </div>
  );
}

function legacyMessages(session: Session): ChatMessage[] {
  try {
    const value = JSON.parse(session.parts ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (message) =>
        (message as ChatMessage).role === "user" ||
        (message as ChatMessage).role === "assistant",
    );
  } catch {
    return [];
  }
}

function Chat({ session }: { session: Session }) {
  const update = useMutation(api.sessions.update);
  const [prompt, setPrompt] = useState("");
  const [notice, setNotice] = useState("");
  const saved = useMemo(() => loadChat(session.id), [session.id]);
  const eventsRef = useRef<readonly MessageStreamEvent[]>(saved.events);

  const agent = useEveAgent({
    initialEvents: saved.events,
    initialSession: saved.session,
    onEvent(event) {
      eventsRef.current = [...eventsRef.current, event];
    },
    onSessionChange(next) {
      if (!next?.sessionId) return;
      saveChat(session.id, { events: eventsRef.current, session: next });
      // Link the durable eve session id to the convex row once.
      if (next.sessionId !== session.eveSessionId) {
        void update({ id: session.id as never, eveSessionId: next.sessionId });
      }
    },
    onFinish(snapshot) {
      const value = {
        events: snapshot.events,
        session: snapshot.session,
      };
      saveChat(session.id, value);
      void update({
        id: session.id as never,
        parts: JSON.stringify(value),
      });
    },
  });

  const messages = agent.data.messages as unknown as ChatMessage[];
  const working =
    agent.status === "submitted" || agent.status === "streaming";
  const busy = working || session.status === "running";

  useEffect(() => {
    if (!notice) return;
    toast.error(notice);
    queueMicrotask(() => setNotice(""));
  }, [notice]);
  useEffect(() => {
    if (!agent.error?.message) return;
    toast.error(agent.error.message);
  }, [agent.error?.message]);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, agent.status]);

  const send = useCallback(
    async (text = prompt) => {
      if (!text.trim() || busy) return;
      setPrompt("");
      setNotice("");
      try {
        await agent.send(text.trim());
      } catch (err) {
        setNotice(
          err instanceof Error ? err.message : "Could not send message.",
        );
      }
    },
    [agent, prompt, busy],
  );

  useEffect(() => {
    if (busy) return;
    const initialPrompt = window.sessionStorage.getItem("opendevin:initial-prompt");
    if (!initialPrompt) return;
    window.sessionStorage.removeItem("opendevin:initial-prompt");
    queueMicrotask(() => void send(initialPrompt));
  }, [send, busy]);

  async function stopAgent() {
    if (!working) return;
    try {
      await agent.cancel();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not stop the agent.");
    }
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="min-h-0 flex-1 w-full overflow-y-auto scrollbar-none">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-4 sm:px-6">
          {messages.length === 0 && (
            <div className="pt-8">
              <h2 className="text-base font-medium tracking-tight">
                What are we building?
              </h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Describe the outcome. The agent inspects the repository and makes the changes.
              </p>
            </div>
          )}
          {messages.map((m, index) => (
            <Message
              key={`${m.id || "message"}-${index}`}
              message={m}
              streaming={working && m.id === messages.at(-1)?.id}
            />
          ))}
          <div ref={bottom} />
        </div>
      </div>
      <div className="border-t px-3 py-2 sm:px-4">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-end gap-1.5 rounded-md border bg-background p-1.5">
            <Textarea
              value={prompt}
              disabled={Boolean(busy)}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask OpenDevin to investigate, build, or fix…"
              rows={1}
              className="min-h-8 resize-none border-0 bg-transparent py-1.5 shadow-none focus-visible:ring-0 disabled:bg-transparent"
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    aria-label={busy ? "Stop" : "Send message"}
                    className="size-7"
                    onClick={() => {
                      if (busy) void stopAgent();
                      else send();
                    }}
                    disabled={
                      busy || !prompt.trim()
                    }
                    variant={busy ? "destructive" : "default"}>
                    {busy ? <CircleStop /> : <SendHorizontal />}
                  </Button>
                }
              />
              <TooltipContent>
                {busy ? "Stop" : "Send message"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Home() {
  const { activeSessionId, selectSession } = useSessionSelection();
  const router = useRouter();
  const updateSession = useMutation(api.sessions.update);
  const sessions = mapSessions(
    useConvexQuery(api.sessions.list, {}) as unknown[] | undefined,
  );
  const active =
    sessions.find((session) => session.id === activeSessionId) ?? null;
  const [view, setView] = useState<"diff" | null>("diff");
  const [collapsedPane, setCollapsedPane] = useState(false);
  const [paneWidth, setPaneWidth] = useState(40);
  const [github, setGithub] = useState<
    { connected: boolean; login?: string } | undefined
  >();
  const [publishing, setPublishing] = useState(false);
  const resizing = useRef(false);
  const diff = active?.diff ?? "";
  const diffFiles = diff
    ? diff.split(/(?=^diff --git )/m).filter(Boolean)
    : [];
  const legacy = Boolean(active && !active.eveSessionId && active.parts);
  const legacyTranscript = legacy && active ? legacyMessages(active) : [];
  const canChat = Boolean(active) && !legacy;

  useEffect(() => {
    void fetch("/api/github/session")
      .then((response) => response.json())
      .then((value) => setGithub(value as { connected: boolean; login?: string }))
      .catch(() => setGithub({ connected: false }));
    const status = new URLSearchParams(window.location.search).get("github");
    if (status === "connected") toast.success("GitHub connected.");
    if (status === "error") toast.error("Could not connect GitHub.");
    if (status) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  function downloadPatch() {
    if (!active || !diff) return;
    const blob = new Blob([diff], { type: "text/x-diff;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sessionTitle(active).replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "opendevin"}.patch`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function publishChanges() {
    if (!active || !diff || publishing) return;
    if (!github?.connected) {
      router.push("/api/github/login?returnTo=/");
      return;
    }
    setPublishing(true);
    const loading = toast.loading("Creating pull request…");
    try {
      const response = await fetch("/api/github/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          git: active.git,
          diff,
          title: sessionTitle(active),
        }),
      });
      const result = (await response.json()) as {
        number?: number;
        url?: string;
        error?: string;
      };
      if (!response.ok || !result.number || !result.url) {
        throw new Error(result.error || "Could not create the pull request.");
      }
      await updateSession({
        id: active.id as never,
        PRNumber: result.number,
        prUrl: result.url,
      });
      toast.success(`Pull request #${result.number} created.`, { id: loading });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the pull request.", { id: loading });
    } finally {
      setPublishing(false);
    }
  }

  async function archiveSession() {
    if (
      !active ||
      !window.confirm("Archive this session? It will be hidden from the list.")
    )
      return;
    try {
      await updateSession({
        id: active.id as never,
        archived: true,
      });
      selectSession(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not archive session.");
    }
  }

  const tabs: { id: "diff"; label: string; icon: LucideIcon }[] = [
    { id: "diff", label: "Diffs", icon: FileDiff },
  ];
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (collapsedPane) return;
    resizing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resizePane = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing.current) return;
    const next = ((window.innerWidth - event.clientX) / window.innerWidth) * 100;
    setPaneWidth(Math.min(60, Math.max(25, next)));
  };
  const endResize = () => {
    resizing.current = false;
  };

  return (
    <main className="flex h-screen overflow-hidden">
      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-10 flex h-10 shrink-0 items-center justify-between border-b px-2 sm:px-3">
          <Tooltip>
            <TooltipTrigger render={<SidebarTrigger />} />
            <TooltipContent>Toggle sidebar</TooltipContent>
          </Tooltip>
          <div className="flex items-center gap-2 text-sm font-medium">
            {active && (
                <span className="max-w-64 truncate">
                  {sessionTitle(active)}
                </span>
            )}
          </div>
          {active && (
            <div className="flex items-center gap-0.5">
              {!legacy && (
                <span className="mr-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("size-1.5 rounded-full", active.status === "running" ? "bg-emerald-500" : "bg-muted-foreground")} />
                  {active.status === "running" ? "Working" : "Idle"}
                </span>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Archive session"
                      onClick={archiveSession}>
                      <Archive />
                    </Button>
                  }
                />
                <TooltipContent>Archive session</TooltipContent>
              </Tooltip>
            </div>
          )}
        </header>
        {!active && (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6">
            <span className="flex size-9 items-center justify-center rounded-lg border bg-background">
              <Command className="size-4 text-muted-foreground" />
            </span>
            <div className="max-w-sm text-center">
              <h1 className="text-sm font-medium">No session selected</h1>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Select a session from the sidebar, or start a new project.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => router.push("/new")}>
              New project
            </Button>
          </div>
        )}
        {active && (
          <section className="flex min-h-0 w-full flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r">
                {canChat ? (
                  <Chat key={active.id} session={active} />
                ) : (
                  <div className="min-h-0 flex-1 w-full overflow-y-auto scrollbar-none">
                    <div className="mx-auto max-w-2xl space-y-4 px-4 py-4 sm:px-6">
                      {legacyTranscript.length === 0 && (
                        <div className="pt-8">
                          <h2 className="text-base font-medium tracking-tight">
                            Session not started
                          </h2>
                          <p className="mt-1 text-sm leading-5 text-muted-foreground">
                            This session has no live agent. Start a new session
                            from the project page.
                          </p>
                        </div>
                      )}
                      {legacyTranscript.map((m, index) => (
                        <Message
                          key={`${m.id || "message"}-${index}`}
                          message={m}
                          streaming={false}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {!collapsedPane && (
                <div
                  role="separator"
                  aria-label="Resize workspace pane"
                  aria-orientation="vertical"
                  onPointerDown={beginResize}
                  onPointerMove={resizePane}
                  onPointerUp={endResize}
                  className="w-px shrink-0 cursor-col-resize bg-border hover:bg-foreground/30"
                />
              )}
              <aside
                style={{ width: collapsedPane ? "2.5rem" : `${paneWidth}%` }}
                className="flex min-h-0 min-w-0 shrink-0 flex-col bg-background">
                <div className="flex h-9 shrink-0 items-center gap-0.5 border-b px-1">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={collapsedPane ? "Expand workspace pane" : "Collapse workspace pane"}
                          onClick={() => setCollapsedPane((value) => !value)}>
                          {collapsedPane ? <PanelRightOpen /> : <PanelRightClose />}
                        </Button>
                      }
                    />
                    <TooltipContent>{collapsedPane ? "Expand panel" : "Collapse panel"}</TooltipContent>
                  </Tooltip>
                  {!collapsedPane && (
                    <>
                      {tabs.map(({ id, label, icon: Icon }) => (
                        <Button key={id} size="sm" variant={view === id ? "outline" : "ghost"} onClick={() => setView(id)}>
                          <Icon className="size-3.5" />{label}
                        </Button>
                      ))}
                      <div className="flex-1" />
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Download patch"
                              disabled={!diff}
                              onClick={downloadPatch}>
                              <Download />
                            </Button>
                          }
                        />
                        <TooltipContent>Download patch</TooltipContent>
                      </Tooltip>
                      {active?.prUrl ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(active.prUrl, "_blank", "noopener,noreferrer")}>
                          <ExternalLink />PR #{active.PRNumber}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={!diff || publishing || github === undefined}
                          onClick={publishChanges}>
                          {publishing ? <LoaderCircle className="animate-spin" /> : <IconBrandGithub />}
                          {github?.connected ? "Create PR" : "Connect GitHub"}
                        </Button>
                      )}
                    </>
                  )}
                </div>
                <div
                  className={cn(
                    "min-h-0 min-w-0 flex-1 flex-col",
                    !collapsedPane && view === "diff" ? "flex" : "hidden",
                  )}>
                  <ScrollArea
                    aria-label="Git changes"
                    className="min-h-0 flex-1">
                    {diffFiles.length > 0 ? (
                      <div className="">
                        {diffFiles.map((filePatch, index) => {
                          const fileName = filePatch.match(/^diff --git a\/(.*?) b\//m)?.[1] ?? `Changed file ${index + 1}`;
                          return (
                            <details key={`${fileName}-${index}`} open className="border-b">
                              <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground">
                                {fileName}
                              </summary>
                              <PatchDiff patch={filePatch} disableWorkerPool />
                            </details>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="p-3 text-sm text-muted-foreground">
                        No changes yet.
                      </p>
                    )}
                  </ScrollArea>
                </div>
              </aside>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

export default Home;
