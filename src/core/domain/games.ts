import type { AgeGroup, Topic } from './taxonomy';
import type { AgePriorityGroup } from '../services/ageRuleService';

export const GAME_TITLE_MAX_LENGTH = 150;
export const GAME_DESCRIPTION_MAX_LENGTH = 2000;
export const GAME_END_MESSAGE_MAX_LENGTH = 1000;
export const GAME_MAX_SCORE_MIN = 1;
export const GAME_MAX_SCORE_LIMIT = 1_000_000;
export const GAME_LEADERBOARD_TOP_LIMIT = 10;

export const ALLOWED_GAME_PACKAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'html',
  'htm',
  'css',
  'js',
  'json',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'mp3',
  'ogg',
  'wav',
  'woff',
  'woff2',
  'ttf',
]);

export const FORBIDDEN_GAME_PACKAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe',
  'bat',
  'cmd',
  'sh',
  'ps1',
  'php',
  'phtml',
  'asp',
  'aspx',
  'jsp',
  'py',
  'rb',
  'pl',
  'cgi',
  'dll',
  'so',
  'dylib',
  'msi',
  'jar',
  'apk',
  'vbs',
  'hta',
  'scr',
  'com',
  'pif',
]);

export interface GameItem {
  id: number;
  title: string;
  slug: string;
  description: string;
  endMessage: string | null;
  thumbnailKey: string | null;
  packageFolder: string;
  topicId: number | null;
  maxScore: number;
  isPublished: boolean;
  createdById: number;
  createdAt: string;
  updatedAt: string;
}

export interface GameAgeGroup {
  gameId: number;
  ageGroupId: number;
}

export interface GameScore {
  id: number;
  gameId: number;
  userId: number;
  score: number;
  createdAt: string;
}

export interface GamePackageEntry {
  path: string;
  mimeType: string;
  sizeBytes: number;
  isText: boolean;
  textContent?: string;
  base64Data?: string;
}

export interface StoredGamePackage {
  packageFolder: string;
  originalZipName: string;
  totalSizeBytes: number;
  filesCount: number;
  entries: GamePackageEntry[];
  createdAt: string;
}

export type GameValidationErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'AUTH_REQUIRED'
  | 'FEATURE_DISABLED'
  | 'ENTITY_NOT_FOUND'
  | 'ZIP_REQUIRED'
  | 'ZIP_INVALID_FORMAT'
  | 'ZIP_MISSING_INDEX_HTML'
  | 'ZIP_FORBIDDEN_FILE_TYPE'
  | 'ZIP_PATH_TRAVERSAL'
  | 'ZIP_TOO_LARGE'
  | 'INVALID_GAME_SCORE'
  | 'VALIDATION_ERROR';

export interface GamePackageValidationResult {
  ok: boolean;
  errorCode?:
    | 'ZIP_REQUIRED'
    | 'ZIP_INVALID_FORMAT'
    | 'ZIP_MISSING_INDEX_HTML'
    | 'ZIP_FORBIDDEN_FILE_TYPE'
    | 'ZIP_PATH_TRAVERSAL'
    | 'ZIP_TOO_LARGE';
  messageKey?: string;
  invalidFileName?: string;
  entries: GamePackageEntry[];
  totalSizeBytes: number;
}

export interface GamePortalItemSummary {
  game: GameItem;
  topicName: string | null;
  ageGroupIds: number[];
  priorityGroup: AgePriorityGroup;
  playersCount: number;
  topScore: number | null;
}

export interface GamePortalData {
  items: GamePortalItemSummary[];
  allAllowedGamesCount: number;
  availableTopics: Topic[];
}

export type GamePortalDataResult =
  | { enabled: false }
  | { enabled: true; data: GamePortalData };

export interface GameLeaderboardEntry {
  rank: number;
  userId: number;
  displayName: string;
  score: number;
  achievedAt: string;
  isCurrentUser: boolean;
}

export interface PublicGameDetailData {
  game: GameItem;
  topic: Topic | null;
  targetAgeGroups: AgeGroup[];
  srcdoc: string;
  leaderboard: GameLeaderboardEntry[];
  currentUserBestScore: number | null;
  currentUserRank: number | null;
  relatedGames: GamePortalItemSummary[];
}

export type PublicGameDetailResult =
  | { status: 'not_found' }
  | { status: 'ok'; data: PublicGameDetailData };

export interface AdminGameListItem {
  game: GameItem;
  topicName: string | null;
  ageGroupIds: number[];
  packageFilesCount: number;
  packageTotalBytes: number;
  scoresCount: number;
}
