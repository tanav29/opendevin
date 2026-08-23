"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * `localStorage` as React state. Reading it in an effect would cascade a second
 * render on every mount; `useSyncExternalStore` is built for exactly this, and
 * renders the server-safe fallback first so hydration always matches.
 *
 * Values are primitives so React's snapshot comparison stays cheap and stable.
 */
const listeners = new Set<() => void>();

/** Keeps settings working when storage is blocked, just not across reloads. */
const memory = new Map<string, string>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab writing the same key should update this one too.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(key: string) {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function usePersisted<T extends string | number | boolean>(
  key: string,
  /** Used on the server and until the first client read. */
  fallback: T,
  parse: (raw: string | null) => T,
) {
  const value = useSyncExternalStore(
    subscribe,
    () => parse(read(key)),
    () => fallback,
  );

  const set = useCallback(
    (next: T) => {
      memory.set(key, String(next));
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Private browsing can block writes; the in-memory copy still applies.
      }
      for (const listener of listeners) listener();
    },
    [key],
  );

  return [value, set] as const;
}
