import type { ISearchNormalizer } from '../abstractions/searchNormalizer';
import {
  ContentStatus,
  type ContentFormat,
} from '../domain/content';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../domain/taxonomy';
import {
  CONTENT_SUMMARY_MAX_LENGTH,
  CONTENT_TITLE_MAX_LENGTH,
  SOURCE_TITLE_MAX_LENGTH,
} from './contentPublishValidator';
import { validateExternalUrl } from './externalLinkService';
import { sanitizeHtml } from './htmlSanitizer';
import { normalizeDigits } from './identifierService';
import { generateSlug } from './slugService';

export type SmartImportSectionKey =
  | 'title'
  | 'summary'
  | 'format'
  | 'topics'
  | 'tags'
  | 'persons'
  | 'ageGroups'
  | 'impactLevel'
  | 'minutes'
  | 'sources'
  | 'body';

export interface SmartImportIssue {
  code:
    | 'EMPTY_INPUT'
    | 'NO_RECOGNIZED_TAGS'
    | 'TITLE_REQUIRED'
    | 'TITLE_TOO_LONG'
    | 'SUMMARY_TOO_LONG'
    | 'UNKNOWN_FORMAT'
    | 'INVALID_MINUTES'
    | 'INVALID_SOURCE_URL'
    | 'UNMATCHED_IMPACT_LEVEL'
    | 'UNMATCHED_AGE_GROUP';
  messageKey: string;
  detail?: string;
}

export interface ParsedSmartSource {
  title: string;
  url: string | null;
  note: string | null;
  sortOrder: number;
}

export interface MissingTopicSuggestion {
  rawText: string;
  name: string;
  parentName: string | null;
  existingParentTopicId: number | null;
}

export interface MissingNameSuggestion {
  name: string;
}

export interface SmartImportSuggestions {
  missingTopics: MissingTopicSuggestion[];
  missingTags: MissingNameSuggestion[];
  missingPersons: MissingNameSuggestion[];
  unmatchedAgeGroups: string[];
  unmatchedImpactLevel: string | null;
}

export interface SmartImportTaxonomyDataset {
  topics: readonly Topic[];
  tags: readonly Tag[];
  persons: readonly Person[];
  impactLevels: readonly ImpactLevel[];
  ageGroups: readonly AgeGroup[];
}

export interface SmartImportParsedDraft {
  status: ContentStatus.Draft;
  title: string;
  slug: string;
  summary: string;
  format: ContentFormat;
  readWatchMinutes: number | null;
  bodyHtml: string;
  sources: ParsedSmartSource[];
  topicIds: number[];
  matchedTopics: Topic[];
  tagIds: number[];
  matchedTags: Tag[];
  personIds: number[];
  matchedPersons: Person[];
  impactLevelId: number | null;
  matchedImpactLevel: ImpactLevel | null;
  ageGroupIds: number[];
  matchedAgeGroups: AgeGroup[];
}

export interface SmartImportParseResult {
  isValid: boolean;
  recognizedTagsCount: number;
  errors: SmartImportIssue[];
  warnings: SmartImportIssue[];
  draft: SmartImportParsedDraft;
  suggestions: SmartImportSuggestions;
}

export interface SmartImportPromptTemplates {
  header: string;
  templateBlock: string;
  rulesBlock: string;
  siteListsHeading: string;
  siteTopicsLabel: string;
  siteAgeGroupsLabel: string;
  siteImpactLevelsLabel: string;
  siteEmptyFallback: string;
}

const MAX_READ_WATCH_MINUTES = 10000;

function normalizeMatchKey(normalizer: ISearchNormalizer, value: string): string {
  return normalizer.normalize(value).replace(/\s+/g, '');
}

