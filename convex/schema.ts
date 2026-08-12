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
  runs: defineTable({
    sessionId: v.id("sessions"), prompt: v.string(), status: v.string(),
    planJson: json, summary: v.optional(v.string()), branch: v.optional(v.string()),
    baseBranch: v.optional(v.string()), startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()), cancelledAt: v.optional(v.number()),
    validationStatus: v.optional(v.string()), prTitle: v.optional(v.string()),
    prBody: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_session", ["sessionId", "createdAt"]),
  events: defineTable({
    runId: v.id("runs"), sequence: v.number(), type: v.string(),
    status: v.optional(v.string()), message: v.string(), payloadJson: json, createdAt: v.number(),
  }).index("by_run", ["runId", "sequence"]),
  artifacts: defineTable({
    runId: v.id("runs"), kind: v.string(), path: v.optional(v.string()),
    content: v.string(), truncated: v.boolean(), createdAt: v.number(),
  }).index("by_run_kind", ["runId", "kind"]),
});
