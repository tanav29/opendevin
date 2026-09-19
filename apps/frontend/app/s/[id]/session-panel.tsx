"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
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
  workspacePath,
  defaultTitle,
  prefs,
  onPrefs,
  onReconnect,
}: {
  sessionId: string;
  sandboxId: string;
  sandboxReady: boolean;
  workspacePath: string;
  defaultTitle: string;
  prefs: PanelPrefs;
  onPrefs: (next: PanelPrefs) => void;
  onReconnect: () => void;
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
  ];

  return (
    <div className="relative hidden h-full shrink-0 md:block" style={{ width: prefs.width }}>
      <div
        onMouseDown={onDragStart}
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-ring/50"
      />
      <div className="flex h-full flex-col border-l border-t border-border">
        <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <Button
                key={tab.id}
                size="xs"
                onClick={() => selectTab(tab.id)}
                variant={activeTab === tab.id ? "outline" : "ghost"}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1">
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
            />
          )}
          {activeTab === "preview" && (
            <PreviewTab
              key={`preview-${sessionId}-${sandboxId}`}
              sessionId={sessionId}
              available={sandboxReady}
              onReconnect={onReconnect}
            />
          )}
        </div>
      </div>
    </div>
  );
}
