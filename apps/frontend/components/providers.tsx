"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProvider } from "convex/react";
import { convex } from "@/lib/convex";

export type Session = {
  id: string;
  git: string;
  status: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  sandbox?: string;
  cwd?: string;
  parts?: string;
  projectId?: string;
};

export type Project = {
  id: string;
  name: string;
  git: string;
  createdAt: string;
  updatedAt: string;
};

type StoredMessagePart = { type?: string; text?: string };
type StoredMessage = { role?: string; parts?: StoredMessagePart[] };

export function sessionTitle(session: Session) {
  try {
    const messages = JSON.parse(session.parts ?? "[]") as StoredMessage[];
    const firstUserMessage = messages.find((message) => message.role === "user");
    const text = firstUserMessage?.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text?.trim())
      .find(Boolean);
    if (text) return text;
  } catch {
    // A malformed stored transcript should not prevent the session list rendering.
  }

  return (
    session.git.split("/").pop()?.replace(/\.git$/, "") ||
    "Untitled session"
  );
}

export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function normalizeRecord(value: Record<string, unknown>, fallbackId: string) {
  const id = String(value.id ?? value._id ?? fallbackId);
  return {
    ...value,
    id,
    createdAt: new Date(Number(value.createdAt)).toISOString(),
    updatedAt: new Date(Number(value.updatedAt)).toISOString(),
  };
}

export function mapSessions(raw: unknown[] | undefined): Session[] {
  return (raw ?? []).map((session, index) =>
    normalizeRecord(session as Record<string, unknown>, `s-${index}`),
  ) as Session[];
}

export function mapProjects(raw: unknown[] | undefined): Project[] {
  return (raw ?? []).map((project, index) =>
    normalizeRecord(project as Record<string, unknown>, `p-${index}`),
  ) as Project[];
}

const SessionSelectionContext = createContext<{
  activeSessionId: string | null;
  selectSession: (id: string | null) => void;
} | null>(null);

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [activeSessionId, selectSession] = useState<string | null>(null);
  return (
    <ConvexProvider client={convex}>
    <QueryClientProvider client={queryClient}>
      <SessionSelectionContext.Provider value={{ activeSessionId, selectSession }}>
        {children}
      </SessionSelectionContext.Provider>
    </QueryClientProvider>
    </ConvexProvider>
  );
}

export function useSessionSelection() {
  const value = useContext(SessionSelectionContext);
  if (!value) throw new Error("useSessionSelection must be used inside AppProviders");
  return value;
}
