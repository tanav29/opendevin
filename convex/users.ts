import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

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
