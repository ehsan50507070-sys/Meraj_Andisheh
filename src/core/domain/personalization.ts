import type { ContentItem } from './content';

export interface UserTopicAffinity {
  userId: number;
  rootTopicId: number;
  viewCount: number;
  lastViewedAt: string;
}

export interface GuestTopicAffinityEntry {
  rootTopicId: number;
  viewCount: number;
  lastViewedAt: string;
}

export interface PersonalizationTopicScore {
  rootTopicId: number;
  rootTopicName: string;
  viewCount: number;
  lastViewedAt: string;
}

export interface PersonalizationStatus {
  globalEnabled: boolean;
  userEnabled: boolean;
  effectiveEnabled: boolean;
  minViewsThreshold: number;
  topTopics: PersonalizationTopicScore[];
  qualifiesForRecommendations: boolean;
}

export interface PersonalizedContentEntry {
  item: ContentItem;
  topicIds: number[];
  tagIds: number[];
  personIds: number[];
  ageGroupIds: number[];
  primaryTopicName: string | null;
}

export interface PersonalizedRecommendationsResult {
  isVisible: boolean;
  topTopics: PersonalizationTopicScore[];
  items: PersonalizedContentEntry[];
}
