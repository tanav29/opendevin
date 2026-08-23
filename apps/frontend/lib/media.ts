"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * `matchMedia` as React state, in the same idiom as `usePersisted`: read during
 * render instead of in an effect, so a mount costs one render rather than two.
 *
 * One static document serves every screen, so the server snapshot has to pick
 * an answer. It reports a wide viewport — this is a desktop tool — and a phone
 * corrects it on its first client render.
 */
const queries = new Map<string, MediaQueryList>();

function list(query: string) {
  let query_ = queries.get(query);
  if (!query_) {
    query_ = window.matchMedia(query);
    queries.set(query, query_);
  }
  return query_;
}

export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const mql = list(query);
      mql.addEventListener("change", listener);
      return () => mql.removeEventListener("change", listener);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => list(query).matches,
    () => true,
  );
}
