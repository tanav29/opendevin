'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage, type UIMessagePart } from 'ai';
import { Streamdown } from 'streamdown';
import {
  Bot, Box, ChevronDown, CircleStop, Code2, FileText, GitFork, LoaderCircle,
  MessageSquareText, Plus, SendHorizontal, Sparkles, Terminal, Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type Session = { id: string; git: string; status: string; archived: boolean; createdAt: string; updatedAt: string };
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const suggestions = ['Map the architecture and key risks', 'Add coverage for the authentication flow', 'Find and fix the failing build'];

function messageText(parts: UIMessagePart<never, never>[]) {
  return parts.filter((part) => part.type === 'text').map((part) => part.text).join('');
}

function ToolCall({ part }: { part: UIMessagePart<never, never> }) {
  if (!isToolUIPart(part)) return null;
  const name = getToolName(part);
  const tool = part as unknown as { state?: string; input?: unknown; output?: unknown; errorText?: string };
  const state = tool.state ?? 'input-streaming';
  const done = state === 'output-available' || state === 'output-error' || state === 'output-denied';
  const detail = tool.output ?? tool.input;

  return <details className="tool-call" open={!done}>
    <summary>
      <span className={cn('tool-icon', done ? 'tool-icon-done' : 'tool-icon-live')}>
        {done ? <Wrench size={14} /> : <LoaderCircle className="animate-spin" size={14} />}
      </span>
      <span className="min-w-0 flex-1"><strong>{name.replaceAll('_', ' ')}</strong><small>{done ? state === 'output-error' ? 'Tool failed' : 'Completed' : 'Running in sandbox'}</small></span>
      <ChevronDown size={15} className="tool-chevron" />
    </summary>
    {(detail !== undefined || tool.errorText) && <pre>{typeof (tool.errorText ?? detail) === 'string' ? String(tool.errorText ?? detail) : JSON.stringify(detail, null, 2)}</pre>}
  </details>;
}

function Message({ message, isStreaming }: { message: UIMessage; isStreaming: boolean }) {
  const isUser = message.role === 'user';
  const hasText = messageText(message.parts as UIMessagePart<never, never>[]).trim().length > 0;
  return <article className={cn('message-row', isUser ? 'message-user' : 'message-agent')}>
    {!isUser && <div className="message-avatar"><Bot size={17} /></div>}
    <div className="min-w-0 flex-1">
      <div className="message-meta"><span>{isUser ? 'You' : 'OpenDevin'}</span>{!isUser && isStreaming && <span className="streaming-state"><i /> thinking</span>}</div>
      <div className={cn('message-content', isUser && 'user-content')}>
        {message.parts.map((part, index) => {
          if (part.type === 'text') return <Streamdown key={`${message.id}-${index}`} mode={isStreaming ? 'streaming' : 'static'} className="agent-markdown">{part.text}</Streamdown>;
          if (isToolUIPart(part)) return <ToolCall key={`${message.id}-${index}`} part={part as UIMessagePart<never, never>} />;
          return null;
        })}
        {!isUser && !hasText && isStreaming && <span className="typing-dots"><i /><i /><i /></span>}
      </div>
    </div>
  </article>;
}

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [repo, setRepo] = useState('');
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const transport = useMemo(() => new DefaultChatTransport({ api: `${API}/ai/${active?.id ?? 'new-session'}` }), [active?.id]);
  const { messages, setMessages, sendMessage, status, stop, error } = useChat({ transport, throttle: 40 });
  const isWorking = status === 'submitted' || status === 'streaming';
  const repoName = useMemo(() => active?.git.split('/').pop()?.replace('.git', '') || 'workspace', [active]);

  useEffect(() => {
    fetch(`${API}/sessions`).then((r) => r.ok ? r.json() : []).then(setSessions).catch(() => setNotice('Backend offline — start it with pnpm dev in backend.'));
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, status]);

  async function selectSession(session: Session) {
    setActive(session); setMessages([]); setNotice('');
    try {
      const response = await fetch(`${API}/sessions/${session.id}/messages`);
      if (!response.ok) throw new Error('Could not load workspace messages.');
      const stored = await response.json() as UIMessage[];
      setMessages(stored.filter((message) => message.role === 'user' || message.role === 'assistant'));
    } catch (err) { setNotice(err instanceof Error ? err.message : 'Could not load workspace messages.'); }
  }

  async function createSession(event?: FormEvent) {
    event?.preventDefault();
    if (!repo.trim()) return;
    setCreating(true); setNotice('');
    try {
      const response = await fetch(`${API}/new`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gitUrl: repo.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not create session');
      const next: Session = { id: data.sessionId, git: repo.trim(), status: 'idle', archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      setSessions((current) => [next, ...current]); setActive(next); setMessages([]); setRepo('');
    } catch (err) { setNotice(err instanceof Error ? err.message : 'Could not create session'); }
    finally { setCreating(false); }
  }

  async function send(text = prompt) {
    if (!active || !text.trim() || isWorking) return;
    setPrompt(''); setNotice('');
    await sendMessage({ text: text.trim() });
  }

  return <main className="app-shell">
    <aside className="sidebar-panel">
      <div className="brand"><span className="brand-orbit"><Sparkles size={15} /></span><span>opendevin</span><Badge variant="outline" className="beta-badge">LOCAL</Badge></div>
      <div className="sidebar-section"><p>Control room</p><Button variant="secondary" className="nav-button"><MessageSquareText /> Workspace</Button><Button variant="ghost" className="nav-button"><Terminal /> Activity <Badge variant="outline" className="ml-auto">{sessions.length}</Badge></Button></div>
      <div className="workspace-list-head"><p>Workspaces</p><Button variant="ghost" size="icon-sm" onClick={() => { setActive(null); setMessages([]); }} aria-label="Create workspace"><Plus /></Button></div>
      <ScrollArea className="workspace-list">
        {sessions.length === 0 ? <p className="empty-workspaces">Connect a repository to give your agent somewhere to work.</p> : sessions.map((session) => <button key={session.id} onClick={() => selectSession(session)} className={cn('workspace-link', active?.id === session.id && 'workspace-link-active')}><span className={cn('workspace-status', session.status === 'running' && 'workspace-status-running')} /><span><strong>{session.git.split('/').pop()?.replace('.git', '')}</strong><small>{session.status === 'idle' ? 'Ready' : session.status}</small></span></button>)}
      </ScrollArea>
      <div className="operator"><div className="operator-avatar">OP</div><span><strong>Operator</strong><small>Local account</small></span></div>
    </aside>

    <section className="main-panel">
      <header className="topbar"><div className="breadcrumb"><Box size={15} /><span>Workspace</span>{active && <><b>/</b><strong>{repoName}</strong></>}</div><Badge variant="outline" className="online-badge"><i /> Agent online</Badge></header>
      {!active ? <section className="welcome-screen"><div className="welcome-kicker"><Sparkles size={14} /> Autonomous development</div><h1>Give your repository<br />a capable <em>pair.</em></h1><p>OpenDevin explores the codebase, uses real tools in an isolated workspace, and leaves a clear trail of everything it did.</p><form className="connect-card" onSubmit={createSession}><label htmlFor="repository">Repository URL</label><div><GitFork size={18} /><input id="repository" value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="https://github.com/owner/repository" /><Button type="submit" disabled={creating || !repo.trim()}>{creating ? <LoaderCircle className="animate-spin" /> : <>Connect <span>↗</span></>}</Button></div><small>Public GitHub, GitLab, and Bitbucket repositories are supported.</small></form><div className="suggestion-grid">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => setPrompt(suggestion)}><span>{suggestion}</span><span>→</span></button>)}</div>{(notice || error?.message) && <div className="notice">{notice || error?.message}</div>}</section> : <section className="chat-screen">
        <div className="chat-column"><header className="chat-heading"><div><p>Active workspace</p><h2>{repoName}</h2></div><Badge variant="secondary" className="ready-badge"><i /> {isWorking ? 'Agent working' : 'Ready to work'}</Badge></header>
          <ScrollArea className="chat-scroll"><div className="messages-stack">{messages.length === 0 && <div className="empty-chat"><div><Code2 size={23} /></div><h3>What should I work on?</h3><p>Describe the outcome you want. The agent will inspect before it changes anything.</p><div>{suggestions.map((suggestion) => <Button key={suggestion} variant="outline" size="sm" onClick={() => send(suggestion)}>{suggestion}</Button>)}</div></div>}{messages.map((message) => <Message key={message.id} message={message} isStreaming={isWorking && message.id === messages.at(-1)?.id} />)}<div ref={bottom} /></div></ScrollArea>
          <div className="composer-zone"><div className="composer"><Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Ask OpenDevin to investigate, build, or fix…" rows={1} /><Button size="icon" onClick={() => isWorking ? stop() : send()} disabled={!isWorking && !prompt.trim()} aria-label={isWorking ? 'Stop response' : 'Send message'} variant={isWorking ? 'destructive' : 'default'}>{isWorking ? <CircleStop /> : <SendHorizontal />}</Button></div><div className="composer-hint"><span><kbd>Enter</kbd> to send <kbd>Shift + Enter</kbd> for a new line</span><span>Sandboxed execution</span></div>{(notice || error?.message) && <div className="notice">{notice || error?.message}</div>}</div>
        </div><aside className="activity-panel"><div className="activity-head"><div><p>Live trace</p><h3>Run activity</h3></div><Badge variant="outline">{isWorking ? 'LIVE' : 'IDLE'}</Badge></div><div className="trace-line"><span className="trace-icon"><GitFork size={14} /></span><div><strong>Repository connected</strong><small>{repoName}</small></div><time>now</time></div><div className="trace-line"><span className="trace-icon"><Terminal size={14} /></span><div><strong>{isWorking ? 'Sandbox is executing' : 'Sandbox ready'}</strong><small>{isWorking ? 'Tool output will appear in chat' : 'Waiting for your direction'}</small></div></div><div className="activity-tip"><FileText size={15} /><p>Every command, file read, and edit stays visible in the conversation.</p></div></aside>
      </section>}
    </section>
  </main>;
}
