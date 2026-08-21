import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  GITHUB_STATE_COOKIE,
  githubCookieOptions,
  seal,
} from "@/lib/github-session";

export async function GET(request: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GITHUB_CLIENT_ID is not configured." },
      { status: 503 },
    );
  }
  const state = randomUUID();
  const requestedReturnTo = request.nextUrl.searchParams.get("returnTo") || "/";
  const returnTo = requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//")
    ? requestedReturnTo
    : "/";
  const callback = new URL("/api/github/callback", request.nextUrl.origin);
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", callback.toString());
  authorize.searchParams.set("scope", "public_repo");
  authorize.searchParams.set("state", state);

  const response = NextResponse.redirect(authorize);
  response.cookies.set(
    GITHUB_STATE_COOKIE,
    seal({ state, returnTo }),
    { ...githubCookieOptions, maxAge: 10 * 60 },
  );
  return response;
}
