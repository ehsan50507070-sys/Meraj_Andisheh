import type {
  ISearchNormalizer,
  SearchTextParts,
} from '../abstractions/searchNormalizer';
import { normalizeDigits } from './identifierService';

function stripHtmlForSearch(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeArabicToPersianChars(input: string): string {
  return input
    // Arabic Yeh / Alef Maksura -> Persian Yeh
    .replace(/[\u064A\u0649\u0626]/g, (ch) => (ch === '\u0626' ? '\u0626' : '\u06CC'))
    // Arabic Kaf -> Persian Kaf
    .replace(/\u0643/g, '\u06A9')
    // Teh Marbuta -> Heh
    .replace(/\u0629/g, '\u0647')
    // Alef with Hamza above/below / Wasla -> bare Alef
    .replace(/[\u0623\u0625\u0671]/g, '\u0627')
    // Remove Tatweel (kashida)
    .replace(/\u0640/g, '')
    // Remove Arabic/Persian diacritics (harakat, tanwin, superscript alef, Quranic marks)
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');
}

function collectZwnjAndPrefixVariants(rawText: string): string[] {
  const variants: string[] = [];
  // Variants where ZWNJ (\u200C) is collapsed completely (e.g. می\u200cشود -> میشود)
  if (rawText.includes('\u200c')) {
    const joined = normalizeArabicToPersianChars(normalizeDigits(rawText))
      .replace(/\u200c+/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (joined) {
      variants.push(joined);
    }
  }

  // Variants where common joined/spaced Persian prefixes (می/نمی) match spaced query or vice-versa
  const spacedText = normalizeArabicToPersianChars(normalizeDigits(rawText))
    .replace(/\u200c+/g, ' ')
    .toLowerCase();

  // If joined form like "میشود" appears, emit spaced "می شود" variant as well
  const joinedMatches = spacedText.matchAll(/(?:^|\s)(ن?می)([\u0621-\u06FF]{2,})(?=\s|$)/g);
  for (const match of joinedMatches) {
    variants.push(`${match[1]} ${match[2]}`);
  }

  // If spaced form like "می شود" appears, emit joined "میشود" variant as well
  const spacedMatches = spacedText.matchAll(/(?:^|\s)(ن?می)\s+([\u0621-\u06FF]{2,})(?=\s|$)/g);
  for (const match of spacedMatches) {
    variants.push(`${match[1]}${match[2]}`);
  }

  return variants;
}

export class SearchNormalizer implements ISearchNormalizer {
  public normalize(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    const noHtml = stripHtmlForSearch(text);
    const persianChars = normalizeArabicToPersianChars(noHtml);
    const asciiDigits = normalizeDigits(persianChars);

    return asciiDigits
      .toLowerCase()
      // Unify ZWNJ and punctuation into clean single spaces
      .replace(/\u200c+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  public buildSearchText(parts: SearchTextParts): string {
    const rawSegments: string[] = [
      parts.title ?? '',
      parts.summary ?? '',
      parts.bodyHtml ?? '',
      ...(parts.topicNames ?? []),
      ...(parts.tagNames ?? []),
      ...(parts.personNames ?? []),
      ...(parts.sourceTitles ?? []),
    ].filter((s) => typeof s === 'string' && s.trim().length > 0);

    const normalizedSegments = rawSegments
      .map((segment) => this.normalize(segment))
      .filter((s) => s.length > 0);

    const variantTokens: string[] = [];
    for (const segment of rawSegments) {
      const noHtml = stripHtmlForSearch(segment);
      for (const variant of collectZwnjAndPrefixVariants(noHtml)) {
        if (variant && !normalizedSegments.includes(variant)) {
          variantTokens.push(variant);
        }
      }
    }

    return [...normalizedSegments, ...variantTokens].join(' ').replace(/\s+/g, ' ').trim();
  }
}

export function matchesNormalizedQuery(
  normalizer: ISearchNormalizer,
  haystackValues: readonly (string | null | undefined)[],
  rawQuery: string,
): boolean {
  const normalizedQuery = normalizer.normalize(rawQuery);
  if (!normalizedQuery) {
    return true;
  }

  const combinedHaystack = haystackValues
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => normalizer.normalize(v))
    .join(' ');

  if (combinedHaystack.includes(normalizedQuery)) {
    return true;
  }

  // Also compare whitespace-compacted forms so "می شود", "می‌شود", and "میشود" always unify
  const compactQuery = normalizedQuery.replace(/\s+/g, '');
  const compactHaystack = combinedHaystack.replace(/\s+/g, '');
  if (compactQuery.length >= 2 && compactHaystack.includes(compactQuery)) {
    return true;
  }

  // Multi-word AND matching across normalized tokens
  const queryTokens = normalizedQuery.split(' ').filter((token) => token.length > 0);
  if (queryTokens.length > 1) {
    return queryTokens.every(
      (token) => combinedHaystack.includes(token) || compactHaystack.includes(token),
    );
  }

  return false;
}

export const defaultSearchNormalizer = new SearchNormalizer();
