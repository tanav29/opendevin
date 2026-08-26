import { defineSandbox } from "eve/sandbox";
import { api, convex } from "../lib/convex";

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;

const shellArg = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

// The convex row for a session is created by the UI before the first message
// is sent, but the eve session id is only linked to it after the create-session
// response reaches the browser. Poll briefly so a fast first tool call still
// finds the selected repository and branch.
async function findCheckout(eveSessionId: string): Promise<{ git: string; baseBranch?: string } | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    try {
      const row = await convex().query(api.sessions.byEveSessionId, {
        eveSessionId,
      });
      if (row?.git) return { git: row.git, baseBranch: row.baseBranch };
    } catch {
      // Convex may not be configured; fall through to the retry loop.
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export default defineSandbox({
  description: "Clones the session's repository into /workspace",
  async onSession({ ctx, use: openSession }) {
    const sandbox = await openSession();
    const checkout = await findCheckout(ctx.session.id);
    if (!checkout) {
      console.warn(
        `[opendevin] no git URL found for eve session ${ctx.session.id}; ` +
          "the workspace was not populated",
      );
      return;
    }
    // Workspace persists across turns; only clone once per session.
    await sandbox.run({
      command: [
        "if [ -d /workspace/.git ]; then",
        "  echo 'workspace already populated';",
        "else",
        `  git clone${checkout.baseBranch ? ` --branch ${shellArg(checkout.baseBranch)} --single-branch` : ""} ${shellArg(checkout.git)} /workspace/.repo`,
        "  && cp -a /workspace/.repo/. /workspace/",
        "  && rm -rf /workspace/.repo",
        "  && echo 'workspace populated';",
        "fi",
      ].join(" "),
    });
  },
});
