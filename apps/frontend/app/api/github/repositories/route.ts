import { NextRequest, NextResponse } from "next/server";
import { listRepositories } from "@/lib/github";
import { GITHUB_SESSION_COOKIE, type GitHubSession, unseal } from "@/lib/github-session";

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(GITHUB_SESSION_COOKIE)?.value;
  const session = cookie ? unseal<GitHubSession>(cookie) : null;
  if (!session) return NextResponse.json({ error: "Connect GitHub first." }, { status: 401 });

  try {
    return NextResponse.json({ repositories: await listRepositories(session.accessToken) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load GitHub repositories." },
      { status: 502 },
    );
  }
}
