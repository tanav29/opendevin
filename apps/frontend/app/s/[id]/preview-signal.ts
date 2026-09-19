"use client";

import { useSyncExternalStore } from "react";

export type PreviewSignal = { sessionId: string; url: string; port: number; at: number } | null;

let signal: PreviewSignal = null;
const listeners = new Set<(signal: NonNullable<PreviewSignal>) => void>();

export function emitPreview(sessionId: string, url: string, port: number) {
  signal = { sessionId, url, port, at: Date.now() };
  for (const listener of listeners) listener(signal);
}

export function getPreviewSignal(): PreviewSignal {
  return signal;
}

export function subscribePreview(listener: (signal: NonNullable<PreviewSignal>) => void) {
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
  return useSyncExternalStore(
    (listener) => subscribePreview(() => listener()),
    getSnapshot,
    getServerSnapshot,
  );
}
