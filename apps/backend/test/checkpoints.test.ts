import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import test, { type TestContext } from "node:test";
import { CHECKPOINT_SCRIPT } from "../src/checkpoint-script.js";

const exec = promisify(execFile);

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "opendevin-checkpoint-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, "source");
  await mkdir(source);
  const git = async (...args: string[]) => (await exec("git", args, { cwd: source })).stdout.trim();
  await git("init", "--initial-branch=feature");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Checkpoint test");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(source, "tracked.txt"), "initial\n");
  await writeFile(join(source, "delete.txt"), "delete me\n");
  await writeFile(join(source, ".gitignore"), "ignored.txt\n");
  await git("add", ".");
  await git("commit", "-m", "Source commit");
  const archive = join(dir, "checkpoint.gz");
  const secrets = join(dir, "secrets.json");
  await writeFile(secrets, "[]");
  const run = async (mode: "capture" | "restore", root = source) => {
    try {
      const { stdout } = await exec(
        "python",
        ["-c", CHECKPOINT_SCRIPT, mode, root, archive, secrets],
        { maxBuffer: 60 * 1024 * 1024 },
      );
      return { ok: true, ...JSON.parse(stdout) };
    } catch (error) {
      const out = error as { stdout?: string };
      return { ok: false, ...JSON.parse(out.stdout || "{}") };
    }
  };
  return { dir, source, archive, secrets, git, run };
}

test("restores exact unpushed commits, staging, deletions, and untracked binary files without Git credentials", async (t) => {
  const { dir, source, archive, git, run } = await fixture(t);
  await writeFile(join(source, "tracked.txt"), "unpushed commit\n");
  await git("commit", "-am", "Unpushed work");
  const head = await git("rev-parse", "HEAD");
  await writeFile(join(source, "tracked.txt"), "staged\n");
  await git("add", "tracked.txt");
  await writeFile(join(source, "tracked.txt"), "unstaged after staging\n");
  await rm(join(source, "delete.txt"));
  await writeFile(join(source, "new binary.bin"), Buffer.from([0, 255, 3, 128, 0, 42]));
  await writeFile(join(source, "empty.txt"), "");
  await writeFile(join(source, ".env.local"), "PRIVATE_DATA=excluded\n");
  await writeFile(join(source, "ignored.txt"), "ignored content\n");
  await git("remote", "add", "origin", "https://user:credential@example.com/repo.git");
  await writeFile(join(source, ".git", "credentials"), "not saved");
  const before = await git("status", "--porcelain=v1", "-z", "-uall");
  const captured = await run("capture");
  assert.equal(captured.ok, true, captured.error);
  assert.equal(captured.sourceCommit, head);
  assert.deepEqual(captured.exclusions, [".env.local"]);
  const payload = JSON.parse(gunzipSync(await readFile(archive)).toString());
  assert.equal(JSON.stringify(payload).includes("credential@example"), false);
  assert.equal(
    payload.files.some((f: { path: string }) => f.path === "ignored.txt"),
    false,
  );
  const restored = join(dir, "restored");
  assert.equal((await run("restore", restored)).ok, true);
  const restoredGit = async (...args: string[]) =>
    (await exec("git", ["-c", "core.autocrlf=false", ...args], { cwd: restored })).stdout.trim();
  assert.equal(await restoredGit("rev-parse", "HEAD"), head);
  assert.equal(await restoredGit("rev-parse", "HEAD^"), await git("rev-parse", "HEAD^"));
  assert.equal(await restoredGit("branch", "--show-current"), "feature");
  assert.equal(await restoredGit("show", ":tracked.txt"), "staged");
  assert.equal(await readFile(join(restored, "tracked.txt"), "utf8"), "unstaged after staging\n");
  assert.deepEqual(
    await readFile(join(restored, "new binary.bin")),
    Buffer.from([0, 255, 3, 128, 0, 42]),
  );
  assert.equal(await readFile(join(restored, "empty.txt"), "utf8"), "");
  await assert.rejects(readFile(join(restored, "delete.txt")));
  await assert.rejects(readFile(join(restored, ".env.local")));
  assert.equal(await restoredGit("remote"), "");
  assert.equal(
    await restoredGit("status", "--porcelain=v1", "-z", "-uall"),
    before.replace("?? .env.local\0", ""),
  );
});

