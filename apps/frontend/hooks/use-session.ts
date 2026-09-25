"use client";

import { useQuery } from "@tanstack/react-query";
import { api, ApiError, isAuthError } from "@/lib/api";

export type Me = {
  user: { id: string; name: string; email: string; image: string | null };
  github: { login: string | null; avatarUrl: string | null; profileUrl: string | null };
};

export type AuthState =
  | { status: "checking"; data: null; error: null; refetch: () => Promise<unknown> }
  | { status: "signed-out"; data: null; error: null; refetch: () => Promise<unknown> }
  | { status: "signed-in"; data: Me; error: null; refetch: () => Promise<unknown> }
  | { status: "unavailable"; data: null; error: ApiError; refetch: () => Promise<unknown> };

export function useSession(): AuthState {
  const query = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/api/me"),
    retry: false,
    staleTime: 30_000,
  });

  const refetch = query.refetch;
  const error =
    query.error instanceof ApiError
      ? query.error
      : query.error
        ? new ApiError(0, "Unable to verify your session.")
        : null;
  if (error && isAuthError(error)) {
    return { status: "signed-out", data: null, error: null, refetch };
  }
  // React Query keeps cached data after a failed background refetch. Preserve
  // that identity so a momentary network failure does not collapse the app shell.
  if (query.data) return { status: "signed-in", data: query.data, error: null, refetch };
  if (query.isPending || !error) {
    return { status: "checking", data: null, error: null, refetch };
  }
  return { status: "unavailable", data: null, error, refetch };
}
