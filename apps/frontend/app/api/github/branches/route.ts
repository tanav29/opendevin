import { NextRequest, NextResponse } from "next/server";
import { listBranches } from "@/lib/github";
import { githubAuth } from "@/lib/github-auth";

export async function GET(request: NextRequest) {
  const session = await githubAuth(request);
  if (!session) return NextResponse.json({ error: "Sign in with GitHub to continue." }, { status: 401 });
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
