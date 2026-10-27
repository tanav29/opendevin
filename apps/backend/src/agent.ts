import { stepCountIs, type ModelMessage } from "ai";
import { prisma } from "./db/prisma.js";
import { TOOL_LOG_MAX_MESSAGES } from "./config.js";

export const AGENT_STOP = stepCountIs(25);

// The toolLog column stores the authoritative, ordered model transcript for a
// session (user + assistant + tool messages), so an agent that uses tools on a
// turn can recall its own prior tool calls/results on the next turn, even
// after the server restarts. It complements the `Message` table, which keeps a
// plain-text chat timeline for the UI.
export async function loadToolLog(sessionId: string): Promise<ModelMessage[]> {
  const session = await prisma.projectSession.findUnique({
    where: { id: sessionId },
    select: { toolLog: true },
  });
  const raw = session?.toolLog || "[]";
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ModelMessage[]) : [];
  } catch {
    return [];
  }
}

export async function saveToolLog(sessionId: string, messages: ModelMessage[]) {
  await prisma.projectSession.update({
    where: { id: sessionId },
    data: { toolLog: JSON.stringify(messages) },
  });
}

// Guard against unbounded context: keep the most recent messages and drop
// older ones, but never start the window on an orphan `tool` message (its
// matching assistant tool-call would be gone and the model API would reject
// the history).
export function trimToolLog(
  messages: ModelMessage[],
  maxMessages = TOOL_LOG_MAX_MESSAGES,
): ModelMessage[] {
  if (messages.length <= maxMessages) return messages;
  let start = messages.length - maxMessages;
  while (start < messages.length && messages[start].role === "tool") start++;
  return start < messages.length ? messages.slice(start) : messages.slice(-1);
}

export function buildSystemPrompt(
  workspacePath: string,
  repo: string | null,
  branch: string,
  sandboxNote: string,
  projectInstructions = "",
  skills: SkillSelection[] = [],
): string {
  const repoLine = repo ? `Project repo: ${repo}. ` : "";
  const branchLine = branch ? `Active git branch: ${branch}. ` : "";
  const instructions = projectInstructions
    ? `\n\nRepository instructions from AGENTS.md:\n${projectInstructions}`
    : "";
  return `You are OpenDevin, a concise cloud coding agent working inside an E2B sandbox at ${workspacePath}. ${repoLine}${branchLine}${sandboxNote} Workflow: for non-trivial tasks first call update_plan with 2-8 steps, then work the plan (search/read before edit, edit_file for patches, run_command to verify tests/build). Prefer inspecting real files with list_files/read_file/search before answering. Use web_search for current information and web_fetch to read useful sources; cite source URLs when reporting web-sourced facts. When requirements are ambiguous, call ask_user with 2-4 short options instead of guessing. Keep replies short.${instructions}${buildSkillsNote(skills)}`;
}

export type SkillSelection = { source: string; slug: string };

// The composer appends a <skills> block listing the user's picked skills to
// the message. Parse it server-side so the agent gets exact install commands
// in its system prompt instead of parsing the block itself.
export function parseSkillsBlock(text: string): SkillSelection[] {
  const match = /<skills>([\s\S]*?)<\/skills>/.exec(text);
  if (!match) return [];
  const seen = new Set<string>();
  const skills: SkillSelection[] = [];
  for (const line of match[1].split("\n")) {
    const entry = line.trim();
    const at = entry.lastIndexOf("@");
    if (at <= 0 || at === entry.length - 1) continue;
    const source = entry.slice(0, at);
    const slug = entry.slice(at + 1);
    if (!/^[\w.-]+\/[\w.-]+$/.test(source) || !/^[\w.+-]{1,100}$/.test(slug)) continue;
    const key = `${source}@${slug}`;
    if (seen.has(key) || skills.length >= 10) continue;
    seen.add(key);
    skills.push({ source, slug });
  }
  return skills;
}

const SKILLS_PROTOCOL =
  "Selected skills protocol: install every skill listed below before working on the task. Run each install command with run_command and timeoutMs of at least 180000 (the first run downloads the skills CLI from npm). If an install fails (Node too old, offline, private repo), tell the user that skill could not be installed and continue without it. After each successful install, read `.agents/skills/{slug}/SKILL.md` and follow it as guidance while doing the task. Skills are agent tooling, not project code: `.agents/` and `skills-lock.json` are gitignored and must never be committed, pushed, or described as deliverables.";

export function buildSkillsNote(skills: SkillSelection[]): string {
  if (skills.length === 0) return "";
  const commands = skills
    .map(
      (skill) =>
        `DISABLE_TELEMETRY=1 npx skills add ${skill.source} --skill ${skill.slug} -a universal -y --copy`,
    )
    .join("\n");
  return `\n\n${SKILLS_PROTOCOL}\n\nInstall commands for this turn:\n${commands}`;
}
