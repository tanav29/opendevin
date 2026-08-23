/** Human-facing formatting for times, counts, and paths. */

const UNITS: [limit: number, divisor: number, suffix: string][] = [
  [60, 1, "s"],
  [3600, 60, "m"],
  [86400, 3600, "h"],
  [604800, 86400, "d"],
];

/** Compact relative time: "just now", "4m", "3h", "2d", "Mar 4". */
export function timeAgo(value: string | number | Date) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 45) return "just now";
  for (const [limit, divisor, suffix] of UNITS) {
    if (seconds < limit) return `${Math.floor(seconds / divisor)}${suffix}`;
  }
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Absolute timestamp for tooltips, where the exact moment matters. */
export function timestamp(value: string | number | Date) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Elapsed time at a resolution that stays readable as it grows. */
export function duration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function plural(count: number, word: string, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`;
}

/** Thousands separators, so large diffs stay scannable. */
export function count(value: number) {
  return value.toLocaleString();
}

export function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** `https://github.com/vercel/next.js.git` → `vercel/next.js` */
export function repoName(git: string) {
  const parts = git.replace(/\.git$/, "").split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || git;
}

/**
 * Keeps the tail of a path, which is the part that identifies the file.
 * `apps/frontend/components/chat/message.tsx` → `…/chat/message.tsx`
 */
export function shortPath(path: string, segments = 2) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= segments) return path;
  return `…/${parts.slice(-segments).join("/")}`;
}

/** Collapses a command to its first line so it fits on one row. */
export function firstLine(value: string, max = 120) {
  const line = value.trim().split("\n")[0] ?? "";
  const flat = line.length > max ? `${line.slice(0, max - 1)}…` : line;
  return value.trim().includes("\n") ? `${flat} ↵` : flat;
}
