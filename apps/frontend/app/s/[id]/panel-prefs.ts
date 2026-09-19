"use client";

import { useSyncExternalStore } from "react";

export type Tab = "files" | "terminal" | "changes" | "preview";
export type PanelPrefs = { open: boolean; tab: Tab; width: number };

const PANEL_KEY = "opendevin:panel";
const DEFAULT_PREFS: PanelPrefs = { open: true, tab: "terminal", width: 480 };

function parsePrefs(raw: string | null): PanelPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<PanelPrefs>;
    const tab: Tab =
      parsed.tab === "files" || parsed.tab === "changes" || parsed.tab === "preview"
        ? parsed.tab
        : "terminal";
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

export function getPanelPrefsSnapshot(): PanelPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  const raw = window.localStorage.getItem(PANEL_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPrefs = parsePrefs(raw);
  }
  return cachedPrefs;
}

export function getPanelPrefsServerSnapshot() {
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
  for (const listener of prefListeners) listener();
}

export function usePanelPrefs(): [PanelPrefs, (next: PanelPrefs) => void] {
  return [
    useSyncExternalStore(subscribePanelPrefs, getPanelPrefsSnapshot, getPanelPrefsServerSnapshot),
    savePanelPrefs,
  ];
}
