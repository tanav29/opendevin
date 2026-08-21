import { NextRequest, NextResponse } from "next/server";
import {
  GITHUB_SESSION_COOKIE,
  githubCookieOptions,
  type GitHubSession,
  unseal,
} from "@/lib/github-session";

export async function GET(request: NextRequest) {
  const value = request.cookies.get(GITHUB_SESSION_COOKIE)?.value;
  const session = value ? unseal<GitHubSession>(value) : null;
  return NextResponse.json(
    session
      ? { connected: true, login: session.login, avatarUrl: session.avatarUrl }
      : { connected: false },
  );
}

export async function DELETE() {
  const response = NextResponse.json({ connected: false });
  response.cookies.set(GITHUB_SESSION_COOKIE, "", {
    ...githubCookieOptions,
    maxAge: 0,
  });
  return response;
}
