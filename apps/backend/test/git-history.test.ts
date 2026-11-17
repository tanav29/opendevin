import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { readBranchCommits } from "../src/git-history.js";

const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });

test("compares against the selected slash branch", async () => {
  const commands: string[] = [];
  const commits = await readBranchCommits(
    async (command) => {
      commands.push(command);
      if (command.startsWith("git log")) return ok("abc\0change\0\n");
      return ok("false\n");
    },
    "origin",
    "release/v2",
  );
  assert.deepEqual(commits, [{ hash: "abc", subject: "change" }]);
  assert.ok(
    commands.some((command) =>
      command.includes("refs/heads/release/v2:refs/remotes/origin/release/v2"),
    ),
  );
  assert.ok(!commands.some((command) => command.includes("ls-remote")));
});

test("discovers a remote default and reports discovery failure", async () => {
  for (const branch of ["master", "develop", "release/stable"]) {
    const commands: string[] = [];
    await readBranchCommits(
      async (command) => {
        commands.push(command);
        if (command.startsWith("git ls-remote")) return ok(`ref: refs/heads/${branch}\tHEAD\n`);
        return ok("false\n");
      },
      "origin",
      null,
    );
    assert.ok(commands.some((command) => command.includes(`refs/remotes/origin/${branch}..HEAD`)));
  }
  await assert.rejects(
    readBranchCommits(async () => ok(), "origin", null),
    /determine the repository default branch/,
  );
});

test("compares real commits against the selected base and remote default", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-history-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  try {
    git("init", "--bare", "remote.git");
    git("init", "-b", "develop", "work");
    const work = join(root, "work");
    const inWork = (...args: string[]) =>
      execFileSync("git", args, { cwd: work, encoding: "utf8" });
    inWork("config", "user.name", "Test");
    inWork("config", "user.email", "test@example.com");
    inWork("commit", "--allow-empty", "-m", "base");
    inWork("remote", "add", "origin", join(root, "remote.git"));
    inWork("push", "origin", "develop");
    git("--git-dir=remote.git", "symbolic-ref", "HEAD", "refs/heads/develop");
    inWork("checkout", "-b", "release/v2");
    inWork("commit", "--allow-empty", "-m", "release");
    inWork("push", "origin", "release/v2");
    inWork("checkout", "-b", "feature");
    inWork("commit", "--allow-empty", "-m", "feature");
    const shell =
      process.platform === "win32"
        ? join(git("--exec-path").trim(), "../../../bin/bash.exe")
        : "/bin/sh";
    const run = async (command: string) => {
      const result = spawnSync(shell, ["-c", command], { cwd: work, encoding: "utf8" });
      return {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    };
    assert.deepEqual(
      (await readBranchCommits(run, "origin", "release/v2")).map((c) => c.subject),
      ["feature"],
    );
    assert.deepEqual(
      (await readBranchCommits(run, "origin", null)).map((c) => c.subject),
      ["feature", "release"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