const TAG_ALIAS_MAP: Readonly<Record<string, SmartImportSectionKey>> = {
  // Persian aliases (after normalizer + whitespace compaction)
  'عنوان': 'title',
  'تیتر': 'title',
  'نام': 'title',
  'خلاصه': 'summary',
  'چکیده': 'summary',
  'قالب': 'format',
  'نوع': 'format',
  'فرمت': 'format',
  'موضوعات': 'topics',
  'موضوع': 'topics',
  'دستهبندی': 'topics',
  'برچسبها': 'tags',
  'برچسب': 'tags',
  'تگها': 'tags',
  'شخصیتها': 'persons',
  'شخصیت': 'persons',
  'افراد': 'persons',
  'نویسنده': 'persons',
  'سخنران': 'persons',
  'ردهسنی': 'ageGroups',
  'ردهیسنی': 'ageGroups',
  'ردههایسنی': 'ageGroups',
  'گروهسنی': 'ageGroups',
  'مخاطب': 'ageGroups',
  'اثرگذاری': 'impactLevel',
  'سطحاثرگذاری': 'impactLevel',
  'تاثیرگذاری': 'impactLevel',
  'مدت': 'minutes',
  'زمان': 'minutes',
  'مدتزمان': 'minutes',
  'دقیقه': 'minutes',
  'منابع': 'sources',
  'منبع': 'sources',
  'ماخذ': 'sources',
  'متن': 'body',
  'متنکامل': 'body',
  'محتوا': 'body',
  'مقاله': 'body',
  // English aliases
  title: 'title',
  summary: 'summary',
  format: 'format',
  topics: 'topics',
  topic: 'topics',
  tags: 'tags',
  tag: 'tags',
  persons: 'persons',
  person: 'persons',
  agegroup: 'ageGroups',
  agegroups: 'ageGroups',
  impact: 'impactLevel',
  impactlevel: 'impactLevel',
  duration: 'minutes',
  minutes: 'minutes',
  sources: 'sources',
  source: 'sources',
  body: 'body',
};

const FORMAT_ALIAS_MAP: Readonly<Record<string, ContentFormat>> = {
  'ویدیو': 'Video',
  'ویدئو': 'Video',
  'فیلمکوتاه': 'Video',
  video: 'Video',

  'صوت': 'Audio',
  'صدا': 'Audio',
  'پادکست': 'Audio',
  audio: 'Audio',
  podcast: 'Audio',

  'مقاله': 'Article',
  'نوشتار': 'Article',
  'یادداشت': 'Article',
  article: 'Article',

  'اینفوگرافیک': 'Image',
  'تصویر': 'Image',
  'عکس': 'Image',
  'پوستر': 'Image',
  image: 'Image',
  infographic: 'Image',

  'پیدیاف': 'Pdf',
  'جزوه': 'Pdf',
  pdf: 'Pdf',

  'پاورپوینت': 'Presentation',
  'ارائه': 'Presentation',
  'اسلاید': 'Presentation',
  presentation: 'Presentation',
  powerpoint: 'Presentation',

  'کتاب': 'Book',
  book: 'Book',

  'فیلم': 'Film',
  'مستند': 'Film',
  'سینمایی': 'Film',
  film: 'Film',
  documentary: 'Film',
};

function isTemplateBoundaryLine(line: string, normalizer: ISearchNormalizer): boolean {
  const key = normalizeMatchKey(normalizer, line);
  return key === 'شروعقالب' || key === 'پایانقالب';
}

function splitListValues(raw: string, separatorsRegex: RegExp): string[] {
  return raw
    .split(separatorsRegex)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseMinutesValue(raw: string): { valid: boolean; value: number | null } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, value: null };
  }
  const normalized = normalizeDigits(trimmed);
  const match = normalized.match(/(\d+)/);
  if (!match) {
    return { valid: false, value: null };
  }
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_READ_WATCH_MINUTES) {
    return { valid: false, value: null };
  }
  return { valid: true, value: parsed };
}

