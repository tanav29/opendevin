import type { Express } from "express";
import { fetchGitHubProfile, githubTokenForUser, listUserRepos } from "../github.js";
import { asyncRoute, currentUser } from "../http.js";

export function registerGitHubRoutes(app: Express): void {
  app.get(
    "/api/github/repos",
    asyncRoute(async (req, res) => {
      const session = await currentUser(req);
      if (!session) return res.status(401).json({ error: "Sign in required", repos: [] });
      const token = await githubTokenForUser(session.user.id);
      if (!token) return res.json({ repos: [], needsAuth: true });
      try {
        const repos = await listUserRepos(token);
        return res.json({ repos });
      } catch (e) {
        const status = (e as { status?: number })?.status;
        if (status === 401)
          return res.status(401).json({ error: "GitHub token expired. Sign in again.", repos: [] });
        if (status && status >= 400 && status < 600)
          return res.status(502).json({ error: `GitHub error ${status}`, repos: [] });
        console.error("GitHub repos exception", e);
        return res.status(500).json({ error: "Could not fetch GitHub repos", repos: [] });
      }
    }),
  );

  app.get(
    "/api/me",
    asyncRoute(async (req, res) => {
      const session = await currentUser(req);
      if (!session) return res.status(401).json({ error: "Sign in required" });
      let github: { login: string | null; avatarUrl: string | null; profileUrl: string | null } = {
        login: null,
        avatarUrl: null,
        profileUrl: null,
      };
      const token = await githubTokenForUser(session.user.id);
      if (token) {
        const profile = await fetchGitHubProfile(token);
        if (profile) github = profile;
      }
      return res.json({
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image ?? null,
        },
        github,
      });
    }),
  );
}
