import { ConvexHttpClient } from "convex/browser";
import type { NextRequest } from "next/server";

import { api } from "@convex/_generated/api";

export type GitHubAuth = { accessToken: string; login: string; avatarUrl: string };
export type GitHubCommitContext = Pick<GitHubAuth, "accessToken" | "login"> & {
  git: string;
  baseBranch?: string;
  branch?: string;
};

export async function githubAuth(request: NextRequest): Promise<GitHubAuth | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");

  const client = new ConvexHttpClient(url);
  client.setAuth(authorization.slice("Bearer ".length));
  return await client.query(api.users.githubAuth, {});
}

export async function githubCommitContext(
  request: NextRequest,
  sessionId: string,
): Promise<GitHubCommitContext | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");

  const client = new ConvexHttpClient(url);
  client.setAuth(authorization.slice("Bearer ".length));
  return await client.query(api.users.githubCommitContext, { sessionId: sessionId as never });
}
