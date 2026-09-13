"use client";

import { useEffect, useRef, useState } from "react";
import { WS_API } from "./lib";

type PtyMessage = { type?: string; pid?: number; data?: string; error?: string };

export default function TerminalTab({
  sessionId,
  sandboxId,
  available,
  active,
  onReconnect,
}: {
  sessionId: string;
  sandboxId: string;
  available: boolean;
  active?: boolean;
  onReconnect: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [connectError, setConnectError] = useState("");
  useEffect(() => {
    if (!available || active === false) return;
    let disposed = false;
    let term: { destroy(): void } | null = null;
    let ws: WebSocket | null = null;

    void (async () => {
      const element = containerRef.current;
      if (!element || disposed) return;
      try {
        const { WTerm } = await import("@wterm/dom");
        if (disposed || !containerRef.current) return;
        const terminal = new WTerm(containerRef.current, {
          autoResize: true,
          cursorBlink: true,
          onData: (data) => {
            if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
          },
          onResize: (cols, rows) => {
            if (ws?.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: "resize", cols, rows }));
          },
        });
        await terminal.init();
        if (disposed) {
          terminal.destroy();
          return;
        }
        term = terminal;

        const socket = new WebSocket(
          `${WS_API}/api/sessions/${sessionId}/pty?cols=${terminal.cols}&rows=${terminal.rows}`,
        );
        ws = socket;
        socket.onmessage = (event) => {
          let message: PtyMessage;
          try {
            message = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (message.type === "data" || message.type === "replay")
            terminal.write(message.data || "");
          else if (message.type === "reset") terminal.write("\x1bc");
          else if (message.type === "error" || message.error)
            terminal.write(`\r\n\x1b[31m${message.error || "Terminal error"}\x1b[0m\r\n`);
        };
        socket.onerror = () => {
          if (!disposed)
            setConnectError("Terminal connection failed. The sandbox may have expired.");
        };
      } catch {
        if (!disposed)
          setConnectError("Terminal could not start. Reconnect the sandbox and retry.");
      }
    })();

    return () => {
      disposed = true;
      try {
        ws?.close();
      } catch {
        // Socket already gone.
      }
      try {
        term?.destroy();
      } catch {
        // Terminal already gone.
      }
    };
  }, [sessionId, sandboxId, available, active]);

  if (!available) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium">Terminal unavailable</p>
        <p className="max-w-60 text-[13px] text-muted-foreground">
          The sandbox is not running, so there is no shell to attach to.
        </p>
        <button
          onClick={onReconnect}
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
        >
          Reconnect sandbox
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-scroll">
      {connectError && (
        <p className="border-b border-white/10 px-3 py-2 text-xs text-red-400">
          {connectError}{" "}
          <button onClick={onReconnect} className="underline">
            Reconnect
          </button>
        </p>
      )}
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}
