"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChat } from "@ai-sdk/react";
import { useQuery as useConvexQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DefaultChatTransport, type UIMessage } from "ai";
import { PatchDiff } from "@pierre/diffs/react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Streamdown } from "streamdown";
import {
  Archive,
  CircleStop,
  Code2,
  FileDiff,
  GitFork,
  Globe,
  LoaderCircle,
  MessageSquareText,
  Power,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  Terminal as TerminalIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  API,
  sessionTitle,
  type Session,
  useSessionSelection,
} from "@/components/providers";
import { api } from "@convex/_generated/api";
type View = "chat" | "diff" | "terminal";

const suggestions = [
  "Map the architecture and key risks",
  "Add coverage for the authentication flow",
  "Find and fix the failing build",
];

type ToolPart = {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const TOOL_DONE_STATES = new Set([
  "output-available",
  "output-denied",
  "successful-parse",
  "complete",
  "done",
]);
const TOOL_ERROR_STATES = new Set([
  "output-error",
  "failed-parse",
  "error",
]);

function ToolCall({ part }: { part: ToolPart }) {
  const name =
    part.toolName ||
    (part.type.startsWith("tool-") ? part.type.slice(5) : "tool");
  const done = Boolean(part.state && TOOL_DONE_STATES.has(part.state));
  const error = Boolean(part.state && TOOL_ERROR_STATES.has(part.state));
  return (
    <div className="mb-2 flex items-center gap-2">
      <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <code className="min-w-0 truncate font-mono text-xs">{name}</code>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide">
        <span
          className={cn(
            "size-1.5 rounded-full",
            error
              ? "bg-destructive"
              : done
                ? "bg-emerald-500"
                : "animate-pulse bg-amber-500",
          )}
        />
      </span>
    </div>
  );
}

function Message({
  message,
  streaming,
}: {
  message: UIMessage;
  streaming: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[min(85%,34rem)] rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm leading-6 text-background">
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
        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {streaming && <LoaderCircle className="size-3 animate-spin" />}
        </p>
        <div className="text-sm leading-7">
          {message.parts.map((part, i) => {
            if (part.type === "text")
              return (
                <Streamdown
                  key={`${message.id}-${i}`}
                  mode={streaming ? "streaming" : "static"}
                  className="typeset typeset-docs">
                  {part.text}
                </Streamdown>
              );
            if (part.type.startsWith("tool-") || part.type === "dynamic-tool")
              return (
                <ToolCall key={`${message.id}-${i}`} part={part as ToolPart} />
              );
            return null;
          })}
        </div>
      </div>
    </div>
  );
}

function TerminalPane({
  sessionId,
  onError,
}: {
  sessionId: string;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<XTerm | null>(null);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const instance = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      fontSize: 13,
      theme: {
        background: "#101311",
        foreground: "#e7e5e4",
        cursor: "#34d399",
        selectionBackground: "#365314",
      },
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(host.current);
    fit.fit();
    terminal.current = instance;

    let closed = false;
    let reconnect: number | undefined;
    const connect = () => {
      if (closed) return;
      const base = API.replace(/^http/, "ws");
      const ws = new WebSocket(`${base}/sessions/${sessionId}/terminal/ws`);
      socket.current = ws;
      ws.onopen = () => instance.write("\x1b[32m● connected\x1b[0m\r\n");
      ws.onmessage = (event) => instance.write(String(event.data));
      ws.onerror = () => onError("Terminal connection failed.");
      ws.onclose = () => {
        if (!closed) {
          instance.write("\r\n\x1b[33m● reconnecting…\x1b[0m\r\n");
          reconnect = window.setTimeout(connect, 1200);
        }
      };
    };
    const send = (data: string) => {
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ type: "input", data }));
    };
    const input = instance.onData(send);
    const resize = () => fit.fit();
    window.addEventListener("resize", resize);
    connect();
    return () => {
      closed = true;
      if (reconnect) window.clearTimeout(reconnect);
      window.removeEventListener("resize", resize);
      input.dispose();
      socket.current?.close();
      instance.dispose();
      terminal.current = null;
    };
  }, [sessionId, onError]);

  return <div ref={host} className="h-full w-full p-3" aria-label="Terminal" />;
}

