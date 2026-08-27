import { findSandbox, WORKSPACE } from "@/lib/e2b";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) return Response.json({ error: "Invalid session id" }, { status: 400 });
  const sandbox = await findSandbox(sessionId);
  if (!sandbox) return Response.json({ diff: "" });
  try {
    await sandbox.commands.run("git add -N -- .", { cwd: WORKSPACE });
    const { stdout } = await sandbox.commands.run("git diff --no-ext-diff --unified=3 HEAD -- .", { cwd: WORKSPACE });
    return Response.json({ diff: stdout });
  } catch {
    return Response.json({ diff: "" });
  }
}
