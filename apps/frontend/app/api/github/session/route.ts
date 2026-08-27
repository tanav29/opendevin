import { NextRequest, NextResponse } from "next/server";
import { githubAuth } from "@/lib/github-auth";

export async function GET(request: NextRequest) {
  const session = await githubAuth(request);
  return NextResponse.json(
    session
      ? { connected: true, login: session.login, avatarUrl: session.avatarUrl }
      : { connected: false },
  );
}
