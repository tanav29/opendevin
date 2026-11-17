"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/hooks/use-session";

export function useComposerDraft(scope: string | null) {
  const auth = useSession();
  const key =
    auth.status === "signed-in" && scope
      ? `opendevin:draft:${JSON.stringify([auth.data.user.id, scope])}`
      : null;
  const [draft, setDraft] = useState<{ key: string | null; text: string }>({ key: null, text: "" });
  const currentDraft = useRef(draft);
  currentDraft.current = draft;

  useEffect(() => {
    let text = "";
    if (key) {
      try {
        text = localStorage.getItem(key) ?? "";
      } catch {}
    }
    setDraft({ key, text });
  }, [key]);

  const text = draft.key === key ? draft.text : "";
  function setText(value: string) {
    if (!key) return;
    setDraft((current) => (current.key === key ? { key, text: value } : current));
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {}
  }
  function clearIfUnchanged(expected: string) {
    if (!key) return;
    if (currentDraft.current.key === key && currentDraft.current.text !== expected) return;
    try {
      if ((localStorage.getItem(key) ?? "") !== expected) return;
      localStorage.removeItem(key);
    } catch {}
    setDraft((current) =>
      current.key === key && current.text === expected ? { key, text: "" } : current,
    );
  }
  return [text, setText, Boolean(key && draft.key === key), clearIfUnchanged] as const;
}
