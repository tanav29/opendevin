"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PanelPrefs, Tab } from "./panel-prefs";

const ChangesTab = dynamic(() => import("./changes-tab"), { ssr: false });
const FilesTab = dynamic(() => import("./files-tab"), { ssr: false });
const PreviewTab = dynamic(() => import("./preview-tab"), { ssr: false });
const TerminalTab = dynamic(() => import("./terminal-tab"), { ssr: false });

export default function SessionPanel({
  sessionId,
  sandboxId,
  sandboxReady,
  defaultTitle,
  prefs,
  onPrefs,
  sessionInfo,
  onReconnect,
  onCommitted,
  onUseComment,
  defaultPort,
}: {
  sessionId: string;
  sandboxId: string;
  sandboxReady: boolean;
  defaultTitle: string;
  prefs: PanelPrefs;
  onPrefs: (next: PanelPrefs) => void;
  sessionInfo: ReactNode;
  onReconnect: () => void;
  onCommitted?: () => void;
  onUseComment: (comment: string) => void;
  defaultPort?: number;
}) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  const activeTab = prefs.tab;

  function selectTab(tab: Tab) {
    onPrefs({ ...prefsRef.current, tab });
  }

  function onDragStart(event: React.MouseEvent) {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: prefs.width };
    const onMove = (move: MouseEvent) => {
      if (!dragRef.current) return;
      const width = Math.max(
        320,
        Math.min(800, dragRef.current.startWidth - (move.clientX - dragRef.current.startX)),
      );
      onPrefs({ ...prefsRef.current, width });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "files", label: "Files" },
    { id: "terminal", label: "Terminal" },
    { id: "changes", label: "Changes" },
    { id: "preview", label: "Preview" },
    { id: "session", label: "Session" },
  ];

  return (
    <aside
      aria-label="Workspace panel"
      className="absolute inset-y-0 right-0 z-30 h-full shrink-0 bg-background md:relative md:max-w-1/2"
      style={{ width: `min(100%, ${prefs.width}px)` }}
    >
      <div
        onMouseDown={onDragStart}
        className="absolute inset-y-0 left-0 z-10 hidden w-1 cursor-col-resize hover:bg-ring/50 md:block"
      />
      <div className="flex h-full flex-col border-l border-border">
        <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
          <div className="flex min-w-0 flex-wrap gap-1">
            {tabs.map((tab) => (
              <Button
                key={tab.id}
                size="xs"
                onClick={() => selectTab(tab.id)}
                variant={activeTab === tab.id ? "outline" : "ghost"}
                aria-pressed={activeTab === tab.id}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {activeTab === "session" && sessionInfo}
          {activeTab === "files" && (
            <FilesTab
              key={`files-${sessionId}-${sandboxId}`}
              sessionId={sessionId}
              sandboxId={sandboxId}
              available={sandboxReady}
              active={activeTab === "files"}
              onReconnect={onReconnect}
            />
          )}
          {activeTab === "terminal" && (
            <TerminalTab
              key={`term-${sessionId}-${sandboxId}`}
              sessionId={sessionId}
              sandboxId={sandboxId}
              available={sandboxReady}
              active={activeTab === "terminal"}
              onReconnect={onReconnect}
            />
          )}
          {activeTab === "changes" && (
            <ChangesTab
              key={`diff-${sessionId}-${sandboxId}`}
              sessionId={sessionId}
              sandboxId={sandboxId}
              available={sandboxReady}
              active={activeTab === "changes"}
              defaultTitle={defaultTitle}
              onReconnect={onReconnect}
              onCommitted={onCommitted}
              onUseComment={onUseComment}
            />
          )}
          {activeTab === "preview" && (
            <PreviewTab
              key={`preview-${sessionId}-${sandboxId}`}
              sessionId={sessionId}
              available={sandboxReady}
              onReconnect={onReconnect}
              defaultPort={defaultPort}
            />
          )}
        </div>
      </div>
    </aside>
  );
}
