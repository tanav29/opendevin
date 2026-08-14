import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("projects")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(100),
});

export const get = query({
  args: { id: v.id("projects") },
  handler: ({ db }, { id }) => db.get(id),
});

export const create = mutation({
  args: { git: v.string(), name: v.string() },
  handler: async ({ db }, { git, name }) => {
    const now = Date.now();
    const id = await db.insert("projects", {
      git,
      name,
      createdAt: now,
      updatedAt: now,
    });
    return db.get(id);
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async ({ db }, { id }) => {
    await db.delete(id);
    return { id };
  },
});

// One-off migration that groups pre-existing sessions by their git URL and
// assigns each to a project. Orphaned chat-only sessions (empty git) are left
// untouched. Run with the backend's Convex client after deploying the schema.
export const backfill = mutation({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query("sessions").take(1000);
    const byGit = new Map<string, Id<"sessions">[]>();
    for (const session of sessions) {
      if (!session.git) continue;
      const ids = byGit.get(session.git) ?? [];
      ids.push(session._id);
      byGit.set(session.git, ids);
    }
    const result: string[] = [];
    for (const [git, ids] of byGit) {
      const existing = await ctx.db
        .query("projects")
        .withIndex("by_git", (q) => q.eq("git", git))
        .first();
      let projectId = existing?._id;
      if (!projectId) {
        const now = Date.now();
        const name =
          git.split("/").pop()?.replace(/\.git$/, "") || "repository";
        projectId = await ctx.db.insert("projects", {
          git,
          name,
          createdAt: now,
          updatedAt: now,
        });
        result.push(`created project ${projectId} for ${git}`);
      }
      for (const id of ids) {
        await ctx.db.patch(id, { projectId });
      }
    }
    return { migratedSessions: sessions.length, result };
  },
});