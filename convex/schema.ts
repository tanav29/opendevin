import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

const json = v.string();

export default defineSchema({
  ...authTables,
  projects: defineTable({
    ownerId: v.string(),
    name: v.string(),
    git: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_updatedAt", ["updatedAt"])
    .index("by_git", ["git"]),
  sessions: defineTable({
    projectId: v.optional(v.id("projects")),
    ownerId: v.string(),
    git: v.string(),
    baseBranch: v.optional(v.string()),
    issueNumber: v.optional(v.number()),
    PRNumber: v.optional(v.number()),
    parts: json,
    archived: v.boolean(),
    status: v.string(),
    sandbox: v.optional(v.string()),
    cwd: v.optional(v.string()),
    // eve owns the sandbox and conversation now; these fields link the
    // convex row to the durable eve session and mirror its state.
    eveSessionId: v.optional(v.string()),
    title: v.optional(v.string()),
    diff: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    publishRepository: v.optional(v.string()),
    agentBranch: v.optional(v.string()),
    commitSha: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_updatedAt", ["updatedAt"])
    .index("by_eveSessionId", ["eveSessionId"])
    .index("by_projectId_and_archived_and_updatedAt", [
      "projectId",
      "archived",
      "updatedAt",
    ]),
});
