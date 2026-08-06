"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { PatchDiff } from "@pierre/diffs/react";
import { Streamdown } from "streamdown";
import { Archive, Bot, Box, CircleStop, Code2, Command, FileDiff, GitFork, LoaderCircle, MessageSquareText, Plus, Power, RefreshCw, SendHorizontal, Sparkles, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Session = { id: string; git: string; status: string; archived: boolean; createdAt: string; updatedAt: string };
type View = "chat" | "diff" | "terminal";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const suggestions = ["Map the architecture and key risks", "Add coverage for the authentication flow", "Find and fix the failing build"];

function Message({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  const user = message.role === "user";
  return <article className={cn("flex gap-3", user ? "ml-auto max-w-[85%] flex-row-reverse" : "max-w-3xl")}>
    {!user && <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground"><Bot className="size-4" /></div>}
    <div className="min-w-0 flex-1"><p className={cn("mb-1.5 text-[11px] font-medium text-muted-foreground", user && "text-right")}>{user ? "You" : streaming ? "OpenDevin · Thinking" : "OpenDevin"}</p>
      <div className={cn("text-sm leading-7", user && "rounded-xl rounded-tr-sm bg-muted px-4 py-2.5 leading-6")}>
        {message.parts.map((part, i) => part.type === "text" ? <Streamdown key={`${message.id}-${i}`} mode={streaming ? "streaming" : "static"} className="[&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3">{part.text}</Streamdown> : null)}
      </div>
    </div>
  </article>;
}

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [repo, setRepo] = useState("");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("chat");
  const [sandbox, setSandbox] = useState("unknown");
  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [terminal, setTerminal] = useState("");
  const [terminalInput, setTerminalInput] = useState("");
  const terminalOffset = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const transport = useMemo(() => new DefaultChatTransport({ api: `${API}/ai/${active?.id ?? "new-session"}` }), [active?.id]);
  const { messages, setMessages, sendMessage, status, stop, error } = useChat({ transport, throttle: 40 });
  const working = status === "submitted" || status === "streaming";
  const repoName = active?.git.split("/").pop()?.replace(".git", "") || "workspace";
  const alert = notice || error?.message;

  useEffect(() => { fetch(`${API}/sessions`).then((r) => r.ok ? r.json() : []).then(setSessions).catch(() => setNotice("Backend offline — start it with pnpm dev in backend.")); }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, status]);
  useEffect(() => { if (active) fetch(`${API}/sessions/${active.id}/sandbox`).then((r) => r.json()).then((data) => setSandbox(data.status || "unknown")).catch(() => setSandbox("unknown")); }, [active]);

  async function selectSession(session: Session) {
    setActive(session); setMessages([]); setView("chat"); setNotice("");
    try { const response = await fetch(`${API}/sessions/${session.id}/messages`); if (!response.ok) throw new Error("Could not load workspace messages."); const stored = await response.json() as UIMessage[]; setMessages(stored.filter((m) => m.role === "user" || m.role === "assistant")); }
    catch (err) { setNotice(err instanceof Error ? err.message : "Could not load workspace messages."); }
  }
  async function createSession(event: FormEvent) {
    event.preventDefault(); if (!repo.trim()) return; setCreating(true); setNotice("");
    try { const response = await fetch(`${API}/new`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gitUrl: repo.trim() }) }); const data = await response.json(); if (!response.ok) throw new Error(data.message || "Could not create session"); const next: Session = { id: data.sessionId, git: repo.trim(), status: "idle", archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; setSessions((current) => [next, ...current]); setActive(next); setMessages([]); setRepo(""); }
    catch (err) { setNotice(err instanceof Error ? err.message : "Could not create session"); } finally { setCreating(false); }
  }
  async function send(text = prompt) { if (!active || !text.trim() || working) return; if (sandbox === "stopped") { setNotice("This sandbox has been stopped. Archive the session or create a new workspace."); return; } setPrompt(""); setNotice(""); await sendMessage({ text: text.trim() }); }
  const loadDiff = useCallback(async () => { if (!active) return; setDiffLoading(true); try { const response = await fetch(`${API}/sessions/${active.id}/diff`); const data = await response.json(); if (!response.ok) throw new Error(data.message); setDiff(data.diff || ""); } catch (err) { setNotice(err instanceof Error ? err.message : "Could not load Git diff."); } finally { setDiffLoading(false); } }, [active]);
  async function stopSandbox() { if (!active || sandbox === "stopped" || !window.confirm("Stop this sandbox? Its files and terminal will no longer be available.")) return; try { const response = await fetch(`${API}/sessions/${active.id}/stop`, { method: "POST" }); const data = await response.json(); if (!response.ok) throw new Error(data.message); setSandbox("stopped"); setSessions((all) => all.map((s) => s.id === active.id ? { ...s, status: "stopped" } : s)); setActive((s) => s ? { ...s, status: "stopped" } : s); } catch (err) { setNotice(err instanceof Error ? err.message : "Could not stop sandbox."); } }
  async function archiveSession() { if (!active || !window.confirm("Archive this session? Its sandbox will be stopped.")) return; try { const response = await fetch(`${API}/sessions/${active.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: true }) }); const data = await response.json(); if (!response.ok) throw new Error(data.message); setSessions((all) => all.filter((s) => s.id !== active.id)); setActive(null); setMessages([]); } catch (err) { setNotice(err instanceof Error ? err.message : "Could not archive session."); } }
  async function submitTerminal(event: FormEvent) { event.preventDefault(); if (!active || !terminalInput) return; const input = `${terminalInput}\n`; setTerminalInput(""); try { const response = await fetch(`${API}/sessions/${active.id}/terminal/input`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) }); if (!response.ok) throw new Error((await response.json()).message); } catch (err) { setNotice(err instanceof Error ? err.message : "Could not send terminal input."); } }

  useEffect(() => { if (active && view === "diff") window.setTimeout(() => void loadDiff(), 0); }, [active, view, loadDiff]);
  useEffect(() => {
    if (!active || view !== "terminal") return;
    let cancelled = false; terminalOffset.current = 0; queueMicrotask(() => { if (!cancelled) setTerminal(""); });
    fetch(`${API}/sessions/${active.id}/terminal`, { method: "POST" }).then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.message); if (!cancelled) { setTerminal(data.output || ""); terminalOffset.current = (data.output || "").length; } }).catch((err) => !cancelled && setNotice(err instanceof Error ? err.message : "Could not open terminal."));
    const poll = window.setInterval(async () => { try { const r = await fetch(`${API}/sessions/${active.id}/terminal?offset=${terminalOffset.current}`); if (!r.ok) return; const data = await r.json(); if (!cancelled && data.output) setTerminal((current) => current + data.output); if (!cancelled) terminalOffset.current = data.offset; } catch { /* retain the last output while reconnecting */ } }, 700);
    return () => { cancelled = true; window.clearInterval(poll); };
  }, [active, view]);

  const tabs: { id: View; label: string; icon: typeof MessageSquareText }[] = [{ id: "chat", label: "Chat", icon: MessageSquareText }, { id: "diff", label: "Changes", icon: FileDiff }, { id: "terminal", label: "Terminal", icon: Terminal }];
  return <main className="flex min-h-screen bg-background">
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/20 p-3 lg:flex">
      <div className="flex h-11 items-center gap-2 px-2"><div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground"><Command className="size-4" /></div><span className="text-sm font-semibold tracking-tight">OpenDevin</span><Badge variant="outline" className="ml-auto text-[10px] font-normal">LOCAL</Badge></div>
      <div className="mt-6"><p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Sessions</p><Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={() => { setActive(null); setMessages([]); }}><Plus />New workspace</Button></div>
      <ScrollArea className="mt-3 min-h-0 flex-1"><div className="space-y-1 pr-2">{sessions.length === 0 ? <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">Connect a repository to give your agent a workspace.</p> : sessions.map((session) => <button key={session.id} onClick={() => selectSession(session)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted", active?.id === session.id && "bg-muted")}><span className={cn("size-1.5 rounded-full", session.status === "running" ? "bg-emerald-500" : session.status === "stopped" ? "bg-muted-foreground" : "bg-foreground")} /><span className="min-w-0"><strong className="block truncate text-xs font-medium">{session.git.split("/").pop()?.replace(".git", "")}</strong><small className="block pt-0.5 text-[10px] text-muted-foreground">{session.status === "idle" ? "Ready" : session.status}</small></span></button>)}</div></ScrollArea>
    </aside>
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 items-center justify-between border-b px-5 sm:px-8"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Box className="size-4" /><span>Workspace</span>{active && <><span className="text-border">/</span><strong className="font-medium text-foreground">{repoName}</strong></>}</div>{active && <div className="flex items-center gap-1"><Badge variant="outline" className="hidden gap-1.5 font-normal sm:flex"><span className={cn("size-1.5 rounded-full", sandbox === "running" ? "bg-emerald-500" : sandbox === "stopped" ? "bg-muted-foreground" : "bg-amber-500")} />Sandbox {sandbox}</Badge><Button variant="ghost" size="sm" disabled={sandbox === "stopped"} onClick={stopSandbox}><Power />Stop</Button><Button variant="ghost" size="sm" onClick={archiveSession}><Archive />Archive</Button></div>}</header>
      {!active ? <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-5 py-16 sm:px-10"><div className="mb-5 flex w-fit items-center gap-2 rounded-full border bg-muted/30 px-3 py-1.5 text-xs font-medium"><Sparkles className="size-3.5" />Autonomous development</div><h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">A focused agent for your codebase.</h1><p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">Connect a repository, describe the outcome, and follow every step your agent takes in a contained workspace.</p><form onSubmit={createSession} className="mt-10 max-w-2xl rounded-xl border bg-card p-3 shadow-sm"><label htmlFor="repository" className="mb-2 block px-1 text-xs font-medium">Repository URL</label><div className="flex gap-2"><div className="flex h-10 flex-1 items-center gap-2 rounded-lg border px-3"><GitFork className="size-4 text-muted-foreground" /><input id="repository" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/owner/repository" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></div><Button type="submit" disabled={creating || !repo.trim()}>{creating ? <LoaderCircle className="animate-spin" /> : "Connect"}</Button></div></form>{alert && <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{alert}</div>}</section> : <section className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-5 sm:px-10">
        <div className="flex items-center justify-between border-b"><nav className="flex gap-1" aria-label="Workspace views">{tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setView(id)} className={cn("flex h-12 items-center gap-2 border-b-2 px-3 text-xs font-medium text-muted-foreground", view === id && "border-foreground text-foreground")}><Icon className="size-4" />{label}</button>)}</nav><Badge variant="secondary" className="gap-1.5 font-normal"><span className={cn("size-1.5 rounded-full", working ? "animate-pulse bg-foreground" : "bg-muted-foreground")} />{working ? "Agent working" : "Ready"}</Badge></div>
        {view === "chat" && <><ScrollArea className="min-h-0 flex-1"><div className="space-y-7 py-7">{messages.length === 0 && <div className="mx-auto mt-[12vh] max-w-md text-center"><div className="mx-auto grid size-11 place-items-center rounded-lg border bg-muted/50"><Code2 className="size-5" /></div><h2 className="mt-4 text-base font-semibold">What should I work on?</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Describe the outcome you want. The agent will inspect before it changes anything.</p><div className="mt-5 grid gap-2">{suggestions.map((s) => <Button key={s} variant="outline" size="sm" onClick={() => send(s)}>{s}</Button>)}</div></div>}{messages.map((m) => <Message key={m.id} message={m} streaming={working && m.id === messages.at(-1)?.id} />)}<div ref={bottom} /></div></ScrollArea><div className="border-t py-4"><div className="flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm"><Textarea value={prompt} disabled={sandbox === "stopped"} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={sandbox === "stopped" ? "Sandbox stopped" : "Ask OpenDevin to investigate, build, or fix…"} rows={1} className="min-h-9 border-0 py-2 shadow-none focus-visible:ring-0" /><Button size="icon" onClick={() => working ? stop() : send()} disabled={!working && (!prompt.trim() || sandbox === "stopped")} variant={working ? "destructive" : "default"}>{working ? <CircleStop /> : <SendHorizontal />}</Button></div><p className="px-1 pt-2 text-[10px] text-muted-foreground">Enter to send · Shift + Enter for a new line</p></div></>}
        {view === "diff" && <div className="min-h-0 flex-1 py-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Git diff</h2><p className="text-xs text-muted-foreground">Uncommitted changes in this sandbox.</p></div><Button variant="outline" size="sm" onClick={loadDiff} disabled={diffLoading}>{diffLoading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Refresh</Button></div><ScrollArea className="h-[calc(100vh-11rem)] rounded-lg border bg-card">{diffLoading ? <p className="p-4 font-mono text-xs text-muted-foreground">Loading changes…</p> : diff ? <PatchDiff patch={diff} disableWorkerPool /> : <p className="p-4 text-sm text-muted-foreground">No uncommitted changes.</p>}</ScrollArea></div>}
        {view === "terminal" && <div className="min-h-0 flex-1 py-5"><div className="mb-4"><h2 className="text-sm font-semibold">Sandbox terminal</h2><p className="text-xs text-muted-foreground">A persistent shell in {repoName}.</p></div><div className="flex h-[calc(100vh-13rem)] flex-col overflow-hidden rounded-lg border bg-[#101311] shadow-sm"><ScrollArea className="min-h-0 flex-1"><pre className="p-4 font-mono text-xs leading-6 text-stone-200 whitespace-pre-wrap">{terminal || "Opening terminal…"}</pre></ScrollArea><form onSubmit={submitTerminal} className="flex border-t border-white/10 px-3"><span className="py-3 font-mono text-xs text-emerald-400">$</span><input value={terminalInput} onChange={(e) => setTerminalInput(e.target.value)} className="min-w-0 flex-1 bg-transparent px-3 font-mono text-xs text-stone-100 outline-none" placeholder="Run a command" autoFocus /></form></div></div>}
        {alert && <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{alert}</div>}
      </section>}
    </section>
  </main>;
}
