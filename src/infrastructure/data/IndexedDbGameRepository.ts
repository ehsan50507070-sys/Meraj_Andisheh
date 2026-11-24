import type { DataStoreKey, IDataStore } from '../../core/abstractions/IDataStore';
import type { IGameRepository } from '../../core/abstractions/gameRepository';
import type { GameAgeGroup, GameItem, GameScore } from '../../core/domain/games';
import { STORE_NAMES } from './migrations';

export interface GameDataStorePort extends IDataStore {
  getByKey<T>(storeName: string, key: DataStoreKey): Promise<T | null>;
  addRecordWithAutoId<T extends object>(storeName: string, record: T): Promise<number>;
  getByIndex?<T>(
    storeName: string,
    indexName: string,
    key: DataStoreKey,
  ): Promise<T | null>;
  getAllByIndex?<T>(
    storeName: string,
    indexName: string,
    key: DataStoreKey,
  ): Promise<T[]>;
}

export class IndexedDbGameRepository implements IGameRepository {
  private readonly dataStore: GameDataStorePort;

  constructor(dataStore: GameDataStorePort) {
    this.dataStore = dataStore;
  }

  public async getAllGamesAsync(): Promise<GameItem[]> {
    return this.dataStore.getAll<GameItem>(STORE_NAMES.GAMES);
  }

  public async getGameByIdAsync(id: number): Promise<GameItem | null> {
    return this.dataStore.getByKey<GameItem>(STORE_NAMES.GAMES, id);
  }

  public async getGameBySlugAsync(slug: string): Promise<GameItem | null> {
    if (this.dataStore.getByIndex) {
      const byIndex = await this.dataStore.getByIndex<GameItem>(
        STORE_NAMES.GAMES,
        'by_slug',
        slug,
      );
      if (byIndex) {
        return byIndex;
      }
    }
    const all = await this.getAllGamesAsync();
    const targetLower = slug.trim().toLowerCase();
    return all.find((g) => g.slug.trim().toLowerCase() === targetLower) ?? null;
  }

  public async createGameAsync(record: Omit<GameItem, 'id'>): Promise<GameItem> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.GAMES, record);
    const created: GameItem = { ...record, id };
    return created;
  }

  public async updateGameAsync(record: GameItem): Promise<GameItem> {
    await this.dataStore.putRecord<GameItem>(STORE_NAMES.GAMES, record);
    return record;
  }

  public async deleteGameAsync(id: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.GAMES, id);
  }

  public async getAllGameAgeGroupsAsync(): Promise<GameAgeGroup[]> {
    return this.dataStore.getAll<GameAgeGroup>(STORE_NAMES.GAME_AGE_GROUPS);
  }

  public async getAgeGroupIdsByGameIdAsync(gameId: number): Promise<number[]> {
    const links = this.dataStore.getAllByIndex
      ? await this.dataStore.getAllByIndex<GameAgeGroup>(
          STORE_NAMES.GAME_AGE_GROUPS,
          'by_gameId',
          gameId,
        )
      : (await this.getAllGameAgeGroupsAsync()).filter((l) => l.gameId === gameId);

    return links.map((l) => l.ageGroupId);
  }

  public async replaceGameAgeGroupsAsync(
    gameId: number,
    ageGroupIds: number[],
  ): Promise<void> {
    const existing = await this.getAllGameAgeGroupsAsync();
    for (const row of existing) {
      if (row.gameId === gameId) {
        await this.dataStore.deleteByKey(STORE_NAMES.GAME_AGE_GROUPS, [
          row.gameId,
          row.ageGroupId,
        ]);
      }
    }
    const uniqueIds = Array.from(new Set(ageGroupIds));
    for (const ageGroupId of uniqueIds) {
      await this.dataStore.putRecord<GameAgeGroup>(STORE_NAMES.GAME_AGE_GROUPS, {
        gameId,
        ageGroupId,
      });
    }
  }

  public async getAllScoresAsync(): Promise<GameScore[]> {
    return this.dataStore.getAll<GameScore>(STORE_NAMES.GAME_SCORES);
  }

  public async getScoresByGameIdAsync(gameId: number): Promise<GameScore[]> {
    if (this.dataStore.getAllByIndex) {
      return this.dataStore.getAllByIndex<GameScore>(
        STORE_NAMES.GAME_SCORES,
        'by_gameId',
        gameId,
      );
    }
    const all = await this.getAllScoresAsync();
    return all.filter((row) => row.gameId === gameId);
  }

  public async addGameScoreAsync(
    record: Omit<GameScore, 'id'>,
  ): Promise<GameScore> {
    const id = await this.dataStore.addRecordWithAutoId(
      STORE_NAMES.GAME_SCORES,
      record,
    );
    return { ...record, id };
  }

  public async deleteScoresByGameIdAsync(gameId: number): Promise<void> {
    const scores = await this.getScoresByGameIdAsync(gameId);
    for (const score of scores) {
      await this.dataStore.deleteByKey(STORE_NAMES.GAME_SCORES, score.id);
    }
  }
}