function normalizeBodyToSanitizedHtml(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return '';
  }

  // First sanitize raw input to strip dangerous tags/scripts before paragraph wrapping
  const sanitized = sanitizeHtml(trimmed);
  if (!sanitized) {
    return '';
  }

  const hasAllowedHtmlTags =
    /<(?:p|h2|h3|h4|ul|ol|li|blockquote|pre|strong|b|em|i|u|a|br|hr|code)\b/i.test(
      sanitized,
    );

  if (hasAllowedHtmlTags) {
    return sanitized;
  }

  // Plain text: split paragraphs cleanly into <p>...</p> and pass through sanitizer again
  const normalizedLines = sanitized.replace(/\r\n?/g, '\n');
  const blocks = normalizedLines.includes('\n\n')
    ? normalizedLines.split(/\n\s*\n+/)
    : normalizedLines.split('\n');

  const htmlParagraphs = blocks
    .map((block) => block.replace(/\n+/g, ' ').trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p>${block}</p>`)
    .join('\n');

  return sanitizeHtml(htmlParagraphs);
}

function resolveTopicEntry(
  rawEntry: string,
  topics: readonly Topic[],
  normalizer: ISearchNormalizer,
): { matched: Topic | null; missing: MissingTopicSuggestion | null } {
  const segments = rawEntry
    .split(/[>/←]+/)
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0);

  if (segments.length === 0) {
    return { matched: null, missing: null };
  }

  if (segments.length === 1) {
    const key = normalizeMatchKey(normalizer, segments[0]);
    const matched =
      topics.find((t) => normalizeMatchKey(normalizer, t.name) === key) ??
      topics.find((t) => normalizeMatchKey(normalizer, t.slug) === key) ??
      null;

    if (matched) {
      return { matched, missing: null };
    }
    return {
      matched: null,
      missing: {
        rawText: rawEntry.trim(),
        name: segments[0],
        parentName: null,
        existingParentTopicId: null,
      },
    };
  }

  // Hierarchical path e.g. "تاریخ > ایران معاصر"
  let currentParentId: number | null = null;
  let currentMatched: Topic | null = null;
  let lastExistingParent: Topic | null = null;
  let failedAtIndex = -1;

  for (let i = 0; i < segments.length; i += 1) {
    const segKey = normalizeMatchKey(normalizer, segments[i]);
    const candidate =
      topics.find(
        (t) =>
          t.parentId === currentParentId &&
          (normalizeMatchKey(normalizer, t.name) === segKey ||
            normalizeMatchKey(normalizer, t.slug) === segKey),
      ) ??
      (i === 0
        ? topics.find(
            (t) =>
              normalizeMatchKey(normalizer, t.name) === segKey ||
              normalizeMatchKey(normalizer, t.slug) === segKey,
          )
        : undefined);

    if (!candidate) {
      failedAtIndex = i;
      break;
    }
    lastExistingParent = candidate;
    currentMatched = candidate;
    currentParentId = candidate.id;
  }

  if (failedAtIndex === -1 && currentMatched) {
    return { matched: currentMatched, missing: null };
  }

  const leafName = segments[segments.length - 1];
  const immediateParentName = segments[segments.length - 2] ?? null;

  return {
    matched: null,
    missing: {
      rawText: rawEntry.trim(),
      name: leafName,
      parentName: immediateParentName,
      existingParentTopicId:
        failedAtIndex === segments.length - 1 && lastExistingParent
          ? lastExistingParent.id
          : null,
    },
  };
}

export function parseSmartImportText(
  rawText: string,
  taxonomy: SmartImportTaxonomyDataset,
  normalizer: ISearchNormalizer,
): SmartImportParseResult {
  const emptyDraft: SmartImportParsedDraft = {
    status: ContentStatus.Draft,
    title: '',
    slug: '',
    summary: '',
    format: 'Article',
    readWatchMinutes: null,
    bodyHtml: '',
    sources: [],
    topicIds: [],
    matchedTopics: [],
    tagIds: [],
    matchedTags: [],
    personIds: [],
    matchedPersons: [],
    impactLevelId: null,
    matchedImpactLevel: null,
    ageGroupIds: [],
    matchedAgeGroups: [],
  };

  const emptySuggestions: SmartImportSuggestions = {
    missingTopics: [],
    missingTags: [],
    missingPersons: [],
    unmatchedAgeGroups: [],
    unmatchedImpactLevel: null,
  };

  if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
    return {
      isValid: false,
      recognizedTagsCount: 0,
      errors: [
        {
          code: 'EMPTY_INPUT',
          messageKey: 'admin.smartImport.error.emptyInput',
        },
      ],
      warnings: [],
      draft: emptyDraft,
      suggestions: emptySuggestions,
    };
  }

  const sectionLines: Record<SmartImportSectionKey, string[]> = {
    title: [],
    summary: [],
    format: [],
    topics: [],
    tags: [],
    persons: [],
    ageGroups: [],
    impactLevel: [],
    minutes: [],
    sources: [],
    body: [],
  };

  let recognizedTagsCount = 0;
  let currentSection: SmartImportSectionKey | null = null;
  const rawLines = rawText.replace(/\r\n?/g, '\n').split('\n');

  for (const rawLine of rawLines) {
    if (isTemplateBoundaryLine(rawLine, normalizer)) {
      continue;
    }

    const headerMatch = rawLine.match(/^\s*\[([^\]]+)\](.*)$/);
    if (headerMatch) {
      const tagKeyNormalized = normalizeMatchKey(normalizer, headerMatch[1]);
      const mappedSection = TAG_ALIAS_MAP[tagKeyNormalized];
      if (mappedSection) {
        recognizedTagsCount += 1;
        currentSection = mappedSection;
        const trailing = headerMatch[2].trim();
        if (trailing.length > 0) {
          sectionLines[mappedSection].push(trailing);
        }
        continue;
      }
    }

    if (currentSection) {
      sectionLines[currentSection].push(rawLine);
    }
  }

  if (recognizedTagsCount === 0) {
    return {
      isValid: false,
      recognizedTagsCount: 0,
      errors: [
        {
          code: 'NO_RECOGNIZED_TAGS',
          messageKey: 'admin.smartImport.error.noRecognizedTags',
        },
      ],
      warnings: [],
      draft: emptyDraft,
      suggestions: emptySuggestions,
    };
  }

  const errors: SmartImportIssue[] = [];
  const warnings: SmartImportIssue[] = [];

  const title = sectionLines.title
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .trim();

  if (!title) {
    errors.push({
      code: 'TITLE_REQUIRED',
      messageKey: 'admin.smartImport.error.titleRequired',
    });
  } else if (title.length > CONTENT_TITLE_MAX_LENGTH) {
    warnings.push({
      code: 'TITLE_TOO_LONG',
      messageKey: 'publish.error.titleTooLong',
    });
  }

  const summary = sectionLines.summary
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .trim();

  if (summary.length > CONTENT_SUMMARY_MAX_LENGTH) {
    warnings.push({
      code: 'SUMMARY_TOO_LONG',
      messageKey: 'publish.error.summaryTooLong',
    });
  }

  // Format
  const rawFormat = sectionLines.format.join(' ').trim();
  let resolvedFormat: ContentFormat = 'Article';
  if (rawFormat.length > 0) {
    const formatKey = normalizeMatchKey(normalizer, rawFormat);
    const mapped = FORMAT_ALIAS_MAP[formatKey];
    if (mapped) {
      resolvedFormat = mapped;
    } else {
      warnings.push({
        code: 'UNKNOWN_FORMAT',
        messageKey: 'admin.smartImport.warning.unknownFormat',
        detail: rawFormat,
      });
    }
  }

  // Duration / Minutes
  const rawMinutes = sectionLines.minutes.join(' ').trim();
  const minutesResult = parseMinutesValue(rawMinutes);
  if (!minutesResult.valid) {
    warnings.push({
      code: 'INVALID_MINUTES',
      messageKey: 'admin.content.error.invalidMinutes',
      detail: rawMinutes,
    });
  }

  // Topics (never auto-create missing items!)
  const matchedTopics: Topic[] = [];
  const seenTopicIds = new Set<number>();
  const missingTopics: MissingTopicSuggestion[] = [];
  const seenMissingTopicKeys = new Set<string>();

  const rawTopicTokens = splitListValues(sectionLines.topics.join(';'), /[;؛,،\n]+/);
  for (const token of rawTopicTokens) {
    const resolved = resolveTopicEntry(token, taxonomy.topics, normalizer);
    if (resolved.matched) {
      if (!seenTopicIds.has(resolved.matched.id)) {
        seenTopicIds.add(resolved.matched.id);
        matchedTopics.push(resolved.matched);
      }
    } else if (resolved.missing) {
      const dedupeKey = normalizeMatchKey(normalizer, resolved.missing.rawText);
      if (!seenMissingTopicKeys.has(dedupeKey)) {
        seenMissingTopicKeys.add(dedupeKey);
        missingTopics.push(resolved.missing);
      }
    }
  }

  // Tags (never auto-create missing items!)
  const matchedTags: Tag[] = [];
  const seenTagIds = new Set<number>();
  const missingTags: MissingNameSuggestion[] = [];
  const seenMissingTagKeys = new Set<string>();

  const rawTagTokens = splitListValues(sectionLines.tags.join(','), /[,،;؛\n]+/);
  for (const token of rawTagTokens) {
    const key = normalizeMatchKey(normalizer, token);
    if (!key) continue;
    const found =
      taxonomy.tags.find((t) => normalizeMatchKey(normalizer, t.name) === key) ??
      taxonomy.tags.find((t) => normalizeMatchKey(normalizer, t.slug) === key) ??
      null;
    if (found) {
      if (!seenTagIds.has(found.id)) {
        seenTagIds.add(found.id);
        matchedTags.push(found);
      }
    } else if (!seenMissingTagKeys.has(key)) {
      seenMissingTagKeys.add(key);
      missingTags.push({ name: token });
    }
  }

  // Persons (never auto-create missing items!)
  const matchedPersons: Person[] = [];
  const seenPersonIds = new Set<number>();
  const missingPersons: MissingNameSuggestion[] = [];
  const seenMissingPersonKeys = new Set<string>();

  const rawPersonTokens = splitListValues(sectionLines.persons.join(';'), /[;؛,،\n]+/);
  for (const token of rawPersonTokens) {
    const key = normalizeMatchKey(normalizer, token);
    if (!key) continue;
    const found =
      taxonomy.persons.find((p) => normalizeMatchKey(normalizer, p.name) === key) ??
      taxonomy.persons.find((p) => normalizeMatchKey(normalizer, p.slug) === key) ??
      null;
    if (found) {
      if (!seenPersonIds.has(found.id)) {
        seenPersonIds.add(found.id);
        matchedPersons.push(found);
      }
    } else if (!seenMissingPersonKeys.has(key)) {
      seenMissingPersonKeys.add(key);
      missingPersons.push({ name: token });
    }
  }

  // AgeGroups (active only)
  const activeAgeGroups = taxonomy.ageGroups.filter((g) => g.isActive);
  const matchedAgeGroups: AgeGroup[] = [];
  const seenAgeGroupIds = new Set<number>();
  const unmatchedAgeGroups: string[] = [];

  const rawAgeTokens = splitListValues(sectionLines.ageGroups.join(','), /[,،;؛\n]+/);
  for (const token of rawAgeTokens) {
    const key = normalizeMatchKey(normalizer, token);
    if (!key) continue;
    const found =
      activeAgeGroups.find((g) => {
        const fullKey = normalizeMatchKey(normalizer, g.name);
        const shortName = g.name.split('(')[0]?.trim() ?? g.name;
        const shortKey = normalizeMatchKey(normalizer, shortName);
        const codeKey = normalizeMatchKey(normalizer, g.key);
        return fullKey === key || shortKey === key || codeKey === key;
      }) ?? null;

    if (found) {
      if (!seenAgeGroupIds.has(found.id)) {
        seenAgeGroupIds.add(found.id);
        matchedAgeGroups.push(found);
      }
    } else {
      unmatchedAgeGroups.push(token);
      warnings.push({
        code: 'UNMATCHED_AGE_GROUP',
        messageKey: 'admin.smartImport.warning.unmatchedAgeGroup',
        detail: token,
      });
    }
  }

  // Impact Level
  const rawImpact = sectionLines.impactLevel.join(' ').trim();
  let matchedImpactLevel: ImpactLevel | null = null;
  let unmatchedImpactLevel: string | null = null;
  if (rawImpact.length > 0) {
    const impactKey = normalizeMatchKey(normalizer, rawImpact);
    matchedImpactLevel =
      taxonomy.impactLevels.find((l) => normalizeMatchKey(normalizer, l.name) === impactKey) ??
      null;
    if (!matchedImpactLevel) {
      unmatchedImpactLevel = rawImpact;
      warnings.push({
        code: 'UNMATCHED_IMPACT_LEVEL',
        messageKey: 'admin.smartImport.warning.unmatchedImpactLevel',
        detail: rawImpact,
      });
    }
  }

  // Sources: "- title | url | note"
  const parsedSources: ParsedSmartSource[] = [];
  for (const line of sectionLines.sources) {
    const cleanedLine = line.replace(/^\s*[-*•–—]+\s*/, '').trim();
    if (!cleanedLine) continue;

    const parts = cleanedLine.split('|');
    const sourceTitle = (parts[0] ?? '').trim().slice(0, SOURCE_TITLE_MAX_LENGTH);
    if (!sourceTitle) continue;

    const rawUrl = (parts[1] ?? '').trim();
    let normalizedSourceUrl: string | null = null;
    if (rawUrl) {
      const urlCheck = validateExternalUrl(rawUrl);
      if (urlCheck.isValid && urlCheck.normalizedUrl) {
        normalizedSourceUrl = urlCheck.normalizedUrl;
      } else {
        warnings.push({
          code: 'INVALID_SOURCE_URL',
          messageKey: 'admin.content.error.invalidUrl',
          detail: rawUrl,
        });
      }
    }

    const rawNote = (parts[2] ?? '').trim();
    parsedSources.push({
      title: sourceTitle,
      url: normalizedSourceUrl,
      note: rawNote || null,
      sortOrder: parsedSources.length + 1,
    });
  }

  // Body HTML sanitized
  const rawBody = sectionLines.body.join('\n');
  const sanitizedBody = normalizeBodyToSanitizedHtml(rawBody);

  const isValid = errors.length === 0;

  return {
    isValid,
    recognizedTagsCount,
    errors,
    warnings,
    draft: {
      status: ContentStatus.Draft,
      title,
      slug: title ? generateSlug(title) : '',
      summary,
      format: resolvedFormat,
      readWatchMinutes: minutesResult.value,
      bodyHtml: sanitizedBody,
      sources: parsedSources,
      topicIds: matchedTopics.map((t) => t.id),
      matchedTopics,
      tagIds: matchedTags.map((t) => t.id),
      matchedTags,
      personIds: matchedPersons.map((p) => p.id),
      matchedPersons,
      impactLevelId: matchedImpactLevel ? matchedImpactLevel.id : null,
      matchedImpactLevel,
      ageGroupIds: matchedAgeGroups.map((a) => a.id),
      matchedAgeGroups,
    },
    suggestions: {
      missingTopics,
      missingTags,
      missingPersons,
      unmatchedAgeGroups,
      unmatchedImpactLevel,
    },
  };
}

export function buildSmartImportPrompt(
  templates: SmartImportPromptTemplates,
  options?: {
    includeSiteLists?: boolean;
    topics?: readonly Topic[];
    activeAgeGroups?: readonly AgeGroup[];
    impactLevels?: readonly ImpactLevel[];
  },
): string {
  const sections: string[] = [
    templates.header.trim(),
    templates.templateBlock.trim(),
    templates.rulesBlock.trim(),
  ];

  if (options?.includeSiteLists) {
    const topicById = new Map<number, Topic>();
    for (const topic of options.topics ?? []) {
      topicById.set(topic.id, topic);
    }

    const topicPaths = (options.topics ?? [])
      .filter((t) => t.isActive)
      .map((topic) => {
        if (topic.parentId !== null) {
          const parent = topicById.get(topic.parentId);
          if (parent) {
            return `${parent.name} > ${topic.name}`;
          }
        }
        return topic.name;
      });

    const ageGroupNames = (options.activeAgeGroups ?? [])
      .filter((g) => g.isActive)
      .map((g) => g.name);

    const impactNames = (options.impactLevels ?? []).map((l) => l.name);

    const listBlock = [
      templates.siteListsHeading,
      `${templates.siteTopicsLabel}: ${topicPaths.length > 0 ? topicPaths.join(' ; ') : templates.siteEmptyFallback}`,
      `${templates.siteAgeGroupsLabel}: ${ageGroupNames.length > 0 ? ageGroupNames.join('، ') : templates.siteEmptyFallback}`,
      `${templates.siteImpactLevelsLabel}: ${impactNames.length > 0 ? impactNames.join('، ') : templates.siteEmptyFallback}`,
    ].join('\n');

    sections.push(listBlock);
  }

  return sections.join('\n\n');
}
