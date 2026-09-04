"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import ChangesTab from "./changes-tab";
import PreviewTab from "./preview-tab";
import TerminalTab from "./terminal-tab";

type Tab = "terminal" | "changes" | "preview";

const PANEL_KEY = "opendevin:panel";

export type PanelPrefs = { open: boolean; tab: Tab; width: number };

const DEFAULT_PREFS: PanelPrefs = { open: true, tab: "terminal", width: 480 };

function parsePrefs(raw: string | null): PanelPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<PanelPrefs>;
    const tab: Tab = parsed.tab === "changes" || parsed.tab === "preview" ? parsed.tab : "terminal";
    const width =
      typeof parsed.width === "number"
        ? Math.max(320, Math.min(800, parsed.width))
        : DEFAULT_PREFS.width;
    return { open: parsed.open !== false, tab, width };
  } catch {
    return DEFAULT_PREFS;
  }
}

const prefListeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedPrefs: PanelPrefs = DEFAULT_PREFS;

function notifyPrefs() {
  for (const listener of prefListeners) listener();
}

export function getPanelPrefsSnapshot(): PanelPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  // Cache by raw string so the snapshot is referentially stable between writes.
  const raw = window.localStorage.getItem(PANEL_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPrefs = parsePrefs(raw);
  }
  return cachedPrefs;
}

export function getPanelPrefsServerSnapshot(): PanelPrefs {
  return DEFAULT_PREFS;
}

export function subscribePanelPrefs(listener: () => void) {
  prefListeners.add(listener);
  const onStorage = () => listener();
  window.addEventListener("storage", onStorage);
  return () => {
    prefListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function savePanelPrefs(next: PanelPrefs) {
  try {
    window.localStorage.setItem(PANEL_KEY, JSON.stringify(next));
  } catch {
    // Private mode — panel prefs simply don't persist.
  }
  notifyPrefs();
}

export function usePanelPrefs(): [PanelPrefs, (next: PanelPrefs) => void] {
  const prefs = useSyncExternalStore(
    subscribePanelPrefs,
    getPanelPrefsSnapshot,
    getPanelPrefsServerSnapshot,
  );
  return [prefs, savePanelPrefs];
}

export default function SessionPanel({
  sessionId,
  sandboxId,
  sandboxReady,
  defaultTitle,
  prefs,
  onPrefs,
  onReconnect,
}: {
  sessionId: string;
  sandboxId: string;
  sandboxReady: boolean;
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
      <div className="flex h-full flex-col border-l border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  activeTab === tab.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => onPrefs({ ...prefs, tab: activeTab, open: false })}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Collapse panel"
          >
            →
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <div className={activeTab === "terminal" ? "h-full" : "hidden"}>
            <TerminalTab
              key={`term-${sessionId}-${sandboxId}`}
              sessionId={sessionId}
              sandboxId={sandboxId}
              available={sandboxReady}
              onReconnect={onReconnect}
            />
          </div>
          <div className={activeTab === "changes" ? "h-full" : "hidden"}>
            <ChangesTab
              key={`diff-${sessionId}-${sandboxId}`}
              sessionId={sessionId}
              sandboxId={sandboxId}
              available={sandboxReady}
              active={activeTab === "changes"}
              defaultTitle={defaultTitle}
              onReconnect={onReconnect}
            />
          </div>
          <div className={activeTab === "preview" ? "h-full" : "hidden"}>
            <PreviewTab
              key={`preview-${sessionId}-${sandboxId}`}
              sessionId={sessionId}
              available={sandboxReady}
              onReconnect={onReconnect}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
