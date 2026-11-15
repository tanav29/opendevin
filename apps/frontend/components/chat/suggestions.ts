export function parseSuggestions(content: string): string[] {
  const match = [...content.matchAll(/<div data-suggestions='(.*)'>/g)].at(-1);
  if (!match) return [];
  try {
    const value: unknown = JSON.parse(match[1].replace(/&#39;/g, "'"));
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (suggestion): suggestion is string =>
                typeof suggestion === "string" && suggestion.trim().length > 0,
            ),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}
