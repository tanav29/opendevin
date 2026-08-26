import { NextRequest, NextResponse } from "next/server";
import { listBranches } from "@/lib/github";
import { GITHUB_SESSION_COOKIE, type GitHubSession, unseal } from "@/lib/github-session";

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(GITHUB_SESSION_COOKIE)?.value;
  const session = cookie ? unseal<GitHubSession>(cookie) : null;
  if (!session) return NextResponse.json({ error: "Connect GitHub first." }, { status: 401 });
  const repository = request.nextUrl.searchParams.get("repository");
  if (!repository) return NextResponse.json({ error: "Repository is required." }, { status: 400 });

  try {
    return NextResponse.json({ repository, branches: await listBranches(session.accessToken, repository) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load GitHub branches." },
      { status: 502 },
    );
  }
}
