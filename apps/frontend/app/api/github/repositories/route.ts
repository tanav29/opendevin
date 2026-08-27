import { NextRequest, NextResponse } from "next/server";
import { listRepositories } from "@/lib/github";
import { githubAuth } from "@/lib/github-auth";

export async function GET(request: NextRequest) {
  const session = await githubAuth(request);
  if (!session) return NextResponse.json({ error: "Sign in with GitHub to continue." }, { status: 401 });

  try {
    return NextResponse.json({ repositories: await listRepositories(session.accessToken) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load GitHub repositories." },
      { status: 502 },
    );
  }
}
