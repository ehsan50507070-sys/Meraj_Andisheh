import type { FilmInfo } from '../domain/portals';

export interface IFilmRepository {
  getFilmInfoByContentIdAsync(contentId: number): Promise<FilmInfo | null>;
  getAllFilmInfosAsync(): Promise<FilmInfo[]>;
  upsertFilmInfoAsync(info: FilmInfo): Promise<FilmInfo>;
  setWeeklyPickExclusiveAsync(
    targetContentId: number,
    fallbackInfo?: FilmInfo,
  ): Promise<FilmInfo>;
  deleteFilmInfoByContentIdAsync(contentId: number): Promise<void>;
}
