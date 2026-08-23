import { defineHook } from "eve/hooks";
import { api, convex } from "../lib/convex";

const DIFF_LIMIT = 100_000;
const TITLE_LIMIT = 80;

function titleFromMessage(message: unknown): string | undefined {
  if (typeof message === "string") return message.trim().slice(0, TITLE_LIMIT);
  if (Array.isArray(message)) {
    for (const part of message) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: string }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        const text = (part as { text: string }).text.trim();
        if (text) return text.slice(0, TITLE_LIMIT);
      }
    }
  }
  return undefined;
}

async function sync(
  eveSessionId: string,
  patch: { status?: string; diff?: string; title?: string },
) {
  try {
    await convex().mutation(api.sessions.patchByEveSessionId, {
      eveSessionId,
      ...patch,
    });
  } catch (error) {
    console.error("[opendevin] convex sync failed", error);
  }
}

export default defineHook({
  events: {
    async "message.received"(event, ctx) {
      // Name the session after its first user message.
      const title = titleFromMessage(event.data.message);
      if (title) await sync(ctx.session.id, { title });
    },
    async "turn.started"(_event, ctx) {
      await sync(ctx.session.id, { status: "running" });
    },
    async "turn.completed"(_event, ctx) {
      let diff: string | undefined;
      try {
        const sandbox = await ctx.getSandbox();
        const result = await sandbox.run({
          command: "git diff --no-ext-diff --unified=3",
        });
        if (result.exitCode === 0)
          diff = result.stdout.slice(0, DIFF_LIMIT);
      } catch (error) {
        // The sandbox may be unavailable (no backend); keep the last diff.
        console.warn("[opendevin] could not read git diff", error);
      }
      await sync(ctx.session.id, { status: "idle", diff });
    },
    async "turn.cancelled"(_event, ctx) {
      await sync(ctx.session.id, { status: "stopped" });
    },
    async "turn.failed"(_event, ctx) {
      await sync(ctx.session.id, { status: "failed" });
    },
    async "session.failed"(_event, ctx) {
      await sync(ctx.session.id, { status: "failed" });
    },
  },
});
