import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
export const list = query({ args: { runId: v.id("runs") }, handler: ({ db }, { runId }) => db.query("artifacts").withIndex("by_run_kind", q => q.eq("runId", runId)).collect() });
export const createMany = mutation({ args: { artifacts: v.array(v.object({ runId: v.id("runs"), kind: v.string(), content: v.string(), truncated: v.boolean(), path: v.optional(v.string()) })) }, handler: async ({ db }, { artifacts }) => { const now = Date.now(); return Promise.all(artifacts.map(a => db.insert("artifacts", { ...a, createdAt: now }))); } });
