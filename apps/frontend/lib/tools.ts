/**
 * Turns a tool call into one readable line: a verb, the thing it acted
 * on, and a result chip. The agent's tools are a small, known set, so we
 * describe them properly instead of dumping JSON at the user.
 */

export type ToolKind =
  | "shell"
  | "read"
  | "write"
  | "edit"
  | "search"
  | "web"
  | "plan"
  | "ask"
  | "agent"
  | "skill"
  | "task"
  | "done"
  | "generic";

export type ChipTone = "neutral" | "success" | "warning" | "danger" | "brand";

export type ToolChip = { text: string; tone: ChipTone };

export type ToolDescriptor = {
  kind: ToolKind;
  /** Present participle while the call is open, past tense once settled. */
  verb: string;
  /** Path, command, pattern, or url — always rendered in mono. */
  subject?: string;
  chip?: ToolChip;
  running: boolean;
  failed: boolean;
  denied: boolean;
  /** Waiting on the user to approve or answer. */
  waiting: boolean;
};

export type ToolPartLike = {
  toolName?: string;
  type?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const RUNNING_STATES = new Set(["input-streaming", "input-available"]);
const WAITING_STATES = new Set(["approval-requested"]);
const FAILED_STATES = new Set(["output-error", "failed-parse", "error"]);
const DENIED_STATES = new Set(["output-denied"]);

/** Namespaced tool names (`mcp:server/tool`) use their last segment. */
export function toolBaseName(name: string) {
  return name.split(/[.:/]/).filter(Boolean).pop() ?? name;
}

function field(source: unknown, ...keys: string[]): unknown {
  if (!source || typeof source !== "object") return undefined;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function text(source: unknown, ...keys: string[]): string | undefined {
  const value = field(source, ...keys);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function num(source: unknown, ...keys: string[]): number | undefined {
  const value = field(source, ...keys);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Verbs per tool, as [progressive, past]. */
const VERBS: Record<string, [ToolKind, string, string]> = {
  bash: ["shell", "Running", "Ran"],
  read_file: ["read", "Reading", "Read"],
  write_file: ["write", "Writing", "Wrote"],
  edit_file: ["edit", "Editing", "Edited"],
  str_replace: ["edit", "Editing", "Edited"],
  multi_edit: ["edit", "Editing", "Edited"],
  glob: ["search", "Finding", "Found"],
  grep: ["search", "Searching", "Searched"],
  list_dir: ["read", "Listing", "Listed"],
  web_fetch: ["web", "Fetching", "Fetched"],
  web_search: ["web", "Searching the web", "Searched the web"],
  todo: ["plan", "Planning", "Updated plan"],
  ask_question: ["ask", "Asking", "Asked"],
  agent: ["agent", "Delegating", "Delegated"],
  load_skill: ["skill", "Loading skill", "Loaded skill"],
  final_output: ["done", "Wrapping up", "Finished"],
};

/** The subject is whichever input field names the thing being acted on. */
function subjectFor(base: string, input: unknown): string | undefined {
  switch (base) {
    case "bash":
      return text(input, "command", "cmd");
    case "web_fetch":
      return text(input, "url");
    case "web_search":
      return text(input, "query", "q");
    case "glob":
    case "grep":
      return text(input, "pattern");
    case "agent":
      return text(input, "message", "prompt", "task");
    case "load_skill":
      return text(input, "skill", "name");
    case "ask_question":
      return text(input, "prompt", "question");
    default:
      return text(input, "filePath", "file_path", "path", "target");
  }
}

function chipFor(
  base: string,
  input: unknown,
  output: unknown,
): ToolChip | undefined {
  switch (base) {
    case "bash": {
      const exitCode = num(output, "exitCode", "exit_code");
      if (exitCode === undefined) return undefined;
      return exitCode === 0
        ? { text: "exit 0", tone: "neutral" }
        : { text: `exit ${exitCode}`, tone: "danger" };
    }
    case "read_file": {
      const lines = num(output, "totalLines", "total_lines");
      return lines === undefined
        ? undefined
        : { text: `${lines} ${lines === 1 ? "line" : "lines"}`, tone: "neutral" };
    }
    case "write_file": {
      const existed = field(output, "existed");
      if (existed === false) return { text: "created", tone: "success" };
      return existed === true ? { text: "updated", tone: "neutral" } : undefined;
    }
    case "glob": {
      const found = num(output, "count");
      return found === undefined
        ? undefined
        : { text: `${found} ${found === 1 ? "file" : "files"}`, tone: "neutral" };
    }
    case "grep": {
      const matches = num(output, "matchCount", "match_count");
      return matches === undefined
        ? undefined
        : {
            text: `${matches} ${matches === 1 ? "match" : "matches"}`,
            tone: matches === 0 ? "neutral" : "brand",
          };
    }
    case "web_search": {
      const results = field(output, "results");
      if (!Array.isArray(results)) return undefined;
      return {
        text: `${results.length} ${results.length === 1 ? "result" : "results"}`,
        tone: "neutral",
      };
    }
    case "todo": {
      const todos = field(input, "todos");
      if (!Array.isArray(todos)) return undefined;
      const done = todos.filter(
        (item) => field(item, "status") === "completed",
      ).length;
      return { text: `${done}/${todos.length}`, tone: "neutral" };
    }
    default:
      return undefined;
  }
}

export function describeTool(part: ToolPartLike): ToolDescriptor {
  const base = toolBaseName(part.toolName ?? part.type?.replace(/^tool-/, "") ?? "tool");
  const state = part.state ?? "";
  const running = RUNNING_STATES.has(state);
  const waiting = WAITING_STATES.has(state);
  const failed = FAILED_STATES.has(state) || Boolean(part.errorText);
  const denied = DENIED_STATES.has(state);

  const known = VERBS[base];
  const kind = known?.[0] ?? (base.startsWith("task") ? "task" : "generic");
  const label = known
    ? known[running || waiting ? 1 : 2]
    : humanize(base, running || waiting);

  const subject = subjectFor(base, part.input);
  let chip: ToolChip | undefined;
  if (failed) chip = { text: "failed", tone: "danger" };
  else if (denied) chip = { text: "skipped", tone: "warning" };
  else chip = chipFor(base, part.input, part.output);

  return {
    kind,
    verb: label,
    subject,
    chip,
    running,
    failed,
    denied,
    waiting,
  };
}

/** `search_replace` → "Search replace" for tools we don't have a verb for. */
function humanize(base: string, progressive: boolean) {
  const words = base.replace(/[_-]+/g, " ").trim();
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  return progressive ? `${label}…` : label;
}
