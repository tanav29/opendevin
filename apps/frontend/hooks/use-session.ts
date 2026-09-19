"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type Me = {
  user: { id: string; name: string; email: string; image: string | null };
  github: { login: string | null; avatarUrl: string | null; profileUrl: string | null };
};

export function useSession() {
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/api/me"),
    retry: false,
  });
  return data ?? null;
}
