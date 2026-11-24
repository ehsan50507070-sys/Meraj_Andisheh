import type { IBookRepository } from '../../core/abstractions/bookRepository';
import type { BookInfo } from '../../core/domain/portals';
import { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbBookRepository implements IBookRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async getBookInfoByContentIdAsync(contentId: number): Promise<BookInfo | null> {
    const found = await this.dataStore.getByKey<BookInfo>(
      STORE_NAMES.BOOK_INFOS,
      contentId,
    );
    return found ? { ...found } : null;
  }

  public async getAllBookInfosAsync(): Promise<BookInfo[]> {
    const all = await this.dataStore.getAll<BookInfo>(STORE_NAMES.BOOK_INFOS);
    return all.map((entry) => ({ ...entry }));
  }

  public async upsertBookInfoAsync(info: BookInfo): Promise<BookInfo> {
    const record: BookInfo = {
      contentId: info.contentId,
      author: info.author,
      publisher: info.publisher ?? null,
      publishYear: info.publishYear ?? null,
      pages: info.pages ?? null,
      keyExcerpts: info.keyExcerpts ?? null,
      studioNote: info.studioNote ?? null,
    };
    await this.dataStore.putRecord(STORE_NAMES.BOOK_INFOS, record);
    return { ...record };
  }

  public async deleteBookInfoByContentIdAsync(contentId: number): Promise<boolean> {
    const existing = await this.dataStore.getByKey<BookInfo>(
      STORE_NAMES.BOOK_INFOS,
      contentId,
    );
    if (!existing) {
      return false;
    }
    await this.dataStore.deleteByKey(STORE_NAMES.BOOK_INFOS, contentId);
    return true;
  }
}
