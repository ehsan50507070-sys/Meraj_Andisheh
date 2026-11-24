import type { BookInfo } from '../domain/portals';

export interface IBookRepository {
  getBookInfoByContentIdAsync(contentId: number): Promise<BookInfo | null>;
  getAllBookInfosAsync(): Promise<BookInfo[]>;
  upsertBookInfoAsync(info: BookInfo): Promise<BookInfo>;
  deleteBookInfoByContentIdAsync(contentId: number): Promise<boolean>;
}
