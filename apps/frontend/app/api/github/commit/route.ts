import { NextRequest, NextResponse } from "next/server";
import { commitChanges } from "@/lib/github";
import { githubAuth } from "@/lib/github-auth";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const session = await githubAuth(request);
  if (!session) return NextResponse.json({ error: "Sign in with GitHub to continue." }, { status: 401 });

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
