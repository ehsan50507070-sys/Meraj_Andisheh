export type HomeShelfType =
  | 'Personalized'
  | 'Trending'
  | 'Latest'
  | 'ByTopic'
  | 'Featured';

export const HOME_SHELF_TYPES: readonly HomeShelfType[] = [
  'Personalized',
  'Trending',
  'Latest',
  'ByTopic',
  'Featured',
] as const;

export const DEFAULT_HOME_ITEMS_PER_SHELF = 12;

export const MAX_HERO_SLIDE_TITLE = 150;
export const MAX_HERO_SLIDE_SUBTITLE = 300;
export const MAX_HERO_SLIDE_LINK_URL = 500;
export const MAX_HOME_SHELF_TITLE = 120;
export const MAX_STATIC_PAGE_TITLE = 150;
export const MAX_STATIC_PAGE_SLUG = 120;
export const MAX_STATIC_PAGE_BODY = 50000;
export const MAX_ANNOUNCEMENT_TEXT = 250;
export const MAX_ANNOUNCEMENT_LINK_URL = 500;

export type AnnouncementComputedStatus =
  | 'ActiveNow'
  | 'Scheduled'
  | 'Expired'
  | 'Disabled';

export interface HeroSlide {
  id: number;
  title: string;
  subtitle: string;
  imageKey: string | null;
  linkUrl: string;
  sortOrder: number;
  isActive: boolean;
  ageGroupId: number | null;
}

export interface HomeShelf {
  id: number;
  title: string;
  type: HomeShelfType;
  topicId: number | null;
  sortOrder: number;
  isVisible: boolean;
}

export interface StaticPage {
  id: number;
  slug: string;
  title: string;
  body: string;
  showInFooter: boolean;
  sortOrder: number;
}

export interface AnnouncementItem {
  id: number;
  text: string;
  linkUrl: string | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}
