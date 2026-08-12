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
  activity?: string | null;
};

export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
