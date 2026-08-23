"use client";

import { preloadHighlighter, type DiffsThemeNames } from "@pierre/diffs";
import { useSyncExternalStore } from "react";

/** Shiki theme chosen to sit flush with the near-black shell. */
export const DIFF_THEME: DiffsThemeNames = "vesper";

/**
 * Shiki's highlighter is shared per tab and loads asynchronously. A diff that
 * mounts before it is warm paints an empty container, and because we run
 * highlighting on the main thread there is no worker pool behind it to retry —
 * the diff stays blank for good. So the pane waits for this instead.
 *
 * Loading starts on import rather than on demand: the review pane is on screen
 * for the whole session, and warming Shiki early means the first diff to arrive
 * can paint immediately.
 */
type HighlighterState = "loading" | "ready" | "failed";

const listeners = new Set<() => void>();
let state: HighlighterState = "loading";

if (typeof window !== "undefined") {
  void preloadHighlighter({ themes: [DIFF_THEME], langs: ["text"] })
    .then(
      () => {
        state = "ready";
      },
      () => {
        // Offline, or the chunk failed. Callers fall back to the raw patch.
        state = "failed";
      },
    )
    .then(() => {
      for (const listener of listeners) listener();
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `"loading"` until Shiki is warm enough for a diff to paint on first render. */
export function useHighlighter() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => "loading" as const,
  );
}
