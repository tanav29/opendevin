const SEARCH_TIMEOUT_MS = 15_000;

export async function searchWeb(query: string) {
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
