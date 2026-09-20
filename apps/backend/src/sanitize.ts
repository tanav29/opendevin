export function isRepoUrl(repo: string | null | undefined): repo is string {
  if (!repo) return false;
  const url = repo.trim();
  return url.startsWith("https://") || url.startsWith("http://") || url.startsWith("git@");
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function sanitizeBranch(branch: unknown): string {
  if (typeof branch !== "string") return "";
  const name = branch.trim().slice(0, 200);
  if (!name) return "";
  if (!/^[\w.\-/]+$/.test(name)) return "";
  if (name.includes("..") || name.startsWith("/") || name.startsWith("-")) return "";
  return name;
}

export function projectEnvVars(value: unknown): Record<string, string> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([key, entry]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof entry === "string")
        .slice(0, 50),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

// Workspace-relative path guard. Rejects absolute paths, traversal (`..`
// segments), and backslashes. Returns the clean path, "" for the workspace
// root, or null when invalid.
export function sanitizeRel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.replace(/^\//, "").trim();
  if (!raw || raw === ".") return "";
  if (raw.includes("\\")) return null;
  const parts = raw.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0) return "";
  if (parts.some((p) => p === "..")) return null;
  return parts.join("/");
}

export function parseGitHubRepo(repo: string): { owner: string; name: string } | null {
  const match = repo.trim().match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return match ? { owner: match[1], name: match[2] } : null;
}
