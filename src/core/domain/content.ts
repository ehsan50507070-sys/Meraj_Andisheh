export type ContentFormat =
  | 'Video'
  | 'Audio'
  | 'Article'
  | 'Image'
  | 'Pdf'
  | 'Presentation'
  | 'Book'
  | 'Film';

export const CONTENT_FORMATS: readonly ContentFormat[] = [
  'Video',
  'Audio',
  'Article',
  'Image',
  'Pdf',
  'Presentation',
  'Book',
  'Film',
] as const;

export enum ContentStatus {
  Draft = 1,
  Published = 2,
  Archived = 3,
}

export enum ContentFileKind {
  Main = 1,
  Preview = 2,
  Attachment = 3,
}

export enum FileStorageType {
  Local = 1,
  S3 = 2,
  External = 3,
}

export interface ContentItem {
  id: number;
  /** Maximum 200 characters */
  title: string;
  /** Maximum 220 characters, unique */
  slug: string;
  /** Maximum 600 characters */
  summary: string;
  body: string | null;
  format: ContentFormat;
  impactLevelId: number | null;
  status: ContentStatus;
  /** ISO 8601 UTC timestamp */
  publishedAt: string | null;
  readWatchMinutes: number | null;
  thumbnailKey: string | null;
  isFeatured: boolean;
  /** Default 'fa' */
  languageCode: string;
  searchText: string;
  viewCount: number;
  downloadCount: number;
  likeCount: number;
  /** Simple numeric reference; foreign key will be wired in Stage 4 */
  createdById: number;
  /** ISO 8601 UTC timestamp */
  createdAt: string;
  /** ISO 8601 UTC timestamp */
  updatedAt: string;
}

export interface ContentSource {
  id: number;
  contentId: number;
  /** Required, maximum 300 characters */
  title: string;
  url: string | null;
  /** Maximum 500 characters */
  note: string | null;
  sortOrder: number;
}

export interface ContentFile {
  id: number;
  contentId: number;
  kind: ContentFileKind;
  storageType: FileStorageType;
  storageKey: string | null;
  externalUrl: string | null;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number | null;
  /** Default true */
  isDownloadable: boolean;
  sortOrder: number;
}

export interface ContentTopic {
  contentId: number;
  topicId: number;
}

export interface ContentTag {
  contentId: number;
  tagId: number;
}

export interface ContentPerson {
  contentId: number;
  personId: number;
}

export interface ContentAgeGroup {
  contentId: number;
  ageGroupId: number;
}
