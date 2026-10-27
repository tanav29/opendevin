// Thin client for the skills.sh catalog used by the chat skills picker.
// The unauthenticated /api/search endpoint needs no Vercel OIDC token, so the
// backend can proxy searches for the frontend without keys or CORS issues.

export type SkillRef = {
  id: string; // "{source}/{slug}", the stable skills.sh identifier
  name: string;
  source: string; // GitHub "owner/repo" or well-known source
  slug: string; // skill identifier within the source
  installs?: number;
};

export const SKILL_SEARCH_URL = "https://skills.sh/api/search";

// Shown when the picker opens with an empty query. The skills.sh leaderboard
// API is only served behind Vercel OIDC auth, so pin a snapshot of the most
// installed skills and keep typing searches live.
export const TOP_SKILLS: SkillRef[] = [
  {
    id: "vercel-labs/skills/find-skills",
    name: "find-skills",
    source: "vercel-labs/skills",
    slug: "find-skills",
    installs: 4_100_000,
  },
  {
    id: "anthropics/skills/frontend-design",
    name: "frontend-design",
    source: "anthropics/skills",
    slug: "frontend-design",
    installs: 1_038_000,
  },
  {
    id: "mattpocock/skills/tdd",
    name: "tdd",
    source: "mattpocock/skills",
    slug: "tdd",
    installs: 1_200_000,
  },
  {
    id: "mattpocock/skills/code-review",
    name: "code-review",
    source: "mattpocock/skills",
    slug: "code-review",
    installs: 804_000,
  },
  {
    id: "mattpocock/skills/implement",
    name: "implement",
    source: "mattpocock/skills",
    slug: "implement",
    installs: 787_000,
  },
  {
    id: "vercel-labs/agent-skills/vercel-react-best-practices",
    name: "vercel-react-best-practices",
    source: "vercel-labs/agent-skills",
    slug: "vercel-react-best-practices",
    installs: 844_000,
  },
  {
    id: "vercel-labs/agent-skills/web-design-guidelines",
    name: "web-design-guidelines",
    source: "vercel-labs/agent-skills",
    slug: "web-design-guidelines",
    installs: 790_000,
  },
  {
    id: "anthropics/skills/skill-creator",
    name: "skill-creator",
    source: "anthropics/skills",
    slug: "skill-creator",
    installs: 417_000,
  },
  {
    id: "obra/superpowers/systematic-debugging",
    name: "systematic-debugging",
    source: "obra/superpowers",
    slug: "systematic-debugging",
    installs: 310_000,
  },
  {
    id: "shadcn/ui/shadcn",
    name: "shadcn",
    source: "shadcn/ui",
    slug: "shadcn",
    installs: 271_000,
  },
  {
    id: "prisma/skills/prisma-client-api",
    name: "prisma-client-api",
    source: "prisma/skills",
    slug: "prisma-client-api",
    installs: 393_000,
  },
  {
    id: "supabase/agent-skills/supabase",
    name: "supabase",
    source: "supabase/agent-skills",
    slug: "supabase",
    installs: 346_000,
  },
];

type SearchResponse = {
  skills?: Array<{
    id?: unknown;
    name?: unknown;
    source?: unknown;
    skillId?: unknown;
    installs?: unknown;
  }>;
};

const searchCache = new Map<string, { at: number; skills: SkillRef[] }>();
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 300;

export async function searchSkills(query: string, limit = 30): Promise<SkillRef[]> {
  const q = query.trim().slice(0, 120);
  const cacheKey = `${q}::${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.skills;

  const url = `${SKILL_SEARCH_URL}?q=${encodeURIComponent(q)}&limit=${Math.min(Math.max(limit, 1), 50)}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`skills.sh search failed (${response.status})`);
  const body = (await response.json()) as SearchResponse;
  const skills = (Array.isArray(body.skills) ? body.skills : [])
    .filter(
      (
        skill,
      ): skill is {
        id: string;
        name: string;
        source: string;
        skillId: string;
        installs?: number;
      } =>
        typeof skill.id === "string" &&
        typeof skill.name === "string" &&
        typeof skill.source === "string" &&
        typeof skill.skillId === "string" &&
        skill.skillId.length > 0,
    )
    .map<SkillRef>((skill) => ({
      id: skill.id,
      name: skill.name,
      source: skill.source,
      slug: skill.skillId,
      ...(typeof skill.installs === "number" && Number.isFinite(skill.installs)
        ? { installs: skill.installs }
        : {}),
    }))
    .slice(0, limit);

  if (searchCache.size >= CACHE_MAX_ENTRIES) searchCache.clear();
  searchCache.set(cacheKey, { at: Date.now(), skills });
  return skills;
}
