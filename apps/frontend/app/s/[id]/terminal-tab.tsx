"use client";

import { useEffect, useRef, useState } from "react";
import { WS_API } from "./lib";

type PtyMessage = { type?: string; pid?: number; data?: string; error?: string };

export default function TerminalTab({
  sessionId,
  sandboxId,
  available,
  onReconnect,
}: {
  sessionId: string;
  sandboxId: string;
  available: boolean;
  onReconnect: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [connectError, setConnectError] = useState("");

  useEffect(() => {
    if (!available) return;
    let disposed = false;
    let term: { dispose(): void } | null = null;
    let ws: WebSocket | null = null;
    let observer: ResizeObserver | null = null;

    void (async () => {
      const element = containerRef.current;
      if (!element || disposed) return;
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("xterm"),
          import("xterm-addon-fit"),
        ]);
        if (disposed || !containerRef.current) return;
        const terminal = new Terminal({
          cursorBlink: true,
          fontSize: 13,
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          theme: {
            background: "#0a0a0b",
            foreground: "#e7e7e7",
            cursor: "#e7e7e7",
            selectionBackground: "#3a3a3f",
          },
        });
        const fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(containerRef.current);
        fit.fit();
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
          else if (message.type === "reset") terminal.clear();
          else if (message.type === "error" || message.error)
            terminal.writeln(`\r\n\x1b[31m${message.error || "Terminal error"}\x1b[0m`);
        };
        socket.onerror = () => {
          if (!disposed)
            setConnectError("Terminal connection failed. The sandbox may have expired.");
        };
        const dataListener = terminal.onData((data) => {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: "input", data }));
        });
        observer = new ResizeObserver(() => {
          if (disposed) return;
          try {
            fit.fit();
          } catch {
            return;
          }
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }),
            );
          }
        });
        observer.observe(containerRef.current);
        void dataListener;
      } catch {
        if (!disposed)
          setConnectError("Terminal could not start. Reconnect the sandbox and retry.");
      }
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      try {
        ws?.close();
      } catch {
        // Socket already gone.
      }
      try {
        term?.dispose();
      } catch {
        // Terminal already gone.
      }
    };
  }, [sessionId, sandboxId, available]);

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
    <div className="flex h-full flex-col bg-[#0a0a0b]">
      {connectError && (
        <p className="border-b border-white/10 px-3 py-2 text-xs text-red-400">
          {connectError}{" "}
          <button onClick={onReconnect} className="underline">
            Reconnect
          </button>
        </p>
      )}
      <div ref={containerRef} className="min-h-0 flex-1 p-2" />
    </div>
  );
}
