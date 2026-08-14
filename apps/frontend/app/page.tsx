"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useChat } from "@ai-sdk/react";
import { useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { DefaultChatTransport, type UIMessage } from "ai";
import { PatchDiff } from "@pierre/diffs/react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import Markdown from 'react-markdown'
import {
  Archive,
  CircleStop,
  FileDiff,
  LoaderCircle,
  MonitorPlay,
  PanelRightClose,
  PanelRightOpen,
  Power,
  RefreshCw,
  SendHorizontal,
  ChevronDown,
  ChevronUp,
  Terminal as TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { IconWorld } from '@tabler/icons-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  API,
  mapSessions,
  sessionTitle,
  useSessionSelection,
} from "@/components/providers";
import { api } from "@convex/_generated/api";
type View = "preview" | "diff" | "terminal";

type ToolPart = {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

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
  const status = error ? "Failed" : done ? "Completed" : "Running";
  const input = toolValue(part.input);
  const output = toolValue(part.errorText ?? part.output);
  const verb = name === "run_command" ? "Running command" : `Using ${name}`;

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
  message: UIMessage;
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
    (part) => part.type.startsWith("tool-") || part.type === "dynamic-tool",
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
                  ) : part.type.startsWith("tool-") || part.type === "dynamic-tool" ? (
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
                    {part.text}
                  </Markdown>
                </div>
              );
            if (part.type.startsWith("tool-") || part.type === "dynamic-tool")
              return (
                <ToolCall key={`${message.id}-${i}`} part={part as ToolPart} />
              );
            return null;
          })}
        </div>
        {streaming && (
          <p className="mt-1 flex items-center text-muted-foreground">
            <LoaderCircle className="size-3 animate-spin" />
          </p>
        )}
      </div>
    </div>
  );
}

function BrowserPane({ sandboxId }: { sandboxId: string }) {
  const [port, setPort] = useState("3000");
  const [path, setPath] = useState("");
  const initial = `https://3000-${sandboxId}.e2b.app/`;
  const [address, setAddress] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = path.trim();
    const normalizedPath = value ? (value.startsWith("/") ? value : `/${value}`) : "/";
    const next = `https://${port.trim() || "3000"}-${sandboxId}.e2b.app/${normalizedPath}`;
    setAddress(next);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <form onSubmit={submit} className="flex border-b px-2 py-1.5">
        <div className="flex h-7 w-full items-center rounded-md border px-2 font-mono text-xs">
          <IconWorld className="mr-1.5 size-3.5 shrink-0 text-muted-foreground" />
          <p className="select-none text-muted-foreground">localhost:</p>
          <input value={port} onChange={(event) => setPort(event.target.value.replace(/\D/g, ""))} inputMode="numeric" className="w-[4.2ch] bg-transparent outline-none" placeholder="port" />
          <p className="select-none text-muted-foreground">/</p>
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="home" className="w-full bg-transparent outline-none" />
        <Button type="submit" variant="ghost" size="xs" className="ml-1 h-5 px-1.5 text-[10px]">Go</Button>
        {/*<a href={address} target="_blank" rel="noreferrer" aria-label="Open preview in new tab" className="rounded p-1.5 text-[#879099] hover:bg-black/5"><ExternalLink className="size-3.5" /></a>*/}
        </div>
      </form>
      <div className="min-h-0 flex-1">
        <iframe key={address} src={address} title="Sandbox web preview" className="h-full w-full" />
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
  const connectRef = useRef<() => void>(() => undefined);
  const reconnectTimer = useRef<number | undefined>(undefined);
  const manualReconnect = useRef(false);
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("connecting");

  useEffect(() => {
    if (!host.current) return;
    const instance = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontSize: 13,
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(host.current);
    fit.fit();
    terminal.current = instance;

    let closed = false;
    const connect = () => {
      if (closed) return;
      setConnection("connecting");
      const base = API.replace(/^http/, "ws");
      const ws = new WebSocket(`${base}/sessions/${sessionId}/terminal/ws`);
      socket.current = ws;
      ws.onopen = () => instance.write("\x1b[32m● connected\x1b[0m\r\n");
      ws.onopen = () => {
        instance.reset();
        setConnection("connected");
      };
      ws.onmessage = (event) => instance.write(String(event.data));
      ws.onerror = () => {
        setConnection("disconnected");
        onError("Terminal connection failed.");
      };
      ws.onclose = () => {
        if (!closed) {
          setConnection("disconnected");
          instance.write("\r\n\x1b[33m● reconnecting…\x1b[0m\r\n");
          reconnectTimer.current = window.setTimeout(
            connect,
            manualReconnect.current ? 0 : 1200,
          );
          manualReconnect.current = false;
        }
      };
    };
    connectRef.current = connect;
    const send = (data: string) => {
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ type: "input", data }));
    };
    const input = instance.onData(send);
    const resize = () => fit.fit();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host.current);
    window.addEventListener("resize", resize);
    connect();
    return () => {
      closed = true;
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      input.dispose();
      socket.current?.close();
      connectRef.current = () => undefined;
      instance.dispose();
      terminal.current = null;
    };
  }, [sessionId, onError]);

  const reconnect = () => {
    if (socket.current?.readyState === WebSocket.CONNECTING) return;
    if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
    manualReconnect.current = true;
    if (socket.current && socket.current.readyState !== WebSocket.CLOSED)
      socket.current.close();
    else connectRef.current();
  };

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="h-full w-full pt-7" aria-label="Terminal" />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={reconnect}
        disabled={connection === "connecting"}
        className="absolute right-1.5 top-1 h-6 px-1.5">
        <RefreshCw className={cn("size-3", connection === "connecting" && "animate-spin")} />
        Reconnect
      </Button>
    </div>
  );
}

