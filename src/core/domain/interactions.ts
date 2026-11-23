export interface ContentLike {
  userId: number;
  contentId: number;
  /** ISO 8601 UTC timestamp */
  createdAt: string;
}

export interface ContentBookmark {
  userId: number;
  contentId: number;
  /** ISO 8601 UTC timestamp */
  createdAt: string;
}
