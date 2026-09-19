"use client";

import { useSyncExternalStore } from "react";

export type PreviewSignal = { url: string; port: number; at: number } | null;

let signal: PreviewSignal = null;
const listeners = new Set<() => void>();

export function emitPreview(url: string, port: number) {
  signal = { url, port, at: Date.now() };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PreviewSignal {
  return signal;
}

function getServerSnapshot(): PreviewSignal {
  return null;
}

export function usePreviewSignal(): PreviewSignal {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
