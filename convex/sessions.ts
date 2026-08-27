import { mutation, query } from "./_generated/server";
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
      .query("sessions")
      .withIndex("by_owner_and_updatedAt", (q) => q.eq("ownerId", owner))
      .order("desc")
      .take(100);
  },
});

export const get = query({
  args: { id: v.id("sessions") },
  handler: async (ctx, { id }) => {
    const session = await ctx.db.get(id);
    return session?.ownerId === await ownerId(ctx) ? session : null;
  },
});

// The Eve sandbox uses this lookup before it has a browser-authenticated Convex
// client. Eve session IDs are high-entropy runtime IDs and only expose checkout
// metadata needed to prepare that one workspace.
export const byEveSessionId = query({
  args: { eveSessionId: v.string() },
  handler: ({ db }, { eveSessionId }) =>
    db.query("sessions").withIndex("by_eveSessionId", (q) => q.eq("eveSessionId", eveSessionId)).first(),
});

export const create = mutation({
  args: {
    projectId: v.optional(v.id("projects")), git: v.string(), baseBranch: v.optional(v.string()),
    sandbox: v.optional(v.string()), cwd: v.optional(v.string()), status: v.optional(v.string()), title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const owner = await ownerId(ctx);
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.ownerId !== owner) throw new Error("Project not found.");
    }
    const now = Date.now();
    const id = await ctx.db.insert("sessions", { ...args, ownerId: owner, status: args.status ?? "idle", parts: "[]", archived: false, createdAt: now, updatedAt: now });
    return ctx.db.get(id);
  },
});

export const byProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const owner = await ownerId(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== owner) return [];
    return ctx.db.query("sessions").withIndex("by_projectId_and_archived_and_updatedAt", (q) => q.eq("projectId", projectId).eq("archived", false)).order("desc").take(100);
  },
});

export const remove = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, { id }) => {
    const session = await ctx.db.get(id);
    if (!session || session.ownerId !== await ownerId(ctx)) throw new Error("Session not found.");
    await ctx.db.delete(id);
    return { id };
  },
});

export const update = mutation({
  args: {
    id: v.id("sessions"), archived: v.optional(v.boolean()), status: v.optional(v.string()), parts: v.optional(v.string()),
    sandbox: v.optional(v.string()), cwd: v.optional(v.string()), baseBranch: v.optional(v.string()), eveSessionId: v.optional(v.string()),
    title: v.optional(v.string()), diff: v.optional(v.string()), publishRepository: v.optional(v.string()), agentBranch: v.optional(v.string()),
    commitSha: v.optional(v.string()), PRNumber: v.optional(v.number()), prUrl: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...changes }) => {
    const session = await ctx.db.get(id);
    if (!session || session.ownerId !== await ownerId(ctx)) throw new Error("Session not found.");
    const data = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    await ctx.db.patch(id, { ...data, updatedAt: Date.now() });
    return ctx.db.get(id);
  },
});

// Written by the Eve runtime after it has been linked to a session. This must
// remain callable without a browser JWT so the isolated sandbox can persist its
// state; it can only address a high-entropy Eve session ID.
export const patchByEveSessionId = mutation({
  args: { eveSessionId: v.string(), status: v.optional(v.string()), diff: v.optional(v.string()), title: v.optional(v.string()) },
  handler: async ({ db }, { eveSessionId, ...changes }) => {
    const doc = await db.query("sessions").withIndex("by_eveSessionId", (q) => q.eq("eveSessionId", eveSessionId)).first();
    if (!doc) return null;
    if (changes.title && doc.title) delete changes.title;
    const data = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    if (Object.keys(data).length === 0) return doc;
    await db.patch(doc._id, { ...data, updatedAt: Date.now() });
    return db.get(doc._id);
  },
});
