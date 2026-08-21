import { NextRequest, NextResponse } from "next/server";
import {
  GITHUB_SESSION_COOKIE,
  GITHUB_STATE_COOKIE,
  githubCookieOptions,
  seal,
  unseal,
} from "@/lib/github-session";

export async function GET(request: NextRequest) {
  const stateCookie = request.cookies.get(GITHUB_STATE_COOKIE)?.value;
  const state = stateCookie
    ? unseal<{ state: string; returnTo: string }>(stateCookie)
    : null;
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const destination = new URL(state?.returnTo || "/", request.nextUrl.origin);

  if (!state || state.state !== returnedState || !code) {
    destination.searchParams.set("github", "error");
    return NextResponse.redirect(destination);
  }

  try {
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      },
    );
    const token = (await tokenResponse.json()) as {
      access_token?: string;
      error_description?: string;
    };
    if (!tokenResponse.ok || !token.access_token) {
      throw new Error(token.error_description || "GitHub did not return an access token.");
    }
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.access_token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const user = (await userResponse.json()) as {
      login?: string;
      avatar_url?: string;
      message?: string;
    };
    if (!userResponse.ok || !user.login) {
      throw new Error(user.message || "Could not load the GitHub account.");
    }

    destination.searchParams.set("github", "connected");
    const response = NextResponse.redirect(destination);
    response.cookies.set(
      GITHUB_SESSION_COOKIE,
      seal({
        accessToken: token.access_token,
        login: user.login,
        avatarUrl: user.avatar_url || "",
      }),
      { ...githubCookieOptions, maxAge: 30 * 24 * 60 * 60 },
    );
    response.cookies.delete(GITHUB_STATE_COOKIE);
    return response;
  } catch {
    destination.searchParams.set("github", "error");
    const response = NextResponse.redirect(destination);
    response.cookies.delete(GITHUB_STATE_COOKIE);
    return response;
  }
}