export function Home() {
  const router = useRouter();
  const { activeSessionId, selectSession } = useSessionSelection();
  const sessions = ((useConvexQuery(api.sessions.list, {}) ?? []) as unknown as Array<Record<string, unknown>>).map((session) => ({
    ...session,
    id: String(session.id ?? session._id),
    createdAt: new Date(Number(session.createdAt)).toISOString(),
    updatedAt: new Date(Number(session.updatedAt)).toISOString(),
  })) as Session[];
  const active =
    sessions.find((session) => session.id === activeSessionId) ?? null;
  const [repo, setRepo] = useState("");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [noSandbox, setNoSandbox] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);

  const bottom = useRef<HTMLDivElement>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API}/ai/${active?.id ?? "new-session"}`,
      }),
    [active?.id],
  );
  const { messages, setMessages, status, error, sendMessage, stop } = useChat({
    transport,
    throttle: 40,
  });
  const working = status === "submitted" || status === "streaming";
  const chatOnly = Boolean(active && !active.sandbox);
  const sessionStopped = active?.status === "stopped";
  const canChat = Boolean(active) && !sessionStopped;
  const sandboxUnavailable = !chatOnly && sessionStopped;
  const repoName =
    active?.git.split("/").pop()?.replace(".git", "") || "Workspace";
  const alert = notice || error?.message;
  const busy = working || active?.status === "running";
  const activityLabel = active?.status === "running" ? "Working" : active?.status ?? "Idle";
  const activityDot = active?.status === "running" ? "animate-pulse bg-emerald-500" : "bg-muted-foreground";

  const messagesData = useConvexQuery(api.sessions.messages, active ? { sessionId: active.id as never } : "skip") as UIMessage[] | undefined;
  useEffect(() => {
    setMessages(
      (messagesData || []).filter(
        (m) => m.role === "user" || m.role === "assistant",
      ),
    );
  }, [active?.id, messagesData, setMessages]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  async function createSession(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) return;
    setCreating(true);
    setNotice("");
    const creatingToast = noSandbox
      ? undefined
      : toast.loading("Starting sandbox…", {
          description: "Spinning up an isolated workspace.",
        });
    try {
      const response = await fetch(`${API}/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          sandbox: !noSandbox,
          ...(repo.trim() ? { gitUrl: repo.trim() } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Could not create session");
      const next: Session = {
        id: data.sessionId,
        git: data.gitUrl || repo.trim(),
        status: "idle",
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (creatingToast)
        toast.success("Workspace started", {
          id: creatingToast,
          description: noSandbox ? "Chat session created." : "Sandbox is provisioning.",
        });
      selectSession(next.id);
      router.push(`/s/${next.id}`);
      setMessages([]);
      setRepo("");
      setPrompt("");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not create session";
      if (creatingToast) toast.error(message, { id: creatingToast });
      setNotice(message);
    } finally {
      setCreating(false);
    }
  }
  async function send(text = prompt) {
    if (!active || !text.trim() || working) return;
    if (!canChat) {
      setNotice(
        "This session has been stopped. Start a new workspace to continue.",
      );
      return;
    }
    setPrompt("");
    setNotice("");
    try {
      await sendMessage({ text: text.trim() });
    } catch (err) {
      setNotice(
        err instanceof Error ? err.message : "Could not send message.",
      );
    }
  }
  const loadDiff = useCallback(async () => {
    if (!active) return;
    setDiffLoading(true);
    try {
      const response = await fetch(`${API}/sessions/${active.id}/diff`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setDiff(data.diff || "");
    } catch (err) {
      setNotice(
        err instanceof Error ? err.message : "Could not load Git diff.",
      );
    } finally {
      setDiffLoading(false);
    }
  }, [active]);
  async function stopSandbox() {
    if (
      !active ||
      sessionStopped ||
      !window.confirm(
        "Stop this sandbox? Its files and terminal will no longer be available.",
      )
    )
      return;
    try {
      const response = await fetch(`${API}/sessions/${active.id}/stop`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setView("chat");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not stop sandbox.");
    }
  }
  async function archiveSession() {
    if (
      !active ||
      !window.confirm("Archive this session? Its sandbox will be stopped.")
    )
      return;
    try {
      const response = await fetch(`${API}/sessions/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      selectSession(null);
      setMessages([]);
    } catch (err) {
      setNotice(
        err instanceof Error ? err.message : "Could not archive session.",
      );
    }
  }
  useEffect(() => {
    if (active && view === "diff") {
      const timer = window.setTimeout(() => {
        void loadDiff();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, view]);
  const tabs: { id: View; label: string; icon: typeof MessageSquareText; requiresSandbox?: boolean }[] = [
    { id: "chat", label: "Conversation", icon: MessageSquareText },
    { id: "diff", label: "Changes", icon: FileDiff, requiresSandbox: true },
    { id: "terminal", label: "Terminal", icon: TerminalIcon, requiresSandbox: true },
  ];

  return (
    <main className="flex h-screen bg-background">
      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-10 flex h-14 shrink-0 items-center justify-between border-b bg-background px-3 sm:px-5">
          <Tooltip>
            <TooltipTrigger render={<SidebarTrigger />} />
            <TooltipContent>Toggle sidebar</TooltipContent>
          </Tooltip>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {active && (
              <div className="flex w-fit items-center gap-2 font-medium text-foreground">
                <span className="grid size-6 place-items-center rounded-md border bg-card">
                  {chatOnly ? (
                    <MessageSquareText className="size-3" />
                  ) : (
                    <Globe className="size-3" />
                  )}
                </span>
                <span className="max-w-40 truncate">
                  {sessionTitle(active)}
                </span>
              </div>
            )}
          </div>
          {active && (
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="gap-1.5 font-normal">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    activityDot,
                  )}
                />
                {activityLabel}
              </Badge>
              {!chatOnly && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Stop sandbox"
                        disabled={sessionStopped || busy}
                        onClick={stopSandbox}>
                        <Power />
                      </Button>
                    }
                  />
                  <TooltipContent>Stop sandbox</TooltipContent>
                </Tooltip>
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
        {!active ? (
          <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-5 py-16 sm:px-10">
            <h1 className="flex max-w-3xl text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              Open
              <span className="block text-muted-foreground">devin.</span>
            </h1>
            <form
              onSubmit={createSession}
              className="mt-10 max-w-2xl rounded-lg border bg-card p-3">
              <Textarea
                id="session-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the change, question, or task…"
                rows={3}
                className="resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              <div className="flex gap-2 px-4">
                {!noSandbox && (
                  <div className="flex h-10 flex-1 items-center gap-2">
                    <GitFork className="size-4 text-muted-foreground" />
                    <input
                      id="repository"
                      value={repo}
                      onChange={(e) => setRepo(e.target.value)}
                      placeholder="Optional repository URL"
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    />
                  </div>
                )}
                <Button type="submit" disabled={creating || !prompt.trim()} variant={"ghost"}>
                  {creating ? (
                    <LoaderCircle className="animate-spin" />
                  ) : noSandbox ? (
                    "Start chat"
                  ) : (
                    "Start workspace"
                  )}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-2">
                <label className="flex cursor-pointer items-center gap-2 select-none text-xs text-muted-foreground">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={noSandbox}
                    onClick={() => setNoSandbox((value) => !value)}
                    className={cn(
                      "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 outline-none",
                      noSandbox
                        ? "border-transparent bg-foreground"
                        : "border-input bg-muted",
                    )}>
                    <span
                      className={cn(
                        "size-3 rounded-full bg-background shadow transition-transform",
                        noSandbox ? "translate-x-3.5" : "translate-x-0.5",
                      )}
                    />
                  </button>
                  Chat without a sandbox
                </label>
                {noSandbox && (
                  <span className="text-[10px] text-muted-foreground">
                    No E2B sandbox · general assistant
                  </span>
                )}
              </div>
            </form>
            {alert && (
              <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {alert}
              </div>
            )}
          </section>
        ) : (
          <section className="flex min-h-0 w-full flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center justify-center border-b px-4 sm:px-6">
              <div className="inline-flex items-center gap-1 rounded-full border bg-muted/40 p-1">
                {tabs
                  .filter((tab) => !chatOnly || !tab.requiresSandbox)
                  .map(({ id, label, icon: Icon, requiresSandbox }) => (
                  <button
                    key={id}
                    disabled={Boolean(requiresSandbox && sandboxUnavailable)}
                    onClick={() => setView(id)}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35",
                      view === id && "bg-foreground text-background shadow-sm",
                    )}>
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {view === "chat" && (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 w-full overflow-y-auto scrollbar-none">
                  <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-8">
                    {messages.length === 0 && (
                      <div className="mx-auto mt-[8vh] max-w-md text-center">
                        <div className="relative mx-auto grid size-16 place-items-center rounded-2xl bg-foreground text-background shadow-lg">
                          <Code2 className="size-7" />
                          <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border bg-background text-foreground">
                            <Sparkles className="size-3" />
                          </span>
                        </div>
                        <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          {chatOnly ? "Chat ready" : "Workspace ready"}
                        </p>
                        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                          {chatOnly ? "What can I help with?" : "What are we building?"}
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {chatOnly
                            ? "Ask about code, ideas, or refactors. No sandbox — just conversation and answers."
                            : "Describe the outcome you want. The agent will inspect the repository and make the changes directly."}
                        </p>
                        <div className="mx-auto mt-6 grid max-w-sm gap-2">
                          {suggestions.map((s) => (
                            <Button
                              key={s}
                              variant="outline"
                              className="justify-start rounded-xl px-3.5 text-left"
                              onClick={() => send(s)}>
                              <Sparkles className="size-3.5 text-muted-foreground" />
                              {s}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                    {messages.map((m) => (
                      <Message
                        key={m.id}
                        message={m}
                        streaming={working && m.id === messages.at(-1)?.id}
                      />
                    ))}
                    <div ref={bottom} />
                  </div>
                </div>
                <div className="bg-background px-4 pb-4 sm:px-6">
                  <div className="mx-auto max-w-3xl">
                    <div className="flex items-end gap-2 rounded-2xl border bg-card p-2">
                      <Textarea
                        value={prompt}
                        disabled={!canChat || Boolean(busy)}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            send();
                          }
                        }}
                        placeholder={
                          chatOnly
                            ? "Ask OpenDevin anything…"
                            : sandboxUnavailable
                              ? "Sandbox unavailable"
                              : "Ask OpenDevin to investigate, build, or fix…"
                        }
                        rows={1}
                        className="min-h-9 resize-none border-0 bg-transparent py-2 shadow-none focus-visible:ring-0 disabled:bg-transparent"
                      />
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-lg"
                              aria-label={busy ? "Stop" : "Send message"}
                              className="size-9 rounded-xl"
                              onClick={() => {
                                if (busy) void stop();
                                else send();
                              }}
                              disabled={
                                !busy && (!prompt.trim() || sandboxUnavailable)
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
                    <p className="mt-2 px-1 text-center text-[10px] text-muted-foreground">
                      Enter to send · Shift + Enter for a new line
                    </p>
                  </div>
                </div>
              </div>
            )}
            {view === "diff" && (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4 py-4 sm:px-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Changes</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadDiff}
                    disabled={diffLoading || sandboxUnavailable}>
                    {diffLoading ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <RefreshCw />
                    )}
                    Refresh
                  </Button>
                </div>
                <ScrollArea
                  aria-label="Git changes"
                  className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card text-xs">
                  {diffLoading ? (
                    <p className="p-4 font-mono text-xs text-muted-foreground">
                      Loading changes…
                    </p>
                  ) : diff ? (
                    <div className="divide-y">
                      <div>
                        <div className="flex items-center gap-2 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          <Code2 className="size-3" />
                          Workspace changes
                        </div>
                        <PatchDiff patch={diff} disableWorkerPool />
                      </div>
                    </div>
                  ) : (
                    <p className="p-4 text-sm text-muted-foreground">
                      No changes yet.
                    </p>
                  )}
                </ScrollArea>
              </div>
            )}
            {view === "terminal" && (
              <div className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Terminal · {repoName}
                  </h2>
                  <span className="text-[10px] text-emerald-600">LIVE / WS</span>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-[#101311]">
                  <TerminalPane
                    sessionId={active.id}
                    onError={setNotice}
                  />
                </div>
              </div>
            )}
            {alert && (
              <div className="mx-auto mt-2 mb-4 w-full max-w-3xl rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {alert}
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

export default Home;
