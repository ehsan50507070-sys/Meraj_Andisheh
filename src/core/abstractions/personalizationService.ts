import type { AppUser } from '../domain/auth';
import type {
  PersonalizationStatus,
  PersonalizedRecommendationsResult,
  UserTopicAffinity,
} from '../domain/personalization';
import type { AgeGroup } from '../domain/taxonomy';

export interface IUserTopicAffinityRepository {
  getAffinity(userId: number, rootTopicId: number): Promise<UserTopicAffinity | null>;
  getAffinitiesByUserId(userId: number): Promise<UserTopicAffinity[]>;
  upsertAffinity(affinity: UserTopicAffinity): Promise<void>;
  deleteAffinitiesByUserId(userId: number): Promise<number>;
}

export interface RecordCountedViewForPersonalizationInput {
  contentId: number;
  primaryTopicId: number | null;
  userId: number | null;
  visitorId: string;
  occurredAtIso: string;
  currentEventId?: number;
}

export interface IPersonalizationService {
  recordCountedViewAsync(
    input: RecordCountedViewForPersonalizationInput,
  ): Promise<{ incremented: boolean; rootTopicId: number | null }>;

  mergeGuestAffinityOnLoginAsync(
    user: AppUser,
  ): Promise<{ mergedTopicsCount: number }>;

  getPersonalizationStatusAsync(
    user: AppUser | null,
  ): Promise<PersonalizationStatus>;

  getPersonalizedRecommendationsAsync(input: {
    user: AppUser | null;
    activeAgeGroup: AgeGroup | null;
    visitorId?: string | null;
    limit?: number;
  }): Promise<PersonalizedRecommendationsResult>;

  setUserPersonalizationEnabledAsync(
    user: AppUser | null,
    enabled: boolean,
  ): Promise<{ ok: boolean; user?: AppUser; effectiveEnabled: boolean }>;

  clearPersonalizationHistoryAsync(
    user: AppUser | null,
  ): Promise<{ ok: boolean; deletedTopicsCount: number }>;
}
