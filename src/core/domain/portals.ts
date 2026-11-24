import type {
  ContentFile,
  ContentItem,
  ContentSource,
} from './content';
import type { AgeGroup, ImpactLevel, Person, Tag, Topic } from './taxonomy';
import type { AgePriorityGroup } from '../services/ageRuleService';

export const FILM_KINDS = ['Film', 'Documentary', 'Animation'] as const;
export type FilmKind = (typeof FILM_KINDS)[number];

export const FILM_AGE_RATING_NOTE_MAX_LENGTH = 200;
export const FILM_RELEASE_YEAR_MIN = 1000;
export const FILM_RELEASE_YEAR_MAX = 2200;
export const FILM_RUNTIME_MIN = 1;
export const FILM_RUNTIME_MAX = 10000;
export const DEFAULT_MAX_RELATED_FILMS = 6;

export interface FilmInfo {
  contentId: number;
  kind: FilmKind;
  releaseYear: number | null;
  runtimeMinutes: number | null;
  ageRatingNote: string | null;
  isWeeklyPick: boolean;
}

export const DEFAULT_FILM_INFO_VALUES: Omit<FilmInfo, 'contentId'> = {
  kind: 'Film',
  releaseYear: null,
  runtimeMinutes: null,
  ageRatingNote: null,
  isWeeklyPick: false,
};

export interface FilmPortalItem {
  item: ContentItem;
  filmInfo: FilmInfo;
  topicIds: number[];
  tagIds: number[];
  personIds: number[];
  ageGroupIds: number[];
  primaryTopicName: string | null;
  priorityGroup: AgePriorityGroup;
}

export interface FilmPortalShelf {
  id: string;
  shelfType: 'kind' | 'topic';
  filmKind?: FilmKind;
  topic?: Topic;
  items: FilmPortalItem[];
}

export interface FilmPortalData {
  items: FilmPortalItem[];
  allAllowedFilmsCount: number;
  weeklyPick: FilmPortalItem | null;
  shelves: FilmPortalShelf[];
  countsByKind: Record<FilmKind, number>;
}

export type FilmPortalDataResult =
  | { enabled: false }
  | { enabled: true; data: FilmPortalData };

export interface PublicFilmDetailData {
  item: ContentItem;
  filmInfo: FilmInfo;
  sanitizedBodyHtml: string;
  sources: ContentSource[];
  files: ContentFile[];
  topics: Topic[];
  topicBreadcrumbChain: Topic[];
  primaryRootTopicId: number | null;
  tags: Tag[];
  persons: Person[];
  impactLevel: ImpactLevel | null;
  targetAgeGroups: AgeGroup[];
  relatedFilms: FilmPortalItem[];
}

export type PublicFilmDetailResult =
  | { status: 'not_found' }
  | { status: 'ok'; data: PublicFilmDetailData };

export interface AdminFilmListItem {
  item: ContentItem;
  filmInfo: FilmInfo;
  hasExplicitFilmInfo: boolean;
  primaryTopicName: string | null;
  sourcesCount: number;
  filesCount: number;
}

// Stage 24: Book Portal (BookInfo & Showcase/Detail types)
export const BOOK_AUTHOR_MAX_LENGTH = 200;
export const BOOK_PUBLISHER_MAX_LENGTH = 150;
export const BOOK_PUBLISH_YEAR_MIN = 1;
export const BOOK_PUBLISH_YEAR_MAX = 2200;
export const BOOK_PAGES_MIN = 1;
export const BOOK_PAGES_MAX = 100000;
export const BOOK_KEY_EXCERPTS_MAX_LENGTH = 4000;
export const BOOK_STUDIO_NOTE_MAX_LENGTH = 3000;
export const DEFAULT_MAX_RELATED_BOOKS = 6;

export interface BookInfo {
  contentId: number;
  author: string;
  publisher: string | null;
  publishYear: number | null;
  pages: number | null;
  keyExcerpts: string | null;
  studioNote: string | null;
}

export const DEFAULT_BOOK_INFO_VALUES: Omit<BookInfo, 'contentId'> = {
  author: '',
  publisher: null,
  publishYear: null,
  pages: null,
  keyExcerpts: null,
  studioNote: null,
};

export interface BookPortalItem {
  item: ContentItem;
  bookInfo: BookInfo;
  topicIds: number[];
  tagIds: number[];
  personIds: number[];
  ageGroupIds: number[];
  primaryTopicName: string | null;
  priorityGroup: AgePriorityGroup;
}

export interface BookPortalShelf {
  id: string;
  topic: Topic;
  items: BookPortalItem[];
}

export interface BookPortalData {
  items: BookPortalItem[];
  featuredBooks: BookPortalItem[];
  allAllowedBooksCount: number;
  shelves: BookPortalShelf[];
  availableTopics: Topic[];
}

export type BookPortalDataResult =
  | { enabled: false }
  | { enabled: true; data: BookPortalData };

export interface PublicBookDetailData {
  item: ContentItem;
  bookInfo: BookInfo;
  sanitizedBodyHtml: string;
  sources: ContentSource[];
  files: ContentFile[];
  topics: Topic[];
  topicBreadcrumbChain: Topic[];
  primaryRootTopicId: number | null;
  tags: Tag[];
  persons: Person[];
  impactLevel: ImpactLevel | null;
  targetAgeGroups: AgeGroup[];
  relatedBooks: BookPortalItem[];
}

export type PublicBookDetailResult =
  | { status: 'not_found' }
  | { status: 'ok'; data: PublicBookDetailData };

export interface AdminBookListItem {
  item: ContentItem;
  bookInfo: BookInfo;
  hasExplicitBookInfo: boolean;
  primaryTopicName: string | null;
  sourcesCount: number;
  filesCount: number;
}

