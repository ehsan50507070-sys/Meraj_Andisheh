export type StoryTemplateKey = 'cinematic-dark' | 'light-minimal' | 'quote-focus';

export const STORY_TEMPLATE_KEYS: readonly StoryTemplateKey[] = [
  'cinematic-dark',
  'light-minimal',
  'quote-focus',
] as const;

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
export const STORY_MIME_TYPE = 'image/png' as const;
export const STORY_TITLE_MAX_LENGTH = 150;
export const STORY_QUOTE_MAX_LENGTH = 260;

export const StoryCanvasSpec = Object.freeze({
  width: STORY_WIDTH,
  height: STORY_HEIGHT,
  mimeType: STORY_MIME_TYPE,
  titleMaxLength: STORY_TITLE_MAX_LENGTH,
  quoteMaxLength: STORY_QUOTE_MAX_LENGTH,
} as const);

export interface StoryRenderPayload {
  template: StoryTemplateKey;
  showTitle: boolean;
  title: string;
  quote: string;
  topicName: string | null;
  siteTitle: string;
  siteUrl: string;
  thumbnailDataUrl: string | null;
}
