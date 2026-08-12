import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
export const list = query({ args: { runId: v.id("runs") }, handler: ({ db }, { runId }) => db.query("events").withIndex("by_run", q => q.eq("runId", runId)).order("asc").collect() });
export const append = mutation({ args: { runId: v.id("runs"), type: v.string(), message: v.string(), payloadJson: v.optional(v.string()), status: v.optional(v.string()) }, handler: async ({ db }, args) => { const last = await db.query("events").withIndex("by_run", q => q.eq("runId", args.runId)).order("desc").first(); const id = await db.insert("events", { ...args, payloadJson: args.payloadJson ?? "{}", sequence: (last?.sequence ?? 0) + 1, createdAt: Date.now() }); return db.get(id); } });
