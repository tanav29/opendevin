// Keep both the command setup and the final error/summary when output is large.
export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = "\n... [output truncated] ...\n";
  const head = Math.floor((maxChars - marker.length) / 2);
  return text.slice(0, head) + marker + text.slice(-(maxChars - marker.length - head));
}
