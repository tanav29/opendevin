import { defineTool } from "eve/tools";
import { z } from "zod";

const SEARCH_TIMEOUT_MS = 15_000;

async function search(query: string) {
  const response = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OpenDevin)" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    },
  );
  if (!response.ok)
    throw new Error(`Web search failed with status ${response.status}.`);
  const html = await response.text();
  const results: { title: string; url: string; snippet: string }[] = [];
  const blocks = html.split('<div class="result ');
  for (const block of blocks.slice(1)) {
    const title = block.match(/class="result__a"[^>]*>([^<]+)</)?.[1]?.trim();
    const url = decodeURIComponent(
      block.match(/class="result__a"[^>]*href="([^"]+)"/)?.[1] ?? "",
    );
    const snippet = block
      .match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1]
      ?.replace(/<[^>]+>/g, "")
      .trim();
    if (title && url) results.push({ title, url, snippet: snippet ?? "" });
    if (results.length >= 5) break;
  }
  return { query, results };
}

export default defineTool({
  description:
    "Search the web for up-to-date information and return the top result titles, URLs, and snippets.",
  inputSchema: z.object({ query: z.string().min(1) }),
  async execute({ query }) {
    return search(query);
  },
});
