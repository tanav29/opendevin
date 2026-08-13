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

export const create = mutation({
  args: { git: v.string(), sandbox: v.string(), cwd: v.string(), status: v.optional(v.string()) },
  handler: async ({ db }, args) => { const now = Date.now(); const id = await db.insert("sessions", { ...args, status: args.status ?? "idle", parts: "[]", archived: false, createdAt: now, updatedAt: now }); return db.get(id); },
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
  },
  handler: async ({ db }, { id, ...changes }) => { const data = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)); await db.patch(id, { ...data, updatedAt: Date.now() }); return db.get(id); },
});

export const messages = query({ args: { sessionId: v.id("sessions") }, handler: async ({ db }, { sessionId }) => { const s = await db.get(sessionId); try { const value = JSON.parse(s?.parts ?? "[]"); return Array.isArray(value) ? value : []; } catch { return []; } } });

export const saveMessages = mutation({ args: { id: v.id("sessions"), parts: v.string(), status: v.optional(v.string()) }, handler: async ({ db }, { id, ...data }) => { await db.patch(id, { ...data, updatedAt: Date.now() }); return db.get(id); } });
