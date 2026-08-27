import { NextRequest, NextResponse } from "next/server";
import { commitChanges } from "@/lib/github";
import { githubCommitContext } from "@/lib/github-auth";
import { findSandbox, WORKSPACE } from "@/lib/e2b";
const MAX_DIFF_SIZE = 1_000_000;

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      title?: string;
    };
    if (!body.sessionId || !/^[a-zA-Z0-9_-]+$/.test(body.sessionId)) {
      return NextResponse.json({ error: "A valid session is required." }, { status: 400 });
    }
    const session = await githubCommitContext(request, body.sessionId);
    if (!session) return NextResponse.json({ error: "Sign in with GitHub and access this session to continue." }, { status: 401 });

    const sandbox = await findSandbox(body.sessionId);
    if (!sandbox) return NextResponse.json({ error: "Sandbox not found." }, { status: 404 });
    const { stdout: repositoryRoot } = await sandbox.commands.run("git rev-parse --show-toplevel", { cwd: WORKSPACE });
    if (repositoryRoot.trim() !== WORKSPACE) {
      return NextResponse.json({ error: "Sandbox repository is invalid." }, { status: 409 });
    }
    await sandbox.commands.run("git add -N -- .", { cwd: WORKSPACE });
    const { stdout: diff } = await sandbox.commands.run("git diff --no-ext-diff --unified=3 HEAD -- .", { cwd: WORKSPACE });
    if (!diff.trim()) return NextResponse.json({ error: "There are no changes to commit." }, { status: 400 });
    if (Buffer.byteLength(diff, "utf8") > MAX_DIFF_SIZE) return NextResponse.json({ error: "The diff is too large to commit." }, { status: 413 });

    return NextResponse.json(await commitChanges({
      accessToken: session.accessToken,
      login: session.login,
      gitUrl: session.git,
      diff,
      title: body.title?.trim().slice(0, 120) || "Apply OpenDevin changes",
      baseBranch: session.baseBranch,
      branch: session.branch || `opendevin/${body.sessionId}`,
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not commit changes." },
      { status: 500 },
    );
  }
}
