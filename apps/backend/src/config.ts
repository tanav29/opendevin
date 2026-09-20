export const WORKSPACE_PATH = "/home/user/workspace";
export const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000;

export const TOOL_LOG_MAX_MESSAGES = 60;
export const DIFF_MAX_BYTES = 100_000;
export const MAX_UNTRACKED_FILES = 100;

export const LIMITS = {
  messageChars: 20_000,
  replyChars: 100_000,
  fileReadChars: 100_000,
  fileWriteChars: 200_000,
  toolFileReadChars: 20_000,
  toolStdoutChars: 12_000,
  toolStderrChars: 4_000,
  cloneErrorChars: 2_000,
  setupScriptChars: 2_000,
  commitMessageChars: 500,
  routerJsonLimit: "1mb",
} as const;

export function resolveChatModel(): { modelId: string; apiKey: string | undefined } {
  const raw = process.env.MODEL?.trim() || "openai/gpt-4o-mini";
  const modelId = raw.includes("/") ? raw : `openai/${raw}`;
  return { modelId, apiKey: process.env.OPENROUTER_API_KEY };
}

export const config = {
  get port() {
    return Number(process.env.PORT || 3001);
  },
  get frontendUrl() {
    return process.env.FRONTEND_URL || "http://localhost:3000";
  },
} as const;
