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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
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
import { API, type Session, useSessionSelection } from "@/components/providers";
type View = "chat" | "activity" | "review" | "diff" | "terminal";
type AgentRun = { id: string; status: string; prompt: string; plan: Record<string, unknown>; branch?: string; baseBranch?: string; summary?: string; validationStatus?: string; prTitle?: string; prBody?: string };
type RunEvent = { id: string; sequence: number; type: string; status?: string; message: string; createdAt: string };

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

function ToolCall({ part }: { part: ToolPart }) {
  const name =
    part.toolName ||
    (part.type.startsWith("tool-") ? part.type.slice(5) : "tool");
  return (
    <div className="flex list-none items-center gap-2 font-medium">
      <TerminalIcon className="size-3.5 text-muted-foreground" />
      <span>{name}</span>
      <span className="ml-auto text-[10px] font-normal text-muted-foreground">
        {part.state?.replaceAll("-", " ") || "calling"}
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
  const user = message.role === "user";
  return (
    <article className={cn("flex gap-3", user ? "justify-end" : "items-start")}>
      {!user && (
        <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-background">
          <Code2 className="size-3.5" />
        </div>
      )}
      <div className={cn("min-w-0", user ? "max-w-[min(80%,42rem)]" : "max-w-3xl flex-1")}>
        <p className={cn("mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground", user && "text-right")}>
          {user ? "You" : streaming ? "OpenDevin · Working" : "OpenDevin"}
        </p>
        <div className={cn(
          "text-sm leading-7",
          user && "rounded-lg rounded-tr-sm bg-foreground px-4 py-2.5 leading-6 text-background",
        )}>
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
    </article>
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
      ws.onopen = () => instance.write("\\x1b[32m● connected\\x1b[0m\\r\\n");
      ws.onmessage = (event) => instance.write(String(event.data));
      ws.onerror = () => onError("Terminal connection failed.");
      ws.onclose = () => {
        if (!closed) {
          instance.write("\\r\\n\\x1b[33m● reconnecting…\\x1b[0m\\r\\n");
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
  const queryClient = useQueryClient();
  const router = useRouter();
  const { activeSessionId, selectSession } = useSessionSelection();
  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ["sessions"],
    queryFn: async () => {
      const response = await fetch(`${API}/sessions`);
      if (!response.ok) throw new Error("Could not load sessions");
      return response.json();
    },
    refetchInterval: 5000,
  });
  const active =
    sessions.find((session) => session.id === activeSessionId) ?? null;
  const [repo, setRepo] = useState("");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("chat");
  const [sandbox, setSandbox] = useState("unknown");
  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [runDiff, setRunDiff] = useState("");

  const bottom = useRef<HTMLDivElement>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API}/ai/${active?.id ?? "new-session"}`,
      }),
    [active?.id],
  );
  const { messages, setMessages, status, error } = useChat({
    transport,
    throttle: 40,
  });
  const working = status === "submitted" || status === "streaming";
  const sandboxRunning = sandbox === "running";
  const sandboxUnavailable = !sandboxRunning;
  const repoName =
    active?.git.split("/").pop()?.replace(".git", "") || "workspace";
  const alert = notice || error?.message;
  const runsQuery = useQuery<AgentRun[]>({
    queryKey: ["runs", active?.id],
    queryFn: async () => { const response = await fetch(`${API}/sessions/${active!.id}/runs`); if (!response.ok) throw new Error("Could not load runs."); return response.json(); },
    enabled: Boolean(active), refetchInterval: 2000,
  });
  const run = runsQuery.data?.[0];
  const runWorking = run && ["planning", "running", "validating"].includes(run.status);

  const messagesQuery = useQuery<UIMessage[]>({
    queryKey: ["messages", active?.id],
    queryFn: async () => {
      const response = await fetch(`${API}/sessions/${active!.id}/messages`);
      if (!response.ok) throw new Error("Could not load workspace messages.");
      return response.json();
    },
    enabled: Boolean(active),
  });
  useEffect(() => {
    setMessages(
      (messagesQuery.data || []).filter(
        (m) => m.role === "user" || m.role === "assistant",
      ),
    );
  }, [active?.id, messagesQuery.data, setMessages]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);
  useEffect(() => {
    if (active)
      fetch(`${API}/sessions/${active.id}/sandbox`)
        .then((r) => r.json())
        .then((data) => setSandbox(data.status || "unknown"))
        .catch(() => setSandbox("unknown"));
  }, [active]);
  useEffect(() => {
    if (!run?.id) {
      const reset = window.setTimeout(() => setRunEvents([]), 0);
      return () => window.clearTimeout(reset);
    }
    const source = new EventSource(`${API}/runs/${run.id}/events`);
    source.onmessage = (event) => { const next = JSON.parse(event.data) as RunEvent; setRunEvents((current) => current.some((item) => item.id === next.id) ? current : [...current, next]); queryClient.invalidateQueries({ queryKey: ["runs", active?.id] }); };
    source.addEventListener("complete", () => { source.close(); queryClient.invalidateQueries({ queryKey: ["runs", active?.id] }); });
    return () => source.close();
  }, [run?.id, active?.id, queryClient]);

  async function createSession(event: FormEvent) {
    event.preventDefault();
    if (!repo.trim()) return;
    setCreating(true);
    setNotice("");
    try {
      const response = await fetch(`${API}/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gitUrl: repo.trim() }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Could not create session");
      const next: Session = {
        id: data.sessionId,
        git: repo.trim(),
        status: "idle",
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      queryClient.setQueryData<Session[]>(["sessions"], (current = []) => [
        next,
        ...current,
      ]);
      selectSession(next.id);
      router.push(`/s/${next.id}`);
      setMessages([]);
      setRepo("");
    } catch (err) {
      setNotice(
        err instanceof Error ? err.message : "Could not create session",
      );
    } finally {
      setCreating(false);
    }
  }
  async function send(text = prompt) {
    if (!active || !text.trim() || working) return;
    if (!sandboxRunning) {
      setNotice(
        "This sandbox is not running. Start a new workspace to continue.",
      );
      return;
    }
    setPrompt("");
    setNotice("");
    try {
      const response = await fetch(`${API}/sessions/${active.id}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text.trim() }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message);
      setRunEvents([]); queryClient.invalidateQueries({ queryKey: ["runs", active.id] });
    } catch (err) { setNotice(err instanceof Error ? err.message : "Could not start run."); }
  }
  async function approveRun() { if (!run) return; const response = await fetch(`${API}/runs/${run.id}/approve`, { method: "POST" }); const data = await response.json(); if (!response.ok) setNotice(data.message); queryClient.invalidateQueries({ queryKey: ["runs", active?.id] }); }
  async function cancelRun() { if (!run) return; await fetch(`${API}/runs/${run.id}/cancel`, { method: "POST" }); queryClient.invalidateQueries({ queryKey: ["runs", active?.id] }); }
  async function loadRunDiff() { if (!run) return; const response = await fetch(`${API}/runs/${run.id}/diff`); const data = await response.json(); if (response.ok) setRunDiff(data.diff || ""); else setNotice(data.message); }
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
      sandbox === "stopped" ||
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
      setSandbox("stopped");
      setView("chat");
      queryClient.setQueryData<Session[]>(["sessions"], (all = []) =>
        all.map((s) => (s.id === active.id ? { ...s, status: "stopped" } : s)),
      );
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
      queryClient.setQueryData<Session[]>(["sessions"], (all = []) =>
        all.filter((s) => s.id !== active.id),
      );
      selectSession(null);
      setMessages([]);
    } catch (err) {
      setNotice(
        err instanceof Error ? err.message : "Could not archive session.",
      );
    }
  }
  useEffect(() => {
    if (active && view === "diff") window.setTimeout(() => void loadDiff(), 0);
  }, [active, view, loadDiff]);
  const tabs: { id: View; label: string; icon: typeof MessageSquareText; requiresSandbox?: boolean }[] = [
    { id: "chat", label: "Conversation", icon: MessageSquareText },
    { id: "activity", label: "Activity", icon: TerminalIcon },
    { id: "review", label: "Review", icon: FileDiff },
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
                  <Globe className="size-3" />
                </span>
                <span className="max-w-40 truncate">{repoName}</span>
              </div>
            )}
          </div>
          {active && (
            <div className="flex items-center gap-1">
              <Badge
                variant="outline"
                className="hidden gap-1.5 font-normal sm:flex">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    sandbox === "running"
                      ? "bg-emerald-500"
                      : sandbox === "stopped"
                        ? "bg-muted-foreground"
                        : "bg-amber-500",
                  )}
                />
                Sandbox {sandbox}
              </Badge>
              <Badge className="gap-1.5 font-normal">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    working
                      ? "animate-pulse bg-foreground"
                      : "bg-muted-foreground",
                  )}
                />
                {working ? "Agent working" : "Ready"}
              </Badge>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Stop sandbox"
                      disabled={!sandboxRunning || working}
                      onClick={stopSandbox}>
                      <Power />
                    </Button>
                  }
                />
                <TooltipContent>Stop sandbox</TooltipContent>
              </Tooltip>
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
            <div className="mb-6 flex w-fit items-center gap-2 rounded-full border border-foreground/10 bg-card px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Autonomous development
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              Give your codebase
              <span className="block text-muted-foreground">a second set of hands.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
              Connect a repository, describe the outcome, and follow every step
              your agent takes in a contained workspace.
            </p>
            <form
              onSubmit={createSession}
              className="mt-10 max-w-2xl rounded-lg border bg-card p-3">
              <label
                htmlFor="repository"
                className="mb-2 block px-1 text-xs font-medium">
                Repository URL
              </label>
              <div className="flex gap-2">
                <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border px-3">
                  <GitFork className="size-4 text-muted-foreground" />
                  <input
                    id="repository"
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder="https://github.com/owner/repository"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
                <Button type="submit" disabled={creating || !repo.trim()}>
                  {creating ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    "Connect"
                  )}
                </Button>
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
            <div className="flex h-9 items-center border-b px-4 sm:px-6">
              {tabs.map(({ id, label, icon: Icon, requiresSandbox }) => (
                <button
                  key={id}
                  disabled={Boolean(requiresSandbox && sandboxUnavailable)}
                  onClick={() => setView(id)}
                  className={cn(
                    "flex h-full items-center gap-2 border-b-2 border-transparent px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35",
                    view === id && "border-foreground text-foreground",
                  )}>
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
            {view === "chat" && (
              <>
                <div className="min-h-0 flex-1 w-full overflow-y-auto scrollbar-none">
                  <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-8">
                    {messages.length === 0 && (
                      <div className="mx-auto mt-[12vh] max-w-md text-center">
                        <div className="mx-auto grid size-14 place-items-center rounded-lg bg-foreground text-background">
                          <Code2 className="size-6" />
                        </div>
                        <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Workspace ready</p>
                        <h2 className="mt-2 text-xl font-semibold tracking-tight">
                          What are we building?
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          Describe the outcome you want. The agent will inspect
                          before it changes anything.
                        </p>
                        <div className="mt-5 grid gap-2">
                          {suggestions.map((s) => (
                            <Button
                              key={s}
                              variant="outline"
                              size="sm"
                              onClick={() => send(s)}>
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
                <div className="border-t bg-background px-4 pb-4 pt-3 sm:px-8">
                  <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-lg border bg-card p-2">
                  <Textarea
                    value={prompt}
                    disabled={sandboxUnavailable || Boolean(runWorking)}
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
                    className="min-h-9 border-0 py-2 bg-transparent disabled:bg-transparent  shadow-none focus-visible:ring-0"
                  />
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon"
                          aria-label={runWorking ? "Stop run" : "Start run"}
                          className="size-9 rounded-md"
                          onClick={() => (runWorking ? cancelRun() : send())}
                    disabled={
                      !runWorking && (!prompt.trim() || sandboxUnavailable)
                    }
                    variant={runWorking ? "destructive" : "default"}>
                          {runWorking ? <CircleStop /> : <SendHorizontal />}
                        </Button>
                      }
                    />
                    <TooltipContent>{working ? "Stop response" : "Send message"}</TooltipContent>
                  </Tooltip>
                  </div>
                  <p className="mx-auto mt-2 max-w-4xl px-1 text-[10px] text-muted-foreground">Enter to send · Shift + Enter for a new line</p>
                </div>
              </>
            )}
            {view === "activity" && (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
                <div className="mx-auto max-w-4xl">
                  <div className="mb-5 flex items-center justify-between">
                    <div><h2 className="text-lg font-semibold">Run activity</h2><p className="text-sm text-muted-foreground">{run ? `${run.status.replaceAll("_", " ")} · ${run.prompt}` : "Start a task to see durable activity."}</p></div>
                    {runWorking && <Button variant="destructive" size="sm" onClick={cancelRun}><CircleStop />Stop</Button>}
                  </div>
                  <div className="space-y-3 border-l pl-5">
                    {runEvents.map((event) => <article key={event.id} className="relative rounded-lg border bg-card p-3 text-sm"><span className="absolute -left-[1.72rem] top-4 size-2.5 rounded-full bg-emerald-500" /><div className="flex justify-between gap-4"><span className="font-medium">{event.message}</span><span className="shrink-0 text-xs text-muted-foreground">{event.status || event.type}</span></div></article>)}
                    {!runEvents.length && <p className="text-sm text-muted-foreground">Waiting for activity…</p>}
                  </div>
                </div>
              </div>
            )}
            {view === "review" && (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8"><div className="mx-auto max-w-4xl space-y-5">
                {!run ? <p className="text-sm text-muted-foreground">No autonomous run has been started in this workspace.</p> : <>
                  <section className="rounded-xl border bg-card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Run status</p><h2 className="mt-1 text-xl font-semibold capitalize">{run.status.replaceAll("_", " ")}</h2></div>{run.status === "awaiting_approval" && <Button onClick={approveRun} disabled={sandboxUnavailable}>Approve plan</Button>}{runWorking && <Button variant="destructive" onClick={cancelRun}><CircleStop />Stop</Button>}</div>
                    {run.branch && <p className="mt-4 font-mono text-xs">{run.branch} <span className="text-muted-foreground">from {run.baseBranch}</span></p>}</section>
                  {run.status === "awaiting_approval" && <section className="rounded-xl border bg-card p-5"><h3 className="font-semibold">Proposed plan</h3><pre className="mt-3 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">{JSON.stringify(run.plan, null, 2)}</pre></section>}
                  <section className="rounded-xl border bg-card p-5"><div className="flex items-center justify-between"><h3 className="font-semibold">Review evidence</h3><Button variant="outline" size="sm" onClick={loadRunDiff} disabled={sandboxUnavailable}><RefreshCw />Load diff</Button></div>{runDiff ? <div className="mt-4 overflow-hidden rounded border text-xs"><PatchDiff patch={runDiff} disableWorkerPool /></div> : <p className="mt-3 text-sm text-muted-foreground">Diff is available after execution completes.</p>}</section>
                  {run.summary && <section className="rounded-xl border bg-card p-5"><h3 className="font-semibold">Handoff</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{run.summary}</p><p className="mt-4 text-sm"><strong>PR title:</strong> {run.prTitle}</p><pre className="mt-2 whitespace-pre-wrap rounded bg-muted p-3 text-xs">{run.prBody}</pre></section>}
                </>}
              </div></div>
            )}
            {view === "diff" && (
              <div className="min-h-0 flex-1 px-4 py-4 sm:px-6">
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
                  className="h-[calc(100vh-10.5rem)] overflow-hidden rounded-lg border bg-card text-xs">
                  {diffLoading ? (
                    <p className="p-4 font-mono text-xs text-muted-foreground">
                      Loading changes…
                    </p>
                  ) : diff ? (
                    <PatchDiff patch={diff} disableWorkerPool />
                  ) : (
                    <p className="p-4 text-sm text-muted-foreground">
                      No uncommitted changes.
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
            {/* {alert && (
              <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {alert}
              </div>
            )} */}
          </section>
        )}
      </section>
    </main>
  );
}

export default Home;
