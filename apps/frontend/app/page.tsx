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
  ExternalLink,
  FileDiff,
  GitFork,
  Globe,
  LoaderCircle,
  MonitorPlay,
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
import { IconWorld } from '@tabler/icons-react';
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
type View = "preview" | "diff" | "terminal";

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
        <div className="max-w-[min(85%,34rem)] rounded-2xl rounded-br-md bg-foreground/5 px-4 py-2.5 text-sm leading-6 text-primary">
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
        <div className="text-sm leading-7">
          {message.parts.map((part, i) => {
            if (part.type === "text")
              return (
                <Streamdown
                  key={`${message.id}-${i}`}
                  mode={streaming ? "streaming" : "static"}
                  animate={streaming}
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
        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {streaming && <LoaderCircle className="size-3 animate-spin" />}
        </p>
      </div>
    </div>
  );
}

function BrowserPane({ sandboxId }: { sandboxId: string }) {
  const [port, setPort] = useState("3000");
  const [path, setPath] = useState("");
  const initial = `https://3000-${sandboxId}.e2b.app/`;
  const [address, setAddress] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = path.trim();
    const normalizedPath = value ? (value.startsWith("/") ? value : `/${value}`) : "/";
    const next = `https://${port.trim() || "3000"}-${sandboxId}.e2b.app/${normalizedPath}`;
    setAddress(next);
    setDraft(next);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <form onSubmit={submit} className="flex border-b p-2">
        <div className="border flex px-3 w-full rounded-xl items-center text-md font-mono">
          <IconWorld className="w-4 h-4 shrink-0 mr-2 text-muted-foreground" />
          <p className="select-none text-muted-foreground">http://localhost:</p>
          <input value={port} onChange={(event) => setPort(event.target.value.replace(/\D/g, ""))} inputMode="numeric" className="w-[4.2ch] outline-none" placeholder="port" />
          <p className="select-none text-muted-foreground">/</p>
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="home" className="outline-none w-full" />
        <Button type="submit" variant="link ">GO</Button>
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

  useEffect(() => {
    if (!host.current) return;
    const instance = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontSize: 15,
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

  return <div ref={host} className="h-full w-full" aria-label="Terminal" />;
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
  const activeId = active?.id;
  const [repo, setRepo] = useState("");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [noSandbox, setNoSandbox] = useState(false);
  const [view, setView] = useState<View>("preview");
  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
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
    if (!activeId) return;
    setDiffLoading(true);
    try {
      const response = await fetch(`${API}/sessions/${activeId}/diff`);
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
  }, [activeId]);
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
    if (activeId && view === "diff") {
      void loadDiff();
    }
  }, [activeId, loadDiff, view]);
  const tabs: { id: View; label: string; icon: typeof MessageSquareText; requiresSandbox?: boolean }[] = [
    { id: "preview", label: "Browser", icon: MonitorPlay, requiresSandbox: true },
    { id: "terminal", label: "Terminal", icon: TerminalIcon, requiresSandbox: true },
    { id: "diff", label: "Diffs", icon: FileDiff, requiresSandbox: true },
  ];

  return (
    <main className="flex h-screen overflow-hidden bg-[#f6f7f8] text-[#172027]">
      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f6f7f8]">
        <header className="z-10 flex h-14 shrink-0 items-center justify-between border-b border-black/10 bg-white px-3 sm:px-5">
          <Tooltip>
            <TooltipTrigger render={<SidebarTrigger />} />
            <TooltipContent>Toggle sidebar</TooltipContent>
          </Tooltip>
          <div className="flex items-center gap-2 text-md font-medium">
            {active && (
                <span className="max-w-64 truncate">
                  {sessionTitle(active)}
                </span>
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
        {active && (
          <section className="flex min-h-0 w-full flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-black/10">
                <div className="min-h-0 flex-1 w-full overflow-y-auto scrollbar-none">
                  <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-8">
                    {messages.length === 0 && (
                      <div className="mx-auto mt-[8vh] max-w-md text-center">
                        <div className="relative mx-auto grid size-16 place-items-center rounded-2xl bg-[#b9ea73] text-[#1d2915] shadow-[0_0_48px_rgba(120,180,60,.18)]">
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
                <div className="bg-[#f6f7f8] px-4 pb-4 sm:px-6">
                  <div className="mx-auto max-w-3xl">
                    <div className="flex items-end gap-2 rounded-2xl border border-black/10 bg-white p-2">
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
              <aside className="flex min-h-0 w-[min(44vw,620px)] min-w-[360px] flex-col bg-[#f1f3f4]">
                <div className="flex h-11 shrink-0 items-center gap-1 border-b border-black/10 px-2">
                  {tabs.filter((tab) => !chatOnly || !tab.requiresSandbox).map(({ id, label, icon: Icon, requiresSandbox }) => (
                    <Button key={id} variant={view === id ? "outline" : "ghost"} disabled={Boolean(requiresSandbox && sandboxUnavailable)} onClick={() => setView(id)}>
                      <Icon className="size-3.5" />{label}
                    </Button>
                  ))}
                </div>
                {view === "preview" && active && (
                  <BrowserPane sandboxId={active.sandbox ?? ""} />
                )}
                {view === "diff" && (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="m-2 flex items-center justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
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
                    <p className="p-4 text-sm text-muted-foreground">
                      Loading…
                    </p>
                  ) : diff ? (
                    <div className="">
                      {diffFiles.map((filePatch, index) => {
                        const fileName = filePatch.match(/^diff --git a\/(.*?) b\//m)?.[1] ?? `Changed file ${index + 1}`;
                        return (
                          <div key={`${fileName}-${index}`}>
                            {/*<div className="flex items-center gap-2 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              <Code2 className="size-3" />
                              {fileName}
                            </div>*/}
                            <PatchDiff fontFamily={"GeistMono"} patch={filePatch} disableWorkerPool />
                          </div>
                        );
                      })}
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
              <div className="flex min-h-0 flex-1 flex-col">
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
