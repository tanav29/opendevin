type GitHubRepo = {
  name?: string;
  owner?: { login: string };
  fork?: boolean;
  parent?: { full_name: string };
  default_branch: string;
  permissions?: { push?: boolean };
};

type GitHubTree = {
  tree: Array<{
    path: string;
    mode: string;
    type: string;
    sha: string;
  }>;
};

type FilePatch = {
  oldPath: string | null;
  newPath: string | null;
  patch: string;
};

export type PublishPullRequestInput = {
  accessToken: string;
  login: string;
  gitUrl: string;
  diff: string;
  title: string;
};

const headers = (accessToken: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${accessToken}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
});

async function github<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { ...headers(accessToken), ...init.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message || `GitHub request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function repositoryFromUrl(value: string) {
  const url = new URL(value);
  if (url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Pull requests are only supported for GitHub repositories.");
  }
  const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo) throw new Error("The repository URL is invalid.");
  return { owner, repo };
}

function patchPath(line: string) {
  const value = line.slice(4).split("\t", 1)[0];
  if (value === "/dev/null") return null;
  let path = value;
  if (path.startsWith('"') && path.endsWith('"')) {
    try {
      path = JSON.parse(path) as string;
    } catch {
      throw new Error(`Unsupported Git path: ${path}`);
    }
  }
  return path.startsWith("a/") || path.startsWith("b/")
    ? path.slice(2)
    : path;
}

function parseDiff(diff: string): FilePatch[] {
  if (!diff.trim()) throw new Error("There are no changes to publish.");
  return diff
    .replace(/\r\n/g, "\n")
    .split(/(?=^diff --git )/m)
    .filter((part) => part.startsWith("diff --git "))
    .map((patch) => {
      if (/^GIT binary patch$|^Binary files /m.test(patch)) {
        throw new Error("Binary changes cannot be published yet. Download the patch instead.");
      }
      const oldHeader = patch.match(/^--- (.+)$/m)?.[0];
      const newHeader = patch.match(/^\+\+\+ (.+)$/m)?.[0];
      if (!oldHeader || !newHeader) {
        throw new Error("A changed file has an unsupported patch format.");
      }
      return {
        oldPath: patchPath(oldHeader),
        newPath: patchPath(newHeader),
        patch,
      };
    });
}

function applyPatch(original: string, patch: string) {
  const source = original.replace(/\r\n/g, "\n").split("\n");
  if (source.at(-1) === "") source.pop();
  const output: string[] = [];
  let cursor = 0;
  const lines = patch.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (!match) continue;
    const oldStart = Number(match[1]) - 1;
    output.push(...source.slice(cursor, oldStart));
    cursor = oldStart;

    for (index += 1; index < lines.length; index++) {
      const line = lines[index];
      if (line.startsWith("@@ ") || line.startsWith("diff --git ")) {
        index -= 1;
        break;
      }
      if (line === "\\ No newline at end of file") continue;
      const marker = line[0];
      const text = line.slice(1);
      if (marker === " ") {
        if (source[cursor] !== text) throw new Error("The patch no longer matches the repository base.");
        output.push(text);
        cursor += 1;
      } else if (marker === "-") {
        if (source[cursor] !== text) throw new Error("The patch no longer matches the repository base.");
        cursor += 1;
      } else if (marker === "+") {
        output.push(text);
      }
    }
  }
  output.push(...source.slice(cursor));
  const noFinalNewline = lines.some(
    (line, index) =>
      line === "\\ No newline at end of file" &&
      (lines[index - 1]?.startsWith("+") || lines[index - 1]?.startsWith(" ")),
  );
  return `${output.join("\n")}${noFinalNewline ? "" : "\n"}`;
}

async function waitForFork(accessToken: string, login: string, repo: string) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await github<GitHubRepo>(accessToken, `/repos/${login}/${repo}`);
    } catch (error) {
      if (attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw new Error("GitHub did not finish creating the fork.");
}

async function targetRepository(
  accessToken: string,
  login: string,
  owner: string,
  repo: string,
  upstream: GitHubRepo,
) {
  if (upstream.permissions?.push) return { owner, repo };
  let forkOwner = login;
  let forkRepo = repo;
  try {
    const created = await github<GitHubRepo>(
      accessToken,
      `/repos/${owner}/${repo}/forks`,
      {
        method: "POST",
        body: JSON.stringify({ default_branch_only: true }),
      },
    );
    forkOwner = created.owner?.login || login;
    forkRepo = created.name || repo;
  } catch (error) {
    const existing = await github<GitHubRepo>(
      accessToken,
      `/repos/${login}/${repo}`,
    ).catch(() => null);
    const expectedParent = `${owner}/${repo}`.toLowerCase();
    if (
      !existing?.fork ||
      existing.parent?.full_name.toLowerCase() !== expectedParent
    ) {
      throw error;
    }
  }
  await waitForFork(accessToken, forkOwner, forkRepo);
  return { owner: forkOwner, repo: forkRepo };
}

export async function publishPullRequest(input: PublishPullRequestInput) {
  const source = repositoryFromUrl(input.gitUrl);
  const patches = parseDiff(input.diff);
  const upstream = await github<GitHubRepo>(
    input.accessToken,
    `/repos/${source.owner}/${source.repo}`,
  );
  const target = await targetRepository(
    input.accessToken,
    input.login,
    source.owner,
    source.repo,
    upstream,
  );
  const baseBranch = upstream.default_branch;
  const ref = await github<{ object: { sha: string } }>(
    input.accessToken,
    `/repos/${target.owner}/${target.repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
  );
  const commit = await github<{ tree: { sha: string } }>(
    input.accessToken,
    `/repos/${target.owner}/${target.repo}/git/commits/${ref.object.sha}`,
  );
  const tree = await github<GitHubTree>(
    input.accessToken,
    `/repos/${target.owner}/${target.repo}/git/trees/${commit.tree.sha}?recursive=1`,
  );
  const files = new Map(tree.tree.map((entry) => [entry.path, entry]));
  const entries: Array<{ path: string; mode: string; type: "blob"; sha: string | null }> = [];

  for (const file of patches) {
    if (!file.newPath) {
      if (!file.oldPath || !files.has(file.oldPath)) throw new Error("A deleted file was not found on GitHub.");
      entries.push({ path: file.oldPath, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const existing = file.oldPath ? files.get(file.oldPath) : undefined;
    let original = "";
    if (existing) {
      const blob = await github<{ content: string; encoding: string }>(
        input.accessToken,
        `/repos/${target.owner}/${target.repo}/git/blobs/${existing.sha}`,
      );
      if (blob.encoding !== "base64") throw new Error(`Could not read ${file.oldPath}.`);
      original = Buffer.from(blob.content, "base64").toString("utf8");
    }
    const content = applyPatch(original, file.patch);
    const blob = await github<{ sha: string }>(
      input.accessToken,
      `/repos/${target.owner}/${target.repo}/git/blobs`,
      { method: "POST", body: JSON.stringify({ content, encoding: "utf-8" }) },
    );
    if (file.oldPath && file.oldPath !== file.newPath) {
      entries.push({ path: file.oldPath, mode: "100644", type: "blob", sha: null });
    }
    entries.push({
      path: file.newPath,
      mode: existing?.mode || "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const nextTree = await github<{ sha: string }>(
    input.accessToken,
    `/repos/${target.owner}/${target.repo}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({ base_tree: commit.tree.sha, tree: entries }),
    },
  );
  const nextCommit = await github<{ sha: string }>(
    input.accessToken,
    `/repos/${target.owner}/${target.repo}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: input.title,
        tree: nextTree.sha,
        parents: [ref.object.sha],
      }),
    },
  );
  const branch = `opendevin/${Date.now().toString(36)}`;
  await github(input.accessToken, `/repos/${target.owner}/${target.repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: nextCommit.sha }),
  });
  const pull = await github<{ number: number; html_url: string }>(
    input.accessToken,
    `/repos/${source.owner}/${source.repo}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        body: "Created from changes reviewed in OpenDevin.",
        head: target.owner === source.owner ? branch : `${target.owner}:${branch}`,
        base: baseBranch,
      }),
    },
  );
  return { number: pull.number, url: pull.html_url };
}
