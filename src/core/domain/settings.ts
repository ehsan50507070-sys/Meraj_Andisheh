export interface SiteSetting {
  key: string;
  value: string;
}

export type FeatureFlagKey =
  | 'Comments'
  | 'ContentRequests'
  | 'Films'
  | 'Books'
  | 'Games'
  | 'StoryGenerator'
  | 'NewsTicker';

export const FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = [
  'Comments',
  'ContentRequests',
  'Films',
  'Books',
  'Games',
  'StoryGenerator',
  'NewsTicker',
] as const;

export interface FeatureFlag {
  key: FeatureFlagKey;
  isEnabled: boolean;
}
