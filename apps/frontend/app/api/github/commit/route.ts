import { NextRequest, NextResponse } from "next/server";
import { commitChanges } from "@/lib/github";
import { GITHUB_SESSION_COOKIE, type GitHubSession, unseal } from "@/lib/github-session";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const cookie = request.cookies.get(GITHUB_SESSION_COOKIE)?.value;
  const session = cookie ? unseal<GitHubSession>(cookie) : null;
  if (!session) return NextResponse.json({ error: "Connect GitHub first." }, { status: 401 });

  try {
    const body = (await request.json()) as {
      git?: string;
      diff?: string;
      title?: string;
      baseBranch?: string;
      branch?: string;
    };
    if (!body.git || !body.diff) {
      return NextResponse.json({ error: "Repository and diff are required." }, { status: 400 });
    }
    return NextResponse.json(await commitChanges({
      accessToken: session.accessToken,
      login: session.login,
      gitUrl: body.git,
      diff: body.diff,
      title: body.title?.trim().slice(0, 120) || "Apply OpenDevin changes",
      baseBranch: body.baseBranch,
      branch: body.branch,
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not commit changes." },
      { status: 500 },
    );
  }
}
