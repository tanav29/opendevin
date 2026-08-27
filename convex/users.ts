import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const githubAuth = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user?.githubAccessToken || !user.githubLogin) return null;
    return {
      accessToken: user.githubAccessToken,
      login: user.githubLogin,
      avatarUrl: user.githubAvatarUrl || user.image || "",
    };
  },
});

export const githubCommitContext = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    const session = await ctx.db.get(sessionId);
    if (!user?.githubAccessToken || !user.githubLogin || session?.ownerId !== userId) return null;
    return {
      accessToken: user.githubAccessToken,
      login: user.githubLogin,
      git: session.git,
      baseBranch: session.baseBranch,
      branch: session.agentBranch,
    };
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return { name: user.name, email: user.email, image: user.image };
  },
});
