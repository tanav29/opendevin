import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const GITHUB_SESSION_COOKIE = "opendevin_github";
export const GITHUB_STATE_COOKIE = "opendevin_github_state";

export type GitHubSession = {
  accessToken: string;
  login: string;
  avatarUrl: string;
};

function key() {
  const secret = process.env.GITHUB_COOKIE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("GITHUB_COOKIE_SECRET must be at least 32 characters.");
  }
  return createHash("sha256").update(secret).digest();
}

export function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function unseal<T>(value: string): T | null {
  try {
    const payload = Buffer.from(value, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      payload.subarray(0, 12),
    );
    decipher.setAuthTag(payload.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(payload.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    ) as T;
  } catch {
    return null;
  }
}

export const githubCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
