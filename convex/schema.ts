import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const json = v.string();

export default defineSchema({
  sessions: defineTable({
    git: v.string(),
    issueNumber: v.optional(v.number()),
    PRNumber: v.optional(v.number()),
    parts: json,
    archived: v.boolean(),
    status: v.string(),
    sandbox: v.string(),
    cwd: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_updatedAt", ["updatedAt"]),
});
