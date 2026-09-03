"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
type Message = { id: string; role: "user" | "assistant"; content: string };
type Session = { id: string; title: string; sandboxId: string; projectId: string };

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const [sessionId, setSessionId] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { void params.then(({ id }) => { setSessionId(id); void Promise.all([fetch(`${API}/api/sessions/${id}/messages`, { credentials: "include" }).then((r) => r.ok ? r.json() : []), fetch(`${API}/api/sessions/${id}`, { credentials: "include" }).then((r) => r.ok ? r.json() : null)]).then(([history, detail]) => { setMessages(history); setSession(detail); }); }); }, [params]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !sessionId || sending) return;
    setInput(""); setError(""); setSending(true);
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", content: text }, { id: "streaming", role: "assistant", content: "" }]);
    const response = await fetch(`${API}/api/sessions/${sessionId}/chat`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) });
    if (!response.ok || !response.body) { const data = await response.json().catch(() => ({})); setError(data.error || "The agent could not respond"); setMessages((current) => current.filter((message) => message.id !== "streaming")); setSending(false); return; }
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    while (true) { const { done, value } = await reader.read(); if (done) break; const chunk = decoder.decode(value); setMessages((current) => current.map((message) => message.id === "streaming" ? { ...message, content: message.content + chunk } : message)); }
    setMessages((current) => current.map((message) => message.id === "streaming" ? { ...message, id: `assistant-${Date.now()}` } : message)); setSending(false);
  }

  return <main className="flex min-h-screen flex-col bg-background"><header className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-8"><div className="flex min-w-0 items-center gap-4"><Link href={session ? `/projects/${session.projectId}` : "/"} className="text-xs text-muted-foreground hover:text-foreground">← Back</Link><span className="h-4 w-px bg-border" /><h1 className="truncate text-sm font-medium">{session?.title || "Loading session..."}</h1></div><span className="hidden font-mono text-[11px] text-muted-foreground sm:block">SANDBOX · {session?.sandboxId?.slice(-12) || "..."}</span></header><section className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-8 sm:px-8"><div className="flex-1 space-y-6">{messages.length === 0 && <div className="rounded-lg border border-dashed border-border p-8 text-sm text-muted-foreground">Your agent is ready. Ask it to inspect files, make a plan, or start building.</div>}{messages.map((message) => <article key={message.id} className={message.role === "user" ? "ml-8 rounded-lg bg-card px-4 py-3 text-sm" : "mr-8 px-1 py-2 text-sm leading-7 text-foreground/85"}><p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{message.role === "user" ? "You" : "OpenDevin"}</p><p className="whitespace-pre-wrap">{message.content || "Thinking..."}</p></article>)}</div><form onSubmit={send} className="mt-10 flex gap-2 border-t border-border pt-4"><input value={input} onChange={(e) => setInput(e.target.value)} disabled={sending} placeholder="Tell the agent what to do next" className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" /><button disabled={sending || !input.trim()} className="rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40">{sending ? "Working" : "Send"}</button></form>{error && <p className="mt-3 text-right text-sm text-destructive">{error}</p>}</section></main>;
}
