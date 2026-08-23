/**
 * Minimal unified-diff parser. The agent hands us the raw output of
 * `git diff`; the review pane needs per-file paths, change type, and line
 * counts to render a summary without shelling out again.
 */

export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export type PatchFile = {
  /** Stable key for React lists — paths are unique within one patch. */
  id: string;
  /** Path to show: the new path, except for deletions. */
  path: string;
  oldPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  /** The single-file patch, still valid input for a diff renderer. */
  patch: string;
};

export type PatchSummary = {
  files: PatchFile[];
  additions: number;
  deletions: number;
};

const EMPTY: PatchSummary = { files: [], additions: 0, deletions: 0 };

/** Strips git's `a/` `b/` prefixes and optional surrounding quotes. */
function cleanPath(raw: string) {
  let path = raw.trim();
  if (path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1);
  }
  return path.replace(/^[ab]\//, "");
}

/**
 * `diff --git a/x b/y` — split on the ` b/` that starts the second path.
 * Falls back to a midpoint split for paths containing spaces.
 */
function pathsFromHeader(header: string) {
  const rest = header.slice("diff --git ".length).trim();
  const match = /^(.+?) (b\/.+)$/.exec(rest);
  if (!match) return { oldPath: cleanPath(rest), newPath: cleanPath(rest) };
  return { oldPath: cleanPath(match[1]), newPath: cleanPath(match[2]) };
}

function parseFile(patch: string): PatchFile | null {
  const lines = patch.split("\n");
  const header = lines[0];
  if (!header?.startsWith("diff --git ")) return null;

  let { oldPath, newPath } = pathsFromHeader(header);
  let status: FileStatus = "modified";
  let binary = false;
  let additions = 0;
  let deletions = 0;
  let inHunk = false;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!inHunk) {
      if (line.startsWith("@@")) {
        inHunk = true;
        continue;
      }
      if (line.startsWith("new file mode")) status = "added";
      else if (line.startsWith("deleted file mode")) status = "deleted";
      else if (line.startsWith("rename from ")) {
        status = "renamed";
        oldPath = cleanPath(line.slice("rename from ".length));
      } else if (line.startsWith("rename to ")) {
        status = "renamed";
        newPath = cleanPath(line.slice("rename to ".length));
      } else if (line.startsWith("Binary files ")) binary = true;
      else if (line.startsWith("--- ") && line !== "--- /dev/null") {
        oldPath = cleanPath(line.slice(4));
      } else if (line.startsWith("+++ ") && line !== "+++ /dev/null") {
        newPath = cleanPath(line.slice(4));
      }
      continue;
    }
    // Inside hunks, the first column is the change marker.
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }

  const path = status === "deleted" ? oldPath : newPath;
  return {
    id: `${oldPath}→${newPath}`,
    path,
    oldPath: status === "renamed" ? oldPath : undefined,
    status,
    additions,
    deletions,
    binary,
    patch: patch.replace(/\n+$/, ""),
  };
}

/** Splits a multi-file patch and tallies its totals. */
export function parsePatch(diff: string | undefined | null): PatchSummary {
  const text = diff?.trim();
  if (!text) return EMPTY;

  const files = text
    .split(/(?=^diff --git )/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map(parseFile)
    .filter((file): file is PatchFile => file !== null);

  return {
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

const STATUS_LABEL: Record<FileStatus, string> = {
  added: "Added",
  deleted: "Deleted",
  modified: "Modified",
  renamed: "Renamed",
};

export function statusLabel(status: FileStatus) {
  return STATUS_LABEL[status];
}