export function Home() {
  const { activeSessionId, selectSession } = useSessionSelection();
  const sessions = mapSessions(
    useConvexQuery(api.sessions.list, {}) as unknown[] | undefined,
  );
  const active =
    sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeId = active?.id;
  const [prompt, setPrompt] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("preview");
  const [collapsedPane, setCollapsedPane] = useState(false);
  const [paneWidth, setPaneWidth] = useState(40);
  const resizing = useRef(false);
  const diffQuery = useQuery({
    queryKey: ["session-diff", activeId],
    enabled: Boolean(activeId && view === "diff"),
    staleTime: 5_000,
    queryFn: async () => {
      const response = await fetch(`${API}/sessions/${activeId}/diff`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not load Git diff.");
      return String(data.diff || "");
    },
  });
  const diff = diffQuery.data ?? "";
  const diffLoading = diffQuery.isFetching;
  const { refetch: refetchDiff } = diffQuery;
  const diffFiles = useMemo(
    () => (diff ? diff.split(/(?=^diff --git )/m).filter(Boolean) : []),
    [diff],
  );
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
  const sessionStopped = active?.status === "stopped";
  const canChat = Boolean(active) && !sessionStopped;
  const sandboxUnavailable = sessionStopped;
  const busy = working || active?.status === "running";
  const activityLabel = active?.status === "running" ? "Working" : active?.status ?? "Idle";
  const activityDot = active?.status === "running" ? "bg-emerald-500" : "bg-muted-foreground";

  const messagesData = useConvexQuery(api.sessions.messages, active ? { sessionId: active.id as never } : "skip") as UIMessage[] | undefined;
  useEffect(() => {
    // Convex contains the last completed transcript. Never let its reactive
    // update replace the message currently being streamed by useChat.
    if (working || active?.status === "running" || !messagesData) return;
    setMessages(
      messagesData.filter(
        (m) => m.role === "user" || m.role === "assistant",
      ),
    );
  }, [active?.id, active?.status, messagesData, setMessages, working]);
  useEffect(() => {
    if (!notice) return;
    toast.error(notice);
    queueMicrotask(() => setNotice(""));
  }, [notice]);
  useEffect(() => {
    if (!error?.message) return;
    toast.error(error.message);
  }, [error?.message]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, status]);

  async function stopAgent() {
    if (!active) return;
    // Close the SSE stream immediately, then tell the backend to abort the
    // model/tool loop that may still be running server-side.
    stop();
    try {
      const response = await fetch(`${API}/sessions/${active.id}/stop`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Could not stop the agent.");
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not stop the agent.");
    }
  }

  const send = useCallback(async (text = prompt) => {
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
  }, [active, canChat, prompt, sendMessage, working]);
  useEffect(() => {
    if (!active || working) return;
    const initialPrompt = window.sessionStorage.getItem("opendevin:initial-prompt");
    if (!initialPrompt) return;
    window.sessionStorage.removeItem("opendevin:initial-prompt");
    queueMicrotask(() => void send(initialPrompt));
  }, [active, active?.id, send, working]);
  const loadDiff = useCallback(async () => {
    const result = await refetchDiff();
    if (result.error)
      setNotice(
        result.error instanceof Error ? result.error.message : "Could not load Git diff.",
      );
  }, [refetchDiff]);
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
      setView("preview");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not stop sandbox.");
    }
  }
  async function restartSandbox() {
    if (!active || !sessionStopped) return;
    try {
      const response = await fetch(`${API}/sessions/${active.id}/restart`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      toast.success("Sandbox restarted", {
        description: "A fresh workspace is ready from the repository source.",
      });
      setView("preview");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not restart sandbox.");
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
  const tabs: { id: View; label: string; icon: LucideIcon; requiresSandbox?: boolean }[] = [
    { id: "preview", label: "Browser", icon: MonitorPlay, requiresSandbox: true },
    { id: "terminal", label: "Terminal", icon: TerminalIcon, requiresSandbox: true },
    { id: "diff", label: "Diffs", icon: FileDiff, requiresSandbox: true },
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
              <span className="mr-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("size-1.5 rounded-full", activityDot)} />
                {activityLabel}
              </span>
              {sessionStopped ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Restart sandbox"
                        onClick={restartSandbox}>
                        <RefreshCw />
                      </Button>
                    }
                  />
                  <TooltipContent>Restart sandbox</TooltipContent>
                </Tooltip>
              ) : (
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
        {!active && (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-sm text-center">
              <h1 className="text-sm font-medium">No session selected</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose a session in the sidebar, or start a new one.
              </p>
            </div>
          </div>
        )}
        {active && (
          <section className="flex min-h-0 w-full flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r">
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
                        streaming={(working || active?.status === "running") && m.id === messages.at(-1)?.id}
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
                        disabled={!canChat || Boolean(busy)}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            send();
                          }
                        }}
                        placeholder={
                          sandboxUnavailable
                            ? "Sandbox unavailable"
                            : "Ask OpenDevin to investigate, build, or fix…"
                        }
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
                  </div>
                </div>
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
                  {!collapsedPane && <>
                  {tabs.map(({ id, label, icon: Icon, requiresSandbox }) => (
                    <Button key={id} size="sm" variant={view === id ? "outline" : "ghost"} disabled={Boolean(requiresSandbox && sandboxUnavailable)} onClick={() => setView(id)}>
                      <Icon className="size-3.5" />{label}
                    </Button>
                  ))}
                  </>}
                </div>
                {active && !sandboxUnavailable && (
                  <div
                    className={cn(
                      "min-h-0 min-w-0 flex-1 flex-col",
                      !collapsedPane && view === "preview" ? "flex" : "hidden",
                    )}>
                    <BrowserPane sandboxId={active.sandbox ?? ""} />
                  </div>
                )}
                <div
                  className={cn(
                    "min-h-0 min-w-0 flex-1 flex-col",
                    !collapsedPane && view === "diff" ? "flex" : "hidden",
                  )}>
                <div className="flex items-center justify-end px-1.5 py-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={loadDiff}
                    disabled={diffLoading || sandboxUnavailable}>
                    {diffLoading ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <RefreshCw />
                    )}
                  </Button>
                </div>
                <ScrollArea
                  aria-label="Git changes"
                  className="min-h-0 flex-1">
                  {diffLoading ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      Loading…
                    </p>
                  ) : diff ? (
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
                {active && !sandboxUnavailable && (
                  <div
                    className={cn(
                      "min-h-0 min-w-0 flex-1 flex-col",
                      !collapsedPane && view === "terminal" ? "flex" : "hidden",
                    )}>
                  <TerminalPane
                    sessionId={active.id}
                    onError={setNotice}
                  />
                  </div>
                )}
              </aside>
            </div>

{/*
              sonner for alerts fucker
              {alert && (
              <div className="mx-auto mt-2 mb-4 w-full max-w-3xl rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {alert}
              </div>
            )}*/}
          </section>
        )}
      </section>
    </main>
  );
}

export default Home;
