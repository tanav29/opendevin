import { Sandbox } from "e2b";

export const WORKSPACE = "/workspace";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function findSandbox(sessionId: string) {
  const page = Sandbox.list({ query: { metadata: { sessionId } }, limit: 1 });
  const [info] = await page.nextItems();
  return info ? Sandbox.connect(info.sandboxId, { timeoutMs: 3_600_000 }) : null;
}

export async function getSandbox(sessionId: string, git: string, baseBranch?: string, accessToken?: string) {
  const existing = await findSandbox(sessionId);
  if (existing) return existing;

  const sandbox = await Sandbox.create({
    metadata: { sessionId },
    timeoutMs: 3_600_000,
    allowInternetAccess: true,
  });
  const branch = baseBranch ? ` --branch ${shellQuote(baseBranch)} --single-branch` : "";
  const auth = accessToken
    ? ` -c http.extraheader=${shellQuote(`AUTHORIZATION: bearer ${accessToken}`)}`
    : "";
  const result = await sandbox.commands.run(
    `git${auth} clone${branch} ${shellQuote(git)} ${WORKSPACE}`,
    { timeoutMs: 120_000 },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr || "Could not clone the repository.");
  return sandbox;
}
