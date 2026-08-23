import { defineAgent } from "eve";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export default defineAgent({
  // Keep heavy runtime packages out of the compiled agent bundle; they are
  // resolved from the host app's node_modules at runtime.
  build: {
    externalDependencies: ["convex", "convex/react"],
  },
  model: openrouter.chat(process.env.MODEL ?? "openai/gpt-5.4-mini"),
  // Direct provider models skip the AI Gateway catalog lookup, so eve needs
  // the context window declared explicitly for compaction thresholds.
  // (openai/gpt-5.4-mini reports 400k via OpenRouter.)
  modelContextWindowTokens: 400_000,
});
