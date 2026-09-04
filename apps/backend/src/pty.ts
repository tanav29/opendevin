import { Sandbox } from "e2b";
import type { WebSocket } from "ws";
import { WORKSPACE_PATH } from "./sandbox.js";

// Single shared PTY per session. Entries survive tab close/reconnect and die
// only when the sandbox is replaced (dropPty) or the backend restarts, in
// which case pty.connect(pid) reattaches to the still-running PTY.

type PtyEntry = {
  sandboxId: string;
  pid: number;
  sockets: Set<WebSocket>;
  decoder: TextDecoder;
  ring: string[];
  ringBytes: number;
};

const entries = new Map<string, PtyEntry>();
const connecting = new Map<string, Promise<PtyEntry>>();
const RING_MAX_BYTES = 64 * 1024;

function broadcast(entry: PtyEntry, text: string) {
  entry.ring.push(text);
  entry.ringBytes += text.length;
  while (entry.ringBytes > RING_MAX_BYTES && entry.ring.length > 1) {
    entry.ringBytes -= entry.ring[0].length;
    entry.ring.shift();
  }
  const message = JSON.stringify({ type: "data", data: text });
  for (const socket of entry.sockets) {
    if (socket.readyState === socket.OPEN) socket.send(message);
  }
}

function onSandboxData(sessionId: string, chunk: Uint8Array) {
  const entry = entries.get(sessionId);
  if (!entry) return;
  broadcast(entry, entry.decoder.decode(chunk, { stream: true }));
}

async function createEntry(
  sessionId: string,
  sandboxId: string,
  workspacePath: string,
  cols: number,
  rows: number,
): Promise<PtyEntry> {
  const sandbox = await Sandbox.connect(sandboxId);
  const entry: PtyEntry = {
    sandboxId,
    pid: -1,
    sockets: new Set(),
    decoder: new TextDecoder(),
    ring: [],
    ringBytes: 0,
  };
  entries.set(sessionId, entry);
  try {
    const handle = await sandbox.pty.create({
      cols: Math.max(20, Math.min(500, cols || 80)),
      rows: Math.max(5, Math.min(200, rows || 24)),
      timeoutMs: 0,
      cwd: workspacePath || WORKSPACE_PATH,
      onData: (chunk) => onSandboxData(sessionId, chunk),
    });
    entry.pid = handle.pid;
  } catch (error) {
    if (entries.get(sessionId) === entry) entries.delete(sessionId);
    throw error;
  }
  return entry;
}

export async function attachPty(
  sessionId: string,
  sandboxId: string,
  workspacePath: string,
  cols: number,
  rows: number,
  socket: WebSocket,
): Promise<PtyEntry> {
  let entry = entries.get(sessionId);
  const pending = connecting.get(sessionId);
  if (pending) {
    entry = await pending;
  } else if (!entry || entry.sandboxId !== sandboxId) {
    if (entry) entries.delete(sessionId);
    const task = createEntry(sessionId, sandboxId, workspacePath, cols, rows).finally(() => {
      if (connecting.get(sessionId) === task) connecting.delete(sessionId);
    });
    connecting.set(sessionId, task);
    entry = await task;
  }
  entry.sockets.add(socket);
  return entry;
}

export function replayPty(sessionId: string): string {
  return entries.get(sessionId)?.ring.join("") || "";
}

export function detachPty(sessionId: string, socket: WebSocket) {
  entries.get(sessionId)?.sockets.delete(socket);
}

async function sendToPty(
  sessionId: string,
  sandboxId: string,
  workspacePath: string,
  text: string,
): Promise<boolean> {
  const entry = entries.get(sessionId);
  if (!entry || entry.sandboxId !== sandboxId)
    throw new Error("Terminal is not attached to this sandbox");
  const bytes = new TextEncoder().encode(text);
  try {
    const sandbox = await Sandbox.connect(sandboxId);
    await sandbox.pty.sendInput(entry.pid, bytes);
    return false;
  } catch {
    // PTY died while the sandbox lives on: recreate once and retry.
    entries.delete(sessionId);
    const fresh = await createEntry(sessionId, sandboxId, workspacePath, 80, 24);
    const sandbox = await Sandbox.connect(sandboxId);
    await sandbox.pty.sendInput(fresh.pid, bytes);
    return true;
  }
}

export async function writePty(
  sessionId: string,
  sandboxId: string,
  workspacePath: string,
  text: string,
): Promise<boolean> {
  if (!text) return false;
  return sendToPty(sessionId, sandboxId, workspacePath, text);
}

export async function resizePty(sessionId: string, sandboxId: string, cols: number, rows: number) {
  const entry = entries.get(sessionId);
  if (!entry || entry.sandboxId !== sandboxId || entry.pid < 0) return;
  try {
    const sandbox = await Sandbox.connect(sandboxId);
    await sandbox.pty.resize(entry.pid, {
      cols: Math.max(20, Math.min(500, cols || 80)),
      rows: Math.max(5, Math.min(200, rows || 24)),
    });
  } catch {
    // Resize is best-effort; a dead PTY recreates on next input.
  }
}

export function dropPty(sessionId: string) {
  const entry = entries.get(sessionId);
  entries.delete(sessionId);
  if (!entry || entry.pid < 0) return;
  // Best-effort kill; the sandbox itself is being replaced anyway.
  void (async () => {
    try {
      const sandbox = await Sandbox.connect(entry.sandboxId);
      await sandbox.pty.kill(entry.pid);
    } catch {
      // Sandbox already gone — nothing to kill.
    }
  })();
}
