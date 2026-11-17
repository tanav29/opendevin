// Keep both the command setup and the final error/summary when output is large.
export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = "\n... [output truncated] ...\n";
  const head = Math.floor((maxChars - marker.length) / 2);
  return text.slice(0, head) + marker + text.slice(-(maxChars - marker.length - head));
}

// Redact common credential forms and known project secrets before output is stored or sent.
export function redactToolOutput(text: string, secrets: string[] = []): string {
  let safe = text;
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    safe = safe.split(secret).join("[redacted]");
  }
  return safe
    .replace(
      /-----BEGIN [^\r\n-]*PRIVATE KEY-----[\s\S]*?-----END [^\r\n-]*PRIVATE KEY-----/g,
      "[redacted private key]",
    )
    .replace(/Bearer [^\s"']+/gi, "Bearer [redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(
      /\b(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,})\b/g,
      "[redacted]",
    )
    .replace(
      /((?:api[_-]?key|token|secret|password|credential)[\w-]*["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,
      "$1[redacted]",
    );
}
