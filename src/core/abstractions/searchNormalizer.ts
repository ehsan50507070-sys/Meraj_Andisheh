export interface SearchTextParts {
  title: string;
  summary: string;
  bodyHtml?: string | null;
  topicNames?: readonly string[];
  tagNames?: readonly string[];
  personNames?: readonly string[];
  sourceTitles?: readonly string[];
}

export interface ISearchNormalizer {
  normalize(text: string): string;
  buildSearchText(parts: SearchTextParts): string;
}
