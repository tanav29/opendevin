import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";

async function ownerId(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Sign in to continue.");
  return identity.subject;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const owner = await ownerId(ctx);
    return ctx.db
      .query("projects")
      .withIndex("by_owner_and_updatedAt", (q) => q.eq("ownerId", owner))
      .order("desc")
      .take(100);
  },
});

export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const project = await ctx.db.get(id);
    return project?.ownerId === await ownerId(ctx) ? project : null;
  },
});

export const create = mutation({
  args: { git: v.string(), name: v.string() },
  handler: async (ctx, { git, name }) => {
    const now = Date.now();
    const id = await ctx.db.insert("projects", { ownerId: await ownerId(ctx), git, name, createdAt: now, updatedAt: now });
    return ctx.db.get(id);
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const project = await ctx.db.get(id);
    if (!project || project.ownerId !== await ownerId(ctx)) throw new Error("Project not found.");
    await ctx.db.delete(id);
    return { id };
  },
});

// Legacy data has no owner and is intentionally excluded from all user queries.
// Assign it explicitly from an admin migration instead of exposing it to the first
// account that signs in.
export const backfill = mutation({
  args: {},
  handler: async () => {
    throw new Error("Legacy project migration requires an explicit owner assignment.");
  },
});
