/**
 * Clean redundant text from subgroup/page names.
 * Removes:
 * - " for Delica Space Gear HSEUE9" (case-insensitive)
 * - "Схема N(" prefix pattern, keeping just the content in parentheses
 * - Date range codes like "9706.1-", "-0207.3", "9506.1-0108.3"
 * - "ALL " prefix when followed by parenthetical content
 */
export function cleanSubgroupName(name: string): string {
  // Remove vehicle identifier suffix (case-insensitive)
  let cleaned = name.replace(/ for Delica Space Gear HSEUE9/gi, "");

  // Replace "Схема N(...)" with just the parenthetical content
  // e.g., "Схема 1(ALL (LEFT SIDE))" -> "ALL (LEFT SIDE)"
  cleaned = cleaned.replace(/Схема \d+\(([^)]+(?:\([^)]*\)[^)]*)*)\)/g, "$1");

  // Remove date range codes (YYMM.D format)
  // Full range in parentheses: (9706.1-0509.3)
  cleaned = cleaned.replace(/\(\d{4}\.\d-\d{4}\.\d\)/g, "");
  // Full range without parentheses: 9506.1-0108.3
  cleaned = cleaned.replace(/\d{4}\.\d-\d{4}\.\d\s*/g, "");
  // Start of range with dots: ..9706.1-
  cleaned = cleaned.replace(/\.{2}\d{4}\.\d-?/g, "");
  // Start of range: 9706.1- or 9706.1-<space>
  cleaned = cleaned.replace(/\d{4}\.\d-\s*/g, "");
  // End of range only: -0207.3
  cleaned = cleaned.replace(/-\d{4}\.\d\s*/g, "");
  // Date in parentheses at end: (9706.1-)
  cleaned = cleaned.replace(/\(\d{4}\.\d-?\)/g, "");

  // Remove "ALL " prefix when followed by parenthetical content
  // e.g., "ALL (LEFT SIDE)" -> "LEFT SIDE"
  cleaned = cleaned.replace(/\bALL\s+\(([^)]+)\)/g, "$1");

  // Clean up artifacts
  cleaned = cleaned.replace(/\s*\(\s*\)/g, ""); // Empty parentheses
  cleaned = cleaned.replace(/\s+-\s*$/g, ""); // Trailing " -"
  cleaned = cleaned.replace(/^\s*-\s+/g, ""); // Leading "- "
  cleaned = cleaned.replace(/\s{2,}/g, " "); // Multiple spaces
  cleaned = cleaned.replace(/\s*-\s*-\s*/g, " - "); // Double dashes

  // Remove parentheses that wrap the entire content after " - "
  // e.g., "Foo - (BAR)" -> "Foo - BAR"
  cleaned = cleaned.replace(/ - \(([^)]+)\)$/g, " - $1");

  // Remove parentheses that wrap standalone content (no " - " prefix)
  // e.g., "(TIMING BELT COVER)" -> "TIMING BELT COVER"
  cleaned = cleaned.replace(/^\(([^)]+)\)$/g, "$1");

  return cleaned.trim();
}

/**
 * Convert a string to a URL-safe slug.
 * - Transliterates common Cyrillic characters to Latin
 * - Lowercases
 * - Replaces non-alphanumeric with dashes
 * - Collapses multiple dashes
 * - Trims leading/trailing dashes
 */
export function slugify(text: string): string {
  // Cyrillic to Latin transliteration map (common characters)
  const cyrillicMap: Record<string, string> = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "А": "a", "Б": "b", "В": "v", "Г": "g", "Д": "d", "Е": "e", "Ё": "e",
    "Ж": "zh", "З": "z", "И": "i", "Й": "y", "К": "k", "Л": "l", "М": "m",
    "Н": "n", "О": "o", "П": "p", "Р": "r", "С": "s", "Т": "t", "У": "u",
    "Ф": "f", "Х": "kh", "Ц": "ts", "Ч": "ch", "Ш": "sh", "Щ": "shch",
    "Ъ": "", "Ы": "y", "Ь": "", "Э": "e", "Ю": "yu", "Я": "ya",
  };

  let result = "";
  for (const char of text) {
    result += cyrillicMap[char] ?? char;
  }

  return result
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")  // Replace non-alphanumeric with dashes
    .replace(/-+/g, "-")          // Collapse multiple dashes
    .replace(/^-|-$/g, "");       // Trim leading/trailing dashes
}
