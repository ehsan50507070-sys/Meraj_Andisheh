/**
 * Normalizes Persian/Arabic characters and converts a title into a clean URL slug.
 * Preserves Persian letters, normalizes Arabic 'ي/ك' to Persian 'ی/ک', removes diacritics/kashida,
 * lowercases Latin characters, and collapses spaces/ZWNJ/punctuation into single hyphens.
 */
export function generateSlug(title: string): string {
  if (!title || typeof title !== 'string') {
    return '';
  }

  const normalized = title
    // Normalize Arabic Yeh / Alef Maksura and Kaf to Persian equivalents
    .replace(/[\u064A\u0649]/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    // Remove Arabic/Persian diacritics (harakat, tanwin, superscript alef, Quranic marks)
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    // Remove Tatweel / Kashida
    .replace(/\u0640/g, '')
    // Convert ZWNJ, whitespace, and non-letter/non-digit characters to hyphens
    .toLowerCase()
    .replace(/[^a-z0-9\u0621-\u064A\u067E\u0686\u0698\u06A9\u06AF\u06CC\u06F0-\u06F9]+/g, '-')
    // Collapse consecutive hyphens and trim leading/trailing hyphens
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized;
}

/**
 * Ensures a slug is unique against existing slugs by appending -2, -3, ... when needed.
 */
export function ensureUniqueSlug(baseSlug: string, existingSlugs: readonly string[]): string {
  const cleanedBase = generateSlug(baseSlug) || 'item';
  const existingSet = new Set(existingSlugs.map((slug) => slug.trim().toLowerCase()));

  if (!existingSet.has(cleanedBase.toLowerCase())) {
    return cleanedBase;
  }

  let counter = 2;
  while (existingSet.has(`${cleanedBase}-${counter}`.toLowerCase())) {
    counter += 1;
  }

  return `${cleanedBase}-${counter}`;
}
