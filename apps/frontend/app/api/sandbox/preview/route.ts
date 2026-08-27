import { findSandbox } from "@/lib/e2b";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const port = Number(url.searchParams.get("port") ?? "3000");
  if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    return Response.json({ error: "Invalid session id." }, { status: 400 });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Response.json({ error: "Invalid port." }, { status: 400 });
  }

  const sandbox = await findSandbox(sessionId);
  if (!sandbox) return Response.json({ error: "Sandbox not found." }, { status: 404 });
  return Response.json({ url: sandbox.getHost(port), port });
}
