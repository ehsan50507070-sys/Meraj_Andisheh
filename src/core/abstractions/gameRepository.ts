import type {
  GameAgeGroup,
  GameItem,
  GamePackageEntry,
  GamePackageValidationResult,
  GameScore,
  StoredGamePackage,
} from '../domain/games';

export interface IGameRepository {
  getAllGamesAsync(): Promise<GameItem[]>;
  getGameByIdAsync(id: number): Promise<GameItem | null>;
  getGameBySlugAsync(slug: string): Promise<GameItem | null>;
  createGameAsync(record: Omit<GameItem, 'id'>): Promise<GameItem>;
  updateGameAsync(record: GameItem): Promise<GameItem>;
  deleteGameAsync(id: number): Promise<void>;

  getAllGameAgeGroupsAsync(): Promise<GameAgeGroup[]>;
  getAgeGroupIdsByGameIdAsync(gameId: number): Promise<number[]>;
  replaceGameAgeGroupsAsync(gameId: number, ageGroupIds: number[]): Promise<void>;

  getAllScoresAsync(): Promise<GameScore[]>;
  getScoresByGameIdAsync(gameId: number): Promise<GameScore[]>;
  addGameScoreAsync(record: Omit<GameScore, 'id'>): Promise<GameScore>;
  deleteScoresByGameIdAsync(gameId: number): Promise<void>;
}

export interface ValidateGameZipInput {
  fileName: string;
  bytes: Uint8Array;
  maxTotalBytes: number;
}

export interface SaveGamePackageInput {
  packageFolder: string;
  originalZipName: string;
  entries: GamePackageEntry[];
  totalSizeBytes: number;
  createdAt: string;
}

export interface SampleEducationalGameZipAsset {
  fileName: string;
  bytes: Uint8Array;
  defaultTitleKey: string;
  maxScore: number;
}

export interface IGamePackageStorage {
  validateAndExtractZipAsync(
    input: ValidateGameZipInput,
  ): Promise<GamePackageValidationResult>;
  savePackageAsync(input: SaveGamePackageInput): Promise<StoredGamePackage>;
  getPackageAsync(packageFolder: string): Promise<StoredGamePackage | null>;
  getAllPackagesAsync(): Promise<StoredGamePackage[]>;
  deletePackageAsync(packageFolder: string): Promise<void>;
  buildSandboxedGameSrcdocAsync(packageFolder: string): Promise<string | null>;
  createSampleEducationalGameZipBytesAsync(): Promise<SampleEducationalGameZipAsset>;
}
