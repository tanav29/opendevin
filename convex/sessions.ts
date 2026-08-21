import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("sessions")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(100),
});

export const get = query({ args: { id: v.id("sessions") }, handler: ({ db }, { id }) => db.get(id) });

export const byEveSessionId = query({
  args: { eveSessionId: v.string() },
  handler: ({ db }, { eveSessionId }) =>
    db
      .query("sessions")
      .withIndex("by_eveSessionId", (q) => q.eq("eveSessionId", eveSessionId))
      .first(),
});

export const create = mutation({
  args: {
    projectId: v.optional(v.id("projects")),
    git: v.string(),
    sandbox: v.optional(v.string()),
    cwd: v.optional(v.string()),
    status: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async ({ db }, args) => {
    const now = Date.now();
    const id = await db.insert("sessions", {
      ...args,
      status: args.status ?? "idle",
      parts: "[]",
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    return db.get(id);
  },
});

export const byProject = query({
  args: { projectId: v.id("projects") },
  handler: (ctx, { projectId }) =>
    ctx.db
      .query("sessions")
      .withIndex("by_projectId_and_archived_and_updatedAt", (q) =>
        q.eq("projectId", projectId).eq("archived", false),
      )
      .order("desc")
      .take(100),
});

export const remove = mutation({
  args: { id: v.id("sessions") },
  handler: async ({ db }, { id }) => {
    await db.delete(id);
    return { id };
  },
});

export const update = mutation({
  args: {
    id: v.id("sessions"),
    archived: v.optional(v.boolean()),
    status: v.optional(v.string()),
    parts: v.optional(v.string()),
    sandbox: v.optional(v.string()),
    cwd: v.optional(v.string()),
    eveSessionId: v.optional(v.string()),
    title: v.optional(v.string()),
    diff: v.optional(v.string()),
    PRNumber: v.optional(v.number()),
    prUrl: v.optional(v.string()),
  },
  handler: async ({ db }, { id, ...changes }) => {
    const data = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    await db.patch(id, { ...data, updatedAt: Date.now() });
    return db.get(id);
  },
});

// Written by the eve agent's hooks and the frontend chat; looks the session up
// by its durable eve session id instead of the convex document id.
export const patchByEveSessionId = mutation({
  args: {
    eveSessionId: v.string(),
    status: v.optional(v.string()),
    diff: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async ({ db }, { eveSessionId, ...changes }) => {
    const doc = await db
      .query("sessions")
      .withIndex("by_eveSessionId", (q) => q.eq("eveSessionId", eveSessionId))
      .first();
    if (!doc) return null;
    // Keep the first user message as the title; later turns must not
    // overwrite the session's name.
    if (changes.title && doc.title) delete changes.title;
    const data = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(data).length === 0) return doc;
    await db.patch(doc._id, { ...data, updatedAt: Date.now() });
    return db.get(doc._id);
  },
});
