import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

const json = v.string();

export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    githubAccessToken: v.optional(v.string()),
    githubLogin: v.optional(v.string()),
    githubAvatarUrl: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),
  projects: defineTable({
    ownerId: v.string(),
    name: v.string(),
    git: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_and_updatedAt", ["ownerId", "updatedAt"])
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
    .index("by_owner_and_updatedAt", ["ownerId", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_eveSessionId", ["eveSessionId"])
    .index("by_projectId_and_archived_and_updatedAt", [
      "projectId",
      "archived",
      "updatedAt",
    ])
    .index("by_owner_and_archived_and_updatedAt", [
      "ownerId",
      "archived",
      "updatedAt",
    ]),
});
