import { findSandbox } from "@/lib/e2b";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    return Response.json({ error: "Invalid session id." }, { status: 400 });
  }

  try {
    const sandbox = await findSandbox(sessionId);
    if (!sandbox) return Response.json({ available: false, error: "Sandbox is not running." });
    return Response.json({ available: true });
  } catch {
    return Response.json({ available: false, error: "Could not reach the sandbox service." }, { status: 502 });
  }
}
