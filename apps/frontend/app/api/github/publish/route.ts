import { NextRequest, NextResponse } from "next/server";
import { createPullRequest, publishPullRequest } from "@/lib/github";
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
      publishRepository?: string;
    };
    if (!body.git) return NextResponse.json({ error: "Repository is required." }, { status: 400 });
    const title = body.title?.trim().slice(0, 120) || "Apply OpenDevin changes";
    const result = body.branch && body.publishRepository && body.baseBranch
      ? await createPullRequest({
          accessToken: session.accessToken,
          gitUrl: body.git,
          title,
          baseBranch: body.baseBranch,
          branch: body.branch,
          publishRepository: body.publishRepository,
        })
      : body.diff
        ? await publishPullRequest({
            accessToken: session.accessToken,
            login: session.login,
            gitUrl: body.git,
            diff: body.diff,
            title,
            baseBranch: body.baseBranch,
            branch: body.branch,
            publishRepository: body.publishRepository,
          })
        : null;
    if (!result) return NextResponse.json({ error: "Commit changes before creating a pull request." }, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create the pull request." },
      { status: 500 },
    );
  }
}
