'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type Session = { id: string; git: string; status: string; archived: boolean; createdAt: string; updatedAt: string };
type Message = { role: 'user' | 'assistant'; content: string; time?: string };

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function Icon({ name, size = 17 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></>,
    send: <><path d="m21 3-7.3 18-3.1-7.6L3 10.3 21 3Z"/><path d="m10.6 13.4 4.5-4.5"/></>,
    chevron: <path d="m8 10 4 4 4-4"/>,
    terminal: <><path d="m5 7 5 5-5 5"/><path d="M12 17h7"/></>,
    file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></>,
    github: <><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.3 4c.1-1.2.1-2.3-.3-3.3 0 0-1.2-.4-4 1.5a13.7 13.7 0 0 0-6 0C6.2.3 5 .7 5 .7c-.4 1-.4 2.1-.3 3.3A5.4 5.4 0 0 0 3.2 7.5c0 5.4 3.5 6.6 6.8 7a4.8 4.8 0 0 0-1 3.5v4"/><path d="M9 18c-4 .9-4-2-5.6-2"/></>,
    dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const examples = ['Review the open issues and suggest priorities', 'Add tests for the authentication flow', 'Find and fix the failing build'];

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [repo, setRepo] = useState('');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { fetch(`${API}/sessions`).then(r => r.ok ? r.json() : []).then(setSessions).catch(() => setNotice('Backend offline — start it with pnpm dev in backend.')); }, []);
  async function selectSession(session: Session) {
    setActive(session); setMessages([]);
    try {
      const response = await fetch(`${API}/sessions/${session.id}/messages`);
      if (!response.ok) return;
      const stored = await response.json() as Array<{ role: 'user' | 'assistant'; parts?: Array<{ type: string; text?: string }> }>;
      setMessages(stored.map(message => ({ role: message.role, content: (message.parts || []).filter(part => part.type === 'text').map(part => part.text || '').join('') })));
    } catch { setNotice('Could not load workspace messages.'); }
  }
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  async function createSession(e?: FormEvent) {
    e?.preventDefault();
    if (!repo.trim()) return;
    setCreating(true); setNotice('');
    try {
      const r = await fetch(`${API}/new`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gitUrl: repo.trim() }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Could not create session');
      const next = { id: data.sessionId, git: repo.trim(), status: 'idle', archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      setSessions(s => [next, ...s]); setActive(next); setMessages([]); setRepo('');
    } catch (err) { setNotice(err instanceof Error ? err.message : 'Could not create session'); }
    finally { setCreating(false); }
  }

  async function send(text = prompt) {
    if (!active || !text.trim() || loading) return;
    const user = { role: 'user' as const, content: text.trim(), time: 'now' };
    setMessages(m => [...m, user]); setPrompt(''); setLoading(true); setNotice('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`${API}/ai/${active.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ messages: [...messages, user].map((m, index) => ({ id: `msg-${index}`, role: m.role, parts: [{ type: 'text', text: m.content }] })) }) });
      if (!response.ok) throw new Error((await response.json()).message || 'Agent request failed');
      const reader = response.body?.getReader(); if (!reader) throw new Error('No stream returned');
      const decoder = new TextDecoder(); let buffer = ''; let answer = '';
      setMessages(m => [...m, { role: 'assistant', content: '' }]);
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try { const part = JSON.parse(line.slice(5).trim()); const delta = part.delta || part.textDelta || (part.type === 'text-delta' ? part.text : ''); if (delta) { answer += delta; setMessages(m => { const copy = [...m]; copy[copy.length - 1] = { role: 'assistant', content: answer }; return copy; }); } } catch { /* stream metadata */ }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setNotice(err instanceof Error ? err.message : 'Agent request failed');
      setMessages(m => m.filter((item, i) => i !== m.length - 1 || item.content));
    }
    finally { abortRef.current = null; setLoading(false); }
  }

  function stopResponse() { abortRef.current?.abort(); }

  const repoName = useMemo(() => active?.git.split('/').pop()?.replace('.git', '') || 'workspace', [active]);

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">⌁</span><span>opendevin</span><span className="beta">BETA</span></div>
      <nav><button className="nav-item active"><Icon name="grid"/> Workspace</button><button className="nav-item"><Icon name="terminal"/> Activity <span className="nav-count">{sessions.length}</span></button></nav>
      <div className="side-label"><span>WORKSPACES</span><button onClick={() => setActive(null)} aria-label="New workspace"><Icon name="plus" size={15}/></button></div>
      <div className="session-list">{sessions.length === 0 && <p className="empty-side">Your workspaces will appear here.</p>}{sessions.map(s => <button key={s.id} className={`session ${active?.id === s.id ? 'selected' : ''}`} onClick={() => selectSession(s)}><span className={`status-dot ${s.status === 'running' ? 'running' : ''}`}/><span><strong>{s.git.split('/').pop()?.replace('.git', '')}</strong><small>{s.status === 'idle' ? 'Ready' : s.status}</small></span></button>)}</div>
      <div className="sidebar-bottom"><div className="avatar">OP</div><div><strong>Operator</strong><small>Local account</small></div><button className="more">···</button></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div className="crumb"><Icon name="grid" size={15}/> <span>Workspace</span>{active && <><b>/</b><strong>{repoName}</strong></>}</div><div className="top-actions"><span className="connection"><i/> Agent online</span><button className="icon-button"><Icon name="search"/></button></div></header>
      {!active ? <div className="welcome"><div className="eyebrow"><span className="pulse"/> AUTONOMOUS DEVELOPER</div><h1>Build something<br/><em>worth shipping.</em></h1><p className="intro">Give OpenDevin a repository and a goal. It will inspect the code, make a plan, and work alongside you.</p><form className="repo-card" onSubmit={createSession}><label>CONNECT A REPOSITORY</label><div className="repo-input"><Icon name="github"/><input value={repo} onChange={e => setRepo(e.target.value)} placeholder="https://github.com/owner/repository" aria-label="GitHub repository URL"/><button disabled={creating || !repo.trim()}>{creating ? 'Connecting…' : 'Connect'} <span>↗</span></button></div><div className="repo-hint"><span>⌘</span> Public GitHub repositories supported</div></form><div className="suggestions"><span>OR START WITH A GOAL</span><div>{examples.map(x => <button key={x} onClick={() => setPrompt(x)}>{x}<span>→</span></button>)}</div></div>{notice && <div className="notice">{notice}</div>}</div> : <div className="chat-layout"><div className="chat"><div className="chat-head"><div><span className="eyebrow">ACTIVE WORKSPACE</span><h2>{repoName}</h2></div><span className="ready"><i/> Ready to work</span></div><div className="messages">{messages.length === 0 && <div className="empty-chat"><div className="empty-glyph"><Icon name="terminal" size={23}/></div><h3>What should I work on?</h3><p>Describe a task in plain language. I’ll inspect the repository before making changes.</p></div>}{messages.map((m, i) => <div className={`message ${m.role}`} key={i}><div className="message-label">{m.role === 'user' ? 'YOU' : 'OPENDEVIN'} <span>{m.time || (loading && i === messages.length - 1 ? 'working' : 'just now')}</span></div><div className="message-body">{m.content || <span className="typing"><i/><i/><i/></span>}</div></div>)}<div ref={bottom}/></div><div className="composer-wrap"><div className="composer"><textarea value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Tell OpenDevin what to do…" rows={1}/><button onClick={loading ? stopResponse : () => send()} disabled={!loading && !prompt.trim()} aria-label={loading ? 'Stop response' : 'Send'} className={loading ? 'stop-button' : ''}>{loading ? <span className="stop-square"/> : <Icon name="send"/>}</button></div><div className="composer-footer"><span><kbd>Enter</kbd> to send <kbd>Shift + Enter</kbd> for new line</span><span className="secure">⌁ Sandbox secured</span></div></div>{notice && <div className="notice">{notice}</div>}</div><aside className="activity"><div className="activity-title"><span>RUN ACTIVITY</span><button>···</button></div><div className="activity-line"><span className="activity-icon"><Icon name="github" size={14}/></span><div><strong>Repository connected</strong><small>{repoName}</small></div><time>now</time></div><div className="activity-line muted"><span className="activity-icon"><Icon name="terminal" size={14}/></span><div><strong>Sandbox ready</strong><small>Waiting for your first task</small></div></div><div className="activity-note"><span>TIP</span><p>OpenDevin can run commands, edit files, and verify its work inside an isolated sandbox.</p></div></aside></div>}
    </section>
  </main>;
}
