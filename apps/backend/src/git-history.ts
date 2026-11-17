import { shellQuote } from "./sanitize.js";
import type { SandboxResult } from "./sandbox.js";

export class GitHistoryError extends Error {}

type Run = (command: string) => Promise<SandboxResult>;

export async function readBranchCommits(run: Run, remote: string, selectedBase: string | null) {
  let base = selectedBase;
  if (!base) {
    const discovery = await run(`git ls-remote --symref ${shellQuote(remote)} HEAD`);
    base =
      discovery.exitCode === 0
        ? (discovery.stdout.match(/^ref: refs\/heads\/(.+)\s+HEAD$/m)?.[1] ?? null)
        : null;
    if (!base)
      throw new GitHistoryError(
        "Could not determine the repository default branch. Check the remote connection and refresh.",
      );
  }
  const valid = await run(`git check-ref-format ${shellQuote(`refs/heads/${base}`)}`);
  if (valid.exitCode !== 0) throw new GitHistoryError("The comparison base branch is invalid.");
  const shallow = await run("git rev-parse --is-shallow-repository");
  if (shallow.exitCode !== 0)
    throw new GitHistoryError("Could not inspect the repository history.");
  const ref = `refs/heads/${base}`;
  const fetch = await run(
    `git fetch --no-tags ${shallow.stdout.trim() === "true" ? "--unshallow " : ""}${shellQuote(remote)} ${shellQuote(`+${ref}:refs/remotes/origin/${base}`)}`,
  );
  if (fetch.exitCode !== 0)
    throw new GitHistoryError(
      `Could not fetch comparison base branch ${base}. Check that it exists and refresh.`,
    );
  const log = await run(
    `git log --format='%h%x00%s%x00' ${shellQuote(`refs/remotes/origin/${base}..HEAD`)}`,
  );
  if (log.exitCode !== 0)
    throw new GitHistoryError(`Could not compare the workspace with ${base}.`);
  const parts = log.stdout.replace(/\n/g, "").split("\0");
  const commits: { hash: string; subject: string }[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (parts[i]) commits.push({ hash: parts[i], subject: parts[i + 1] });
  }
  return commits;
}
