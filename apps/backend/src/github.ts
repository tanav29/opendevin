import { prisma } from "./db/prisma.js";

const GITHUB_API = "https://api.github.com";

export function githubHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "opendevin",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function githubTokenForUser(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({ where: { userId, providerId: "github" } });
  return account?.accessToken || null;
}

// Resolve the GitHub user behind an OAuth token so git commits are authored
// as the user, not a synthetic identity. Falls back to null (caller uses
// session profile) when the API is unreachable or the token is stale.
export async function githubIdentityForToken(
  token: string,
): Promise<{ name: string | null; email: string | null; login: string | null } | null> {
  try {
    const headers = githubHeaders(token);
    const res = await fetch(`${GITHUB_API}/user`, { headers });
    if (!res.ok) return null;
    const user = (await res.json()) as {
      login?: string;
      name?: string | null;
      email?: string | null;
      id?: number;
    };
    const login = user.login || null;
    let email = user.email || null;
    if (!email) {
      try {
        const emailsRes = await fetch(`${GITHUB_API}/user/emails`, { headers });
        if (emailsRes.ok) {
          const emails = (await emailsRes.json()) as Array<{
            email?: string;
            primary?: boolean;
            verified?: boolean;
          }>;
          email =
            emails.find((e) => e.primary && e.verified)?.email ||
            emails.find((e) => e.verified)?.email ||
            emails[0]?.email ||
            null;
        }
      } catch {
        // Keep profile email (possibly null) — caller falls back to noreply.
      }
    }
    if (!email && login) {
      email =
        typeof user.id === "number"
          ? `${user.id}+${login}@users.noreply.github.com`
          : `${login}@users.noreply.github.com`;
    }
    return { name: user.name || login, email, login };
  } catch {
    return null;
  }
}

export type GitHubRepoEntry = {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  private: boolean;
  description: string;
  language: string | null;
  stars: number;
  fork: boolean;
  updatedAt: string;
  owner: string;
};

export async function listUserRepos(token: string): Promise<GitHubRepoEntry[]> {
  const res = await fetch(
    `${GITHUB_API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`,
    { headers: githubHeaders(token) },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error = new Error(`GitHub error ${res.status}: ${text.slice(0, 400)}`) as Error & {
      status?: number;
    };
    error.status = res.status;
    throw error;
  }
  const data = (await res.json()) as Array<{
    id: number;
    name: string;
    full_name: string;
    html_url: string;
    clone_url: string;
    private: boolean;
    description: string | null;
    language: string | null;
    stargazers_count: number;
    fork: boolean;
    updated_at: string;
    owner: { login: string };
  }>;
  return data
    .map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      htmlUrl: r.html_url,
      cloneUrl: r.clone_url || `${r.html_url}.git`,
      private: !!r.private,
      description: r.description || "",
      language: r.language,
      stars: r.stargazers_count ?? 0,
      fork: !!r.fork,
      updatedAt: r.updated_at,
      owner: r.owner?.login || "",
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 100);
}

export async function fetchGitHubProfile(token: string): Promise<{
  login: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
} | null> {
  try {
    const res = await fetch(`${GITHUB_API}/user`, { headers: githubHeaders(token) });
    if (!res.ok) return null;
    const d = (await res.json()) as { login?: string; avatar_url?: string; html_url?: string };
    return {
      login: d.login ?? null,
      avatarUrl: d.avatar_url ?? null,
      profileUrl: d.html_url ?? null,
    };
  } catch {
    return null;
  }
}
