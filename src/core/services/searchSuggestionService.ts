import type { IContentRepository } from '../abstractions/contentRepository';
import type { ISearchNormalizer } from '../abstractions/searchNormalizer';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import {
  ContentStatus,
  type ContentAgeGroup,
  type ContentItem,
} from '../domain/content';
import type { AgeGroup, Person, Topic } from '../domain/taxonomy';
import { isContentAllowedForAgeGroup } from './ageRuleService';
import { defaultSearchNormalizer } from './searchNormalizer';

export const MIN_LIVE_SUGGESTION_CHARS = 2;
export const MAX_LIVE_SUGGESTIONS = 8;

export type LiveSuggestionKind = 'content' | 'topic' | 'person';

export interface LiveSuggestionItem {
  id: string;
  kind: LiveSuggestionKind;
  entityId: number;
  title: string;
  targetHash: string;
  score: number;
}

export interface SearchSuggestionDataset {
  items: readonly ContentItem[];
  topics: readonly Topic[];
  persons: readonly Person[];
  contentAgeGroups: readonly ContentAgeGroup[];
}

function scoreMatch(
  normalizedTitle: string,
  normalizedExtra: string,
  normalizedQuery: string,
  compactQuery: string,
  tokens: readonly string[],
): number {
  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 120;
  }

  const compactTitle = normalizedTitle.replace(/\s+/g, '');
  if (compactQuery.length >= 2 && compactTitle.startsWith(compactQuery)) {
    return 110;
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return 90;
  }

  if (compactQuery.length >= 2 && compactTitle.includes(compactQuery)) {
    return 85;
  }

  if (tokens.length > 1) {
    const allInTitle = tokens.every(
      (tok) => normalizedTitle.includes(tok) || compactTitle.includes(tok),
    );
    if (allInTitle) {
      return 75;
    }
  }

  if (normalizedExtra) {
    if (normalizedExtra.includes(normalizedQuery)) {
      return 50;
    }
    const compactExtra = normalizedExtra.replace(/\s+/g, '');
    if (compactQuery.length >= 2 && compactExtra.includes(compactQuery)) {
      return 45;
    }
    if (tokens.length > 1) {
      const allInCombined = tokens.every(
        (tok) => normalizedExtra.includes(tok) || compactExtra.includes(tok),
      );
      if (allInCombined) {
        return 35;
      }
    }
  }

  return 0;
}

/**
 * Computes up to 8 balanced autocomplete suggestions across:
 * 1) Published age-allowed Contents (#/content/:slug)
 * 2) Active Topics (#/content?topics=:id)
 * 3) Persons (#/content?persons=:id)
 *
 * Returns [] whenever trimmed query has fewer than 2 characters.
 * Enforces Section 3.2 child hard filter so child visitors never see forbidden content suggestions.
 */