test("a shallow source clone remains restorable after its remote disappears", async (t) => {
  const { dir, source, run } = await fixture(t);
  const shallow = join(dir, "shallow");
  await exec("git", ["clone", "--depth=1", pathToFileURL(source).href, shallow]);
  await exec(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "Local only",
    ],
    { cwd: shallow },
  );
  const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: shallow })).stdout.trim();
  assert.equal((await run("capture", shallow)).ok, true);
  await rm(source, { recursive: true, force: true });
  const restored = join(dir, "restored");
  assert.equal((await run("restore", restored)).ok, true);
  assert.equal((await exec("git", ["rev-parse", "HEAD"], { cwd: restored })).stdout.trim(), head);
  assert.equal(
    (await exec("git", ["rev-list", "--count", "HEAD"], { cwd: restored })).stdout.trim(),
    "2",
  );
});

test("preserves staged binary changes, missing staged additions, and file/directory replacements", async (t) => {
  const { dir, source, git, run } = await fixture(t);
  await mkdir(join(source, "folder"));
  await writeFile(join(source, "folder", "child"), "child");
  await writeFile(join(source, "binary.bin"), Buffer.from([0, 1, 2]));
  await git("add", ".");
  await git("commit", "-m", "Binary and directory base");
  await writeFile(join(source, "binary.bin"), Buffer.from([255, 128, 0]));
  await writeFile(join(source, "added-then-deleted"), "staged only");
  await git("add", "binary.bin", "added-then-deleted");
  await rm(join(source, "added-then-deleted"));
  await rm(join(source, "folder"), { recursive: true });
  await writeFile(join(source, "folder"), "now a file");
  await rm(join(source, "tracked.txt"));
  await mkdir(join(source, "tracked.txt"));
  await writeFile(join(source, "tracked.txt", "child"), "now a directory");
  const captured = await run("capture");
  assert.equal(captured.ok, true, captured.error);
  const restored = join(dir, "restored");
  const result = await run("restore", restored);
  assert.equal(result.ok, true, result.error);
  const restoredGit = async (...args: string[]) =>
    (await exec("git", args, { cwd: restored })).stdout.trim();
  assert.equal(await restoredGit("write-tree"), await git("write-tree"));
  assert.equal(await readFile(join(restored, "folder"), "utf8"), "now a file");
  assert.equal(await readFile(join(restored, "tracked.txt", "child"), "utf8"), "now a directory");
  assert.deepEqual(await readFile(join(restored, "binary.bin")), Buffer.from([255, 128, 0]));
  await assert.rejects(readFile(join(restored, "added-then-deleted")));
});

test("refuses secret history and configured environment values without overwriting the last checkpoint", async (t) => {
  const { source, archive, secrets, git, run } = await fixture(t);
  assert.equal((await run("capture")).ok, true);
  const saved = await readFile(archive);
  await writeFile(secrets, JSON.stringify(["private-test-value-1234"]));
  await writeFile(join(source, "notes.txt"), "private-test-value-1234");
  const rejected = await run("capture");
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /configured environment value/);
  assert.deepEqual(await readFile(archive), saved);
  await rm(join(source, "notes.txt"));
  await writeFile(join(source, ".env"), "PASSWORD=secret");
  await git("add", ".env");
  await git("commit", "-m", "Unsafe history");
  await git("rm", ".env");
  await git("commit", "-m", "Remove private file");
  assert.match((await run("capture")).error, /history\/index contains/);
  assert.deepEqual(await readFile(archive), saved);
});

test("rejects symlinks, oversized files, unsafe archive paths, and replacement of a nonempty directory", async (t) => {
  const { dir, source, archive, git, run } = await fixture(t);
  await writeFile(join(source, "large.bin"), Buffer.alloc(5 * 1024 * 1024 + 1));
  assert.match((await run("capture")).error, /exceeds 5 MiB/);
  await rm(join(source, "large.bin"));
  assert.equal((await run("capture")).ok, true);
  assert.match((await run("restore", source)).error, /new empty workspace/);
  const saved = await readFile(archive);
  const payload = JSON.parse(gunzipSync(saved).toString());
  payload.files.push({ path: "../escape.txt", data: "eA==", executable: false });
  await writeFile(archive, gzipSync(JSON.stringify(payload)));
  assert.match((await run("restore", join(dir, "restored"))).error, /unsafe path/);
  await assert.rejects(readFile(join(dir, "escape.txt")));
  await writeFile(archive, saved);
  // Add a symlink directly to the index; this works even without Windows symlink privileges.
  await writeFile(join(dir, "link-target"), "../outside");
  const blob = await git("hash-object", "-w", join(dir, "link-target"));
  await git("update-index", "--add", "--cacheinfo", `120000,${blob},link`);
  assert.match((await run("capture")).error, /symbolic links/);
});
