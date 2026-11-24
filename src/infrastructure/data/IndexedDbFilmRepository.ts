import type { IFilmRepository } from '../../core/abstractions/filmRepository';
import {
  DEFAULT_FILM_INFO_VALUES,
  type FilmInfo,
} from '../../core/domain/portals';
import { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbFilmRepository implements IFilmRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async getFilmInfoByContentIdAsync(
    contentId: number,
  ): Promise<FilmInfo | null> {
    return this.dataStore.getByKey<FilmInfo>(STORE_NAMES.FILM_INFOS, contentId);
  }

  public async getAllFilmInfosAsync(): Promise<FilmInfo[]> {
    return this.dataStore.getAll<FilmInfo>(STORE_NAMES.FILM_INFOS);
  }

  public async upsertFilmInfoAsync(info: FilmInfo): Promise<FilmInfo> {
    if (info.isWeeklyPick) {
      return this.setWeeklyPickExclusiveAsync(info.contentId, info);
    }
    await this.dataStore.putRecord<FilmInfo>(STORE_NAMES.FILM_INFOS, info);
    return info;
  }

  public async setWeeklyPickExclusiveAsync(
    targetContentId: number,
    fallbackInfo?: FilmInfo,
  ): Promise<FilmInfo> {
    const existing = await this.getFilmInfoByContentIdAsync(targetContentId);
    const targetRecord: FilmInfo = fallbackInfo
      ? {
          ...fallbackInfo,
          contentId: targetContentId,
          isWeeklyPick: true,
        }
      : existing
        ? {
            ...existing,
            contentId: targetContentId,
            isWeeklyPick: true,
          }
        : {
            contentId: targetContentId,
            ...DEFAULT_FILM_INFO_VALUES,
            isWeeklyPick: true,
          };

    await this.dataStore.updateAllAndPut<FilmInfo>(
      STORE_NAMES.FILM_INFOS,
      (row) => {
        if (row.contentId !== targetContentId && row.isWeeklyPick) {
          return {
            ...row,
            isWeeklyPick: false,
          };
        }
        return null;
      },
      targetRecord,
    );

    return targetRecord;
  }

  public async deleteFilmInfoByContentIdAsync(contentId: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.FILM_INFOS, contentId);
  }
}