export function getLiveSuggestions(
  rawQuery: string,
  activeAgeGroup: AgeGroup | null,
  data: SearchSuggestionDataset,
  normalizer: ISearchNormalizer = defaultSearchNormalizer,
): LiveSuggestionItem[] {
  const trimmed = (rawQuery ?? '').trim();
  if (trimmed.length < MIN_LIVE_SUGGESTION_CHARS) {
    return [];
  }

  const normalizedQuery = normalizer.normalize(trimmed);
  if (!normalizedQuery) {
    return [];
  }
  const compactQuery = normalizedQuery.replace(/\s+/g, '');
  const tokens = normalizedQuery.split(' ').filter((t) => t.length > 0);

  const ageGroupsByContent = new Map<number, number[]>();
  for (const link of data.contentAgeGroups) {
    const arr = ageGroupsByContent.get(link.contentId);
    if (arr) {
      arr.push(link.ageGroupId);
    } else {
      ageGroupsByContent.set(link.contentId, [link.ageGroupId]);
    }
  }

  const contentMatches: LiveSuggestionItem[] = [];
  for (const item of data.items) {
    if (item.status !== ContentStatus.Published) {
      continue;
    }
    const itemAgeIds = ageGroupsByContent.get(item.id) ?? [];
    if (!isContentAllowedForAgeGroup(itemAgeIds, activeAgeGroup)) {
      continue;
    }

    const normTitle = normalizer.normalize(item.title);
    const normExtra = normalizer.normalize(`${item.title} ${item.summary} ${item.searchText}`);
    const score = scoreMatch(normTitle, normExtra, normalizedQuery, compactQuery, tokens);
    if (score > 0) {
      contentMatches.push({
        id: `content:${item.id}`,
        kind: 'content',
        entityId: item.id,
        title: item.title,
        targetHash: `#/content/${encodeURIComponent(item.slug)}`,
        score,
      });
    }
  }

  const topicMatches: LiveSuggestionItem[] = [];
  for (const topic of data.topics) {
    if (!topic.isActive) {
      continue;
    }
    const normName = normalizer.normalize(topic.name);
    const score = scoreMatch(normName, '', normalizedQuery, compactQuery, tokens);
    if (score > 0) {
      topicMatches.push({
        id: `topic:${topic.id}`,
        kind: 'topic',
        entityId: topic.id,
        title: topic.name,
        targetHash: `#/content?topics=${topic.id}`,
        score,
      });
    }
  }

  const personMatches: LiveSuggestionItem[] = [];
  for (const person of data.persons) {
    const normName = normalizer.normalize(person.name);
    const score = scoreMatch(normName, '', normalizedQuery, compactQuery, tokens);
    if (score > 0) {
      personMatches.push({
        id: `person:${person.id}`,
        kind: 'person',
        entityId: person.id,
        title: person.name,
        targetHash: `#/content?persons=${person.id}`,
        score,
      });
    }
  }

  const byScoreThenTitle = (a: LiveSuggestionItem, b: LiveSuggestionItem) =>
    b.score - a.score || a.title.localeCompare(b.title, 'fa');

  contentMatches.sort(byScoreThenTitle);
  topicMatches.sort(byScoreThenTitle);
  personMatches.sort(byScoreThenTitle);

  // Balanced selection up to 8 total: initial quota 4 contents, 2 topics, 2 persons,
  // then fill remaining capacity by highest score across all categories.
  const picked: LiveSuggestionItem[] = [];
  const pickedIds = new Set<string>();

  const pushItems = (source: LiveSuggestionItem[], limit: number) => {
    let added = 0;
    for (const item of source) {
      if (added >= limit || picked.length >= MAX_LIVE_SUGGESTIONS) {
        break;
      }
      if (!pickedIds.has(item.id)) {
        pickedIds.add(item.id);
        picked.push(item);
        added += 1;
      }
    }
  };

  pushItems(contentMatches, 4);
  pushItems(topicMatches, 2);
  pushItems(personMatches, 2);

  if (picked.length < MAX_LIVE_SUGGESTIONS) {
    const remaining = [
      ...contentMatches,
      ...topicMatches,
      ...personMatches,
    ]
      .filter((item) => !pickedIds.has(item.id))
      .sort(byScoreThenTitle);
    pushItems(remaining, MAX_LIVE_SUGGESTIONS - picked.length);
  }

  return picked;
}

export class SearchSuggestionService {
  private readonly contentRepository: IContentRepository;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly searchNormalizer: ISearchNormalizer;

  constructor(
    contentRepository: IContentRepository,
    taxonomyRepository: ITaxonomyRepository,
    searchNormalizer: ISearchNormalizer,
  ) {
    this.contentRepository = contentRepository;
    this.taxonomyRepository = taxonomyRepository;
    this.searchNormalizer = searchNormalizer;
  }

  public async getLiveSuggestionsAsync(
    rawQuery: string,
    activeAgeGroup: AgeGroup | null,
  ): Promise<LiveSuggestionItem[]> {
    const trimmed = (rawQuery ?? '').trim();
    if (trimmed.length < MIN_LIVE_SUGGESTION_CHARS) {
      return [];
    }

    const [items, topics, persons, contentAgeGroups] = await Promise.all([
      this.contentRepository.getAllContentItems(),
      this.taxonomyRepository.getAllTopics(),
      this.taxonomyRepository.getAllPersons(),
      this.contentRepository.getAllContentAgeGroups(),
    ]);

    return getLiveSuggestions(
      trimmed,
      activeAgeGroup,
      {
        items,
        topics,
        persons,
        contentAgeGroups,
      },
      this.searchNormalizer,
    );
  }
}
