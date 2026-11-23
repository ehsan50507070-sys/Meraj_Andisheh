import type { GuestTopicAffinityEntry } from '../domain/personalization';

export const GUEST_AFFINITY_COOKIE_NAME = 'ma_aff';
export const GUEST_AFFINITY_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
export const GUEST_AFFINITY_MAX_TOPICS = 20;
export const GUEST_PERSONALIZATION_COOKIE_NAME = 'ma_pers_on';

export interface IGuestAffinityStorage {
  getGuestAffinities(): GuestTopicAffinityEntry[];
  setGuestAffinities(
    entries: readonly GuestTopicAffinityEntry[],
    maxAgeSeconds?: number,
  ): void;
  clearGuestAffinities(): void;
  getGuestPersonalizationEnabled(): boolean;
  setGuestPersonalizationEnabled(enabled: boolean, maxAgeSeconds?: number): void;
  clearGuestPersonalizationPreference(): void;
}
