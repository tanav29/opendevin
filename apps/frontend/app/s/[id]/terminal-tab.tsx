"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { API } from "./lib";

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
    let resizeObserver: ResizeObserver | null = null;
    let socket: Socket | null = null;
    let terminalReady = false;

    void (async () => {
      const element = containerRef.current;
      if (!element || disposed) return;
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ]);
        if (disposed || !containerRef.current) return;
        const terminal = new Terminal({
          cursorBlink: true,
          fontFamily: "monospace",
        });
        term = terminal;
        const fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(element);
        const resize = () => {
          if (element.clientWidth && element.clientHeight) fit.fit();
        };
        terminal.onData((data) => {
          if (terminalReady && socket?.connected) socket.emit("pty:input", data);
        });
        terminal.onResize(({ cols, rows }) => {
          if (terminalReady && socket?.connected) socket.emit("pty:resize", { cols, rows });
        });
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(element);
        resize();

        const connection = io(API, {
          path: "/api/socket.io",
          transports: ["websocket"],
          withCredentials: true,
          autoConnect: false,
          auth: (callback) => callback({ sessionId, cols: terminal.cols, rows: terminal.rows }),
        });
        socket = connection;
        connection.on("connect_error", () => {
          if (!disposed)
            setConnectError("Terminal connection failed. The sandbox may have expired.");
        });
        connection.on("disconnect", () => {
          terminalReady = false;
          if (!disposed) setConnectError("Terminal connection lost. Reconnecting…");
        });
        connection.on("pty:ready", () => {
          terminalReady = true;
          connection.emit("pty:resize", { cols: terminal.cols, rows: terminal.rows });
          setConnectError("");
        });
        connection.on("pty:data", (message: { data?: string }) =>
          terminal.write(message.data || ""),
        );
        connection.on("pty:replay", (message: { data?: string }) =>
          terminal.write(message.data || ""),
        );
        connection.on("pty:reset", () => terminal.write("\x1bc"));
        connection.on("pty:error", (message: { error?: string }) => {
          terminal.write(`\r\n\x1b[31m${message.error || "Terminal error"}\x1b[0m\r\n`);
        });
        connection.connect();
      } catch {
        if (!disposed)
          setConnectError("Terminal could not start. Reconnect the sandbox and retry.");
      }
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      try {
        socket?.disconnect();
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
    <div className="flex h-full flex-col overflow-hidden">
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
