import type { IClock } from '../abstractions/IClock';
import type { ILogger } from '../abstractions/ILogger';
import type { IAdminRepository } from '../abstractions/adminRepository';
import type {
  IGamePackageStorage,
  IGameRepository,
  SampleEducationalGameZipAsset,
} from '../abstractions/gameRepository';
import type { ISearchNormalizer } from '../abstractions/searchNormalizer';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import type { AppUser } from '../domain/auth';
import {
  GAME_DESCRIPTION_MAX_LENGTH,
  GAME_END_MESSAGE_MAX_LENGTH,
  GAME_LEADERBOARD_TOP_LIMIT,
  GAME_MAX_SCORE_LIMIT,
  GAME_MAX_SCORE_MIN,
  GAME_TITLE_MAX_LENGTH,
  type AdminGameListItem,
  type GameAgeGroup,
  type GameItem,
  type GameLeaderboardEntry,
  type GamePortalDataResult,
  type GamePortalItemSummary,
  type GameScore,
  type GameValidationErrorCode,
  type PublicGameDetailResult,
} from '../domain/games';
import type { PermissionKey } from '../domain/permissions';
import type { AgeGroup, Topic } from '../domain/taxonomy';
import {
  isContentAllowedForAgeGroup,
  type AgePriorityGroup,
} from './ageRuleService';
import { DEFAULT_MAX_OTHER_MB } from './fileValidationService';
import { normalizeDigits } from './identifierService';
import { PermissionPolicyService } from './permissionPolicyService';
import { defaultSearchNormalizer, matchesNormalizedQuery } from './searchNormalizer';
import { ensureUniqueSlug, generateSlug } from './slugService';

export const GAMES_ADMIN_ROUTE_PATH = '#/admin/portals';
export const GAMES_PERMISSION_KEY: PermissionKey = 'portals.manage';
export const DEFAULT_GAME_MAX_SCORE = 100;

export interface GamePortalServiceResult<T = void> {
  ok: boolean;
  statusCode: 200 | 400 | 401 | 403 | 404;
  data?: T;
  errorCode?: GameValidationErrorCode;
  messageKey?: string;
  invalidFileName?: string;
}

export interface CreateGameFromZipInput {
  title: string;
  slug?: string;
  description?: string | null;
  endMessage?: string | null;
  topicId?: number | null;
  maxScore: number | string;
  ageGroupIds?: number[];
  isPublished?: boolean;
  thumbnailKey?: string | null;
  zipFileName: string;
  zipBytes: Uint8Array;
}

export interface UpdateGameInput {
  id: number;
  title: string;
  slug?: string;
  description?: string | null;
  endMessage?: string | null;
  topicId?: number | null;
  maxScore: number | string;
  ageGroupIds?: number[];
  isPublished?: boolean;
  thumbnailKey?: string | null;
  zipFileName?: string | null;
  zipBytes?: Uint8Array | null;
}

export interface PublicGamePortalQuery {
  topicId?: 'all' | number;
  ageGroupId?: 'all' | number;
  query?: string;
}

export interface SubmitGameScoreInput {
  gameId: number;
  score: number;
  activeAgeGroup: AgeGroup | null;
}

export interface SubmitGameScoreResponse {
  recordedScore: GameScore;
  leaderboard: GameLeaderboardEntry[];
  currentUserBestScore: number;
  currentUserRank: number | null;
  endMessage: string | null;
}

export interface InstallSampleGameOptions {
  title: string;
  description: string;
  endMessage: string;
  topicId?: number | null;
}

export interface GamePortalServiceDependencies {
  gameRepository: IGameRepository;
  packageStorage: IGamePackageStorage;
  taxonomyRepository: ITaxonomyRepository;
  adminRepository: IAdminRepository;
  policyService: PermissionPolicyService;
  clock: IClock;
  logger: ILogger;
  deletedDisplayName: string;
  searchNormalizer?: ISearchNormalizer;
}

function parseTimestampMs(iso: string | null | undefined): number {
  if (!iso) {
    return 0;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function parsePositiveIntFromInput(
  raw: number | string | null | undefined,
  min: number,
  max: number,
): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw < min || raw > max) {
      return null;
    }
    return raw;
  }
  const normalized = normalizeDigits(String(raw)).trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}

function parseMaxOtherMb(raw: string | null | undefined): number {
  const parsed = parsePositiveIntFromInput(raw, 1, 500);
  return parsed ?? DEFAULT_MAX_OTHER_MB;
}

function computePriorityGroup(
  itemAgeGroupIds: readonly number[],
  activeAgeGroup: AgeGroup | null,
): AgePriorityGroup {
  if (!activeAgeGroup) {
    return itemAgeGroupIds.length === 0 ? 2 : 3;
  }
  if (itemAgeGroupIds.includes(activeAgeGroup.id)) {
    return 1;
  }
  if (itemAgeGroupIds.length === 0) {
    return 2;
  }
  return 3;
}

function buildGameAgeGroupMap(
  links: readonly GameAgeGroup[],
): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const link of links) {
    const existing = map.get(link.gameId);
    if (existing) {
      existing.push(link.ageGroupId);
    } else {
      map.set(link.gameId, [link.ageGroupId]);
    }
  }
  return map;
}

function buildRankedLeaderboard(
  scores: readonly GameScore[],
  usersById: ReadonlyMap<number, AppUser>,
  currentUserId: number | null,
  deletedDisplayName: string,
): {
  topEntries: GameLeaderboardEntry[];
  currentUserBestScore: number | null;
  currentUserRank: number | null;
} {
  const bestByUser = new Map<number, GameScore>();

  for (const row of scores) {
    const prev = bestByUser.get(row.userId);
    if (!prev) {
      bestByUser.set(row.userId, row);
      continue;
    }
    if (row.score > prev.score) {
      bestByUser.set(row.userId, row);
    } else if (row.score === prev.score) {
      const rowTime = parseTimestampMs(row.createdAt);
      const prevTime = parseTimestampMs(prev.createdAt);
      if (rowTime < prevTime || (rowTime === prevTime && row.id < prev.id)) {
        bestByUser.set(row.userId, row);
      }
    }
  }

  const sorted = Array.from(bestByUser.values()).sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const timeDiff = parseTimestampMs(a.createdAt) - parseTimestampMs(b.createdAt);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return a.id - b.id;
  });

  const allEntries: GameLeaderboardEntry[] = sorted.map((row, index) => {
    const user = usersById.get(row.userId);
    const displayName =
      !user || user.isDeleted
        ? deletedDisplayName
        : user.displayName.trim() || deletedDisplayName;

    return {
      rank: index + 1,
      userId: row.userId,
      displayName,
      score: row.score,
      achievedAt: row.createdAt,
      isCurrentUser: currentUserId !== null && row.userId === currentUserId,
    };
  });

  const currentUserEntry =
    currentUserId !== null
      ? allEntries.find((entry) => entry.userId === currentUserId) ?? null
      : null;

  return {
    topEntries: allEntries.slice(0, GAME_LEADERBOARD_TOP_LIMIT),
    currentUserBestScore: currentUserEntry ? currentUserEntry.score : null,
    currentUserRank: currentUserEntry ? currentUserEntry.rank : null,
  };
}

export class GamePortalService {
  private readonly gameRepository: IGameRepository;
  private readonly packageStorage: IGamePackageStorage;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly adminRepository: IAdminRepository;
  private readonly policyService: PermissionPolicyService;
  private readonly clock: IClock;
  private readonly logger: ILogger;
  private readonly deletedDisplayName: string;
  private readonly searchNormalizer: ISearchNormalizer;

  constructor(deps: GamePortalServiceDependencies) {
    this.gameRepository = deps.gameRepository;
    this.packageStorage = deps.packageStorage;
    this.taxonomyRepository = deps.taxonomyRepository;
    this.adminRepository = deps.adminRepository;
    this.policyService = deps.policyService;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.deletedDisplayName = deps.deletedDisplayName;
    this.searchNormalizer = deps.searchNormalizer ?? defaultSearchNormalizer;
  }

  private async isGamesModuleEnabledAsync(): Promise<boolean> {
    const flags = await this.adminRepository.getAllFeatureFlags();
    const flag = flags.find((item) => item.key === 'Games');
    return flag?.isEnabled === true;
  }

  private async getMaxZipBytesAsync(): Promise<number> {
    const setting = await this.adminRepository.getSiteSettingByKey('Upload.MaxOtherMb');
    const mb = parseMaxOtherMb(setting?.value);
    return mb * 1024 * 1024;
  }

  private async authorizePortalsManage<T>(
    actor: AppUser | null,
    routePath: string = GAMES_ADMIN_ROUTE_PATH,
  ): Promise<GamePortalServiceResult<T> | null> {
    const auth = await this.policyService.authorizePermission(
      actor,
      GAMES_PERMISSION_KEY,
      routePath,
    );
    if (auth.allowed) {
      return null;
    }
    return {
      ok: false,
      statusCode: auth.statusCode,
      errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
      messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
    };
  }

  private async validateCommonMetadataAsync(input: {
    title: string;
    description?: string | null;
    endMessage?: string | null;
    topicId?: number | null;
    maxScore: number | string;
    ageGroupIds?: number[];
  }): Promise<
    | {
        ok: true;
        title: string;
        description: string;
        endMessage: string | null;
        topicId: number | null;
        maxScore: number;
        ageGroupIds: number[];
      }
    | {
        ok: false;
        errorCode: GameValidationErrorCode;
        messageKey: string;
      }
  > {
    const trimmedTitle = (input.title ?? '').trim();
    if (trimmedTitle.length === 0 || trimmedTitle.length > GAME_TITLE_MAX_LENGTH) {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.games.error.invalidTitle',
      };
    }

    const trimmedDesc = (input.description ?? '').trim();
    if (trimmedDesc.length > GAME_DESCRIPTION_MAX_LENGTH) {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.games.error.descriptionTooLong',
      };
    }

    const trimmedEndMessage = (input.endMessage ?? '').trim();
    if (trimmedEndMessage.length > GAME_END_MESSAGE_MAX_LENGTH) {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.games.error.endMessageTooLong',
      };
    }

    const parsedMaxScore = parsePositiveIntFromInput(
      input.maxScore,
      GAME_MAX_SCORE_MIN,
      GAME_MAX_SCORE_LIMIT,
    );
    if (parsedMaxScore === null) {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.games.error.invalidMaxScore',
      };
    }

    let resolvedTopicId: number | null = null;
    if (typeof input.topicId === 'number' && Number.isSafeInteger(input.topicId)) {
      const topics = await this.taxonomyRepository.getAllTopics();
      const exists = topics.some((t) => t.id === input.topicId);
      if (!exists) {
        return {
          ok: false,
          errorCode: 'VALIDATION_ERROR',
          messageKey: 'admin.portals.games.error.invalidTopic',
        };
      }
      resolvedTopicId = input.topicId;
    }

    const requestedAgeIds = Array.isArray(input.ageGroupIds)
      ? Array.from(new Set(input.ageGroupIds.filter((id) => Number.isSafeInteger(id))))
      : [];
    if (requestedAgeIds.length > 0) {
      const activeAges = await this.adminRepository.getActiveAgeGroups();
      const validSet = new Set(activeAges.map((ag) => ag.id));
      for (const ageId of requestedAgeIds) {
        if (!validSet.has(ageId)) {
          return {
            ok: false,
            errorCode: 'VALIDATION_ERROR',
            messageKey: 'admin.portals.games.error.invalidAgeGroups',
          };
        }
      }
    }

    return {
      ok: true,
      title: trimmedTitle,
      description: trimmedDesc,
      endMessage: trimmedEndMessage.length > 0 ? trimmedEndMessage : null,
      topicId: resolvedTopicId,
      maxScore: parsedMaxScore,
      ageGroupIds: requestedAgeIds,
    };
  }

  public async listAdminGamesAsync(
    actor: AppUser | null,
    search?: string,
  ): Promise<GamePortalServiceResult<AdminGameListItem[]>> {
    const denied = await this.authorizePortalsManage<AdminGameListItem[]>(actor);
    if (denied) return denied;

    const [games, topics, ageLinks, packages, scores] = await Promise.all([
      this.gameRepository.getAllGamesAsync(),
      this.taxonomyRepository.getAllTopics(),
      this.gameRepository.getAllGameAgeGroupsAsync(),
      this.packageStorage.getAllPackagesAsync(),
      this.gameRepository.getAllScoresAsync(),
    ]);

    const topicNameById = new Map(topics.map((t) => [t.id, t.name]));
    const ageMap = buildGameAgeGroupMap(ageLinks);
    const pkgMap = new Map(packages.map((p) => [p.packageFolder, p]));
    const scoresCountMap = new Map<number, number>();
    for (const s of scores) {
      scoresCountMap.set(s.gameId, (scoresCountMap.get(s.gameId) ?? 0) + 1);
    }

    const trimmedQuery = (search ?? '').trim();
    const rows: AdminGameListItem[] = [];

    for (const game of games) {
      const topicName =
        game.topicId !== null ? (topicNameById.get(game.topicId) ?? null) : null;
      if (trimmedQuery.length > 0) {
        const matched = matchesNormalizedQuery(
          this.searchNormalizer,
          [game.title, game.slug, game.description, topicName],
          trimmedQuery,
        );
        if (!matched) {
          continue;
        }
      }

      const pkg = pkgMap.get(game.packageFolder);
      rows.push({
        game,
        topicName,
        ageGroupIds: ageMap.get(game.id) ?? [],
        packageFilesCount: pkg?.filesCount ?? 0,
        packageTotalBytes: pkg?.totalSizeBytes ?? 0,
        scoresCount: scoresCountMap.get(game.id) ?? 0,
      });
    }

    rows.sort((a, b) => {
      const updatedDiff = b.game.updatedAt.localeCompare(a.game.updatedAt);
      return updatedDiff !== 0 ? updatedDiff : b.game.id - a.game.id;
    });

    return {
      ok: true,
      statusCode: 200,
      data: rows,
    };
  }

  public async createGameFromZipAsync(
    actor: AppUser | null,
    input: CreateGameFromZipInput,
  ): Promise<GamePortalServiceResult<GameItem>> {
    const denied = await this.authorizePortalsManage<GameItem>(actor);
    if (denied || !actor) return denied!;

    const metaCheck = await this.validateCommonMetadataAsync(input);
    if (!metaCheck.ok) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: metaCheck.errorCode,
        messageKey: metaCheck.messageKey,
      };
    }

    if (!input.zipBytes || input.zipBytes.byteLength === 0) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ZIP_REQUIRED',
        messageKey: 'admin.portals.games.error.zipRequired',
      };
    }

    const maxBytes = await this.getMaxZipBytesAsync();
    const zipValidation = await this.packageStorage.validateAndExtractZipAsync({
      fileName: input.zipFileName || 'game.zip',
      bytes: input.zipBytes,
      maxTotalBytes: maxBytes,
    });

    if (!zipValidation.ok) {
      this.logger.warn('GAME_ZIP_VALIDATION_FAILED', {
        actorId: actor.id,
        fileName: input.zipFileName,
        errorCode: zipValidation.errorCode,
        invalidFileName: zipValidation.invalidFileName,
      });
      return {
        ok: false,
        statusCode: 400,
        errorCode: zipValidation.errorCode ?? 'ZIP_INVALID_FORMAT',
        messageKey:
          zipValidation.messageKey ?? 'admin.portals.games.error.zipInvalidFormat',
        invalidFileName: zipValidation.invalidFileName,
      };
    }

    const existingGames = await this.gameRepository.getAllGamesAsync();
    const existingSlugs = existingGames.map((g) => g.slug);
    const uniqueSlug = ensureUniqueSlug(input.slug || metaCheck.title, existingSlugs);
    const nowIso = this.clock.nowUtcIso();
    const cleanSlugToken = generateSlug(uniqueSlug).slice(0, 24) || 'game';
    const randSuffix = Math.floor(100000 + Math.random() * 900000);
    const packageFolder = `game-${Date.now()}-${randSuffix}-${cleanSlugToken}`;

    await this.packageStorage.savePackageAsync({
      packageFolder,
      originalZipName: input.zipFileName || 'game.zip',
      entries: zipValidation.entries,
      totalSizeBytes: zipValidation.totalSizeBytes,
      createdAt: nowIso,
    });

    const created = await this.gameRepository.createGameAsync({
      title: metaCheck.title,
      slug: uniqueSlug,
      description: metaCheck.description,
      endMessage: metaCheck.endMessage,
      thumbnailKey: input.thumbnailKey?.trim() || null,
      packageFolder,
      topicId: metaCheck.topicId,
      maxScore: metaCheck.maxScore,
      isPublished: Boolean(input.isPublished),
      createdById: actor.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await this.gameRepository.replaceGameAgeGroupsAsync(
      created.id,
      metaCheck.ageGroupIds,
    );

    this.logger.info('PORTAL_GAME_CREATED', {
      actorId: actor.id,
      gameId: created.id,
      slug: created.slug,
      maxScore: created.maxScore,
      filesCount: zipValidation.entries.length,
    });

    return {
      ok: true,
      statusCode: 200,
      data: created,
    };
  }

  public async updateGameAsync(
    actor: AppUser | null,
    input: UpdateGameInput,
  ): Promise<GamePortalServiceResult<GameItem>> {
    const denied = await this.authorizePortalsManage<GameItem>(actor);
    if (denied || !actor) return denied!;

    const existing = await this.gameRepository.getGameByIdAsync(input.id);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.portals.games.error.notFound',
      };
    }

    const metaCheck = await this.validateCommonMetadataAsync(input);
    if (!metaCheck.ok) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: metaCheck.errorCode,
        messageKey: metaCheck.messageKey,
      };
    }

    let nextPackageFolder = existing.packageFolder;
    let oldPackageToDelete: string | null = null;
    const nowIso = this.clock.nowUtcIso();

    if (input.zipBytes && input.zipBytes.byteLength > 0) {
      const maxBytes = await this.getMaxZipBytesAsync();
      const zipValidation = await this.packageStorage.validateAndExtractZipAsync({
        fileName: input.zipFileName || 'game.zip',
        bytes: input.zipBytes,
        maxTotalBytes: maxBytes,
      });

      if (!zipValidation.ok) {
        this.logger.warn('GAME_ZIP_VALIDATION_FAILED', {
          actorId: actor.id,
          gameId: existing.id,
          fileName: input.zipFileName,
          errorCode: zipValidation.errorCode,
          invalidFileName: zipValidation.invalidFileName,
        });
        return {
          ok: false,
          statusCode: 400,
          errorCode: zipValidation.errorCode ?? 'ZIP_INVALID_FORMAT',
          messageKey:
            zipValidation.messageKey ?? 'admin.portals.games.error.zipInvalidFormat',
          invalidFileName: zipValidation.invalidFileName,
        };
      }

      const randSuffix = Math.floor(100000 + Math.random() * 900000);
      nextPackageFolder = `game-${Date.now()}-${randSuffix}-${existing.id}`;
      await this.packageStorage.savePackageAsync({
        packageFolder: nextPackageFolder,
        originalZipName: input.zipFileName || 'game.zip',
        entries: zipValidation.entries,
        totalSizeBytes: zipValidation.totalSizeBytes,
        createdAt: nowIso,
      });
      oldPackageToDelete = existing.packageFolder;
    }

    const allGames = await this.gameRepository.getAllGamesAsync();
    const otherSlugs = allGames
      .filter((g) => g.id !== existing.id)
      .map((g) => g.slug);
    const desiredSlugBase =
      input.slug && input.slug.trim().length > 0 ? input.slug : existing.slug;
    const nextSlug = ensureUniqueSlug(desiredSlugBase, otherSlugs);

    const updated = await this.gameRepository.updateGameAsync({
      ...existing,
      title: metaCheck.title,
      slug: nextSlug,
      description: metaCheck.description,
      endMessage: metaCheck.endMessage,
      thumbnailKey:
        input.thumbnailKey !== undefined
          ? input.thumbnailKey?.trim() || null
          : existing.thumbnailKey,
      packageFolder: nextPackageFolder,
      topicId: metaCheck.topicId,
      maxScore: metaCheck.maxScore,
      isPublished:
        input.isPublished !== undefined
          ? Boolean(input.isPublished)
          : existing.isPublished,
      updatedAt: nowIso,
    });

    await this.gameRepository.replaceGameAgeGroupsAsync(
      updated.id,
      metaCheck.ageGroupIds,
    );

    if (oldPackageToDelete) {
      await this.packageStorage.deletePackageAsync(oldPackageToDelete);
    }

    this.logger.info('PORTAL_GAME_UPDATED', {
      actorId: actor.id,
      gameId: updated.id,
      slug: updated.slug,
      isPublished: updated.isPublished,
    });

    return {
      ok: true,
      statusCode: 200,
      data: updated,
    };
  }

  public async toggleGamePublishedAsync(
    actor: AppUser | null,
    gameId: number,
    isPublished: boolean,
  ): Promise<GamePortalServiceResult<GameItem>> {
    const denied = await this.authorizePortalsManage<GameItem>(actor);
    if (denied || !actor) return denied!;

    const existing = await this.gameRepository.getGameByIdAsync(gameId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.portals.games.error.notFound',
      };
    }

    const updated = await this.gameRepository.updateGameAsync({
      ...existing,
      isPublished,
      updatedAt: this.clock.nowUtcIso(),
    });

    this.logger.info('PORTAL_GAME_PUBLISH_TOGGLED', {
      actorId: actor.id,
      gameId: updated.id,
      isPublished: updated.isPublished,
    });

    return {
      ok: true,
      statusCode: 200,
      data: updated,
    };
  }

  public async deleteGameAsync(
    actor: AppUser | null,
    gameId: number,
  ): Promise<GamePortalServiceResult<void>> {
    const denied = await this.authorizePortalsManage<void>(actor);
    if (denied || !actor) return denied!;

    const existing = await this.gameRepository.getGameByIdAsync(gameId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.portals.games.error.notFound',
      };
    }

    await Promise.all([
      this.gameRepository.deleteScoresByGameIdAsync(gameId),
      this.gameRepository.replaceGameAgeGroupsAsync(gameId, []),
      this.packageStorage.deletePackageAsync(existing.packageFolder),
      this.gameRepository.deleteGameAsync(gameId),
    ]);

    this.logger.info('PORTAL_GAME_DELETED', {
      actorId: actor.id,
      gameId,
      title: existing.title,
    });

    return {
      ok: true,
      statusCode: 200,
    };
  }

  public async generateSampleZipAssetAsync(): Promise<SampleEducationalGameZipAsset> {
    return this.packageStorage.createSampleEducationalGameZipBytesAsync();
  }

  public async installSampleEducationalGameAsync(
    actor: AppUser | null,
    options: InstallSampleGameOptions,
  ): Promise<GamePortalServiceResult<GameItem>> {
    const denied = await this.authorizePortalsManage<GameItem>(actor);
    if (denied) return denied;

    const sampleAsset =
      await this.packageStorage.createSampleEducationalGameZipBytesAsync();
    const topics = await this.taxonomyRepository.getAllTopics();
    const defaultTopicId =
      options.topicId ??
      topics.find((topic) => topic.parentId === null)?.id ??
      topics[0]?.id ??
      null;

    return this.createGameFromZipAsync(actor, {
      title: options.title,
      description: options.description,
      endMessage: options.endMessage,
      topicId: defaultTopicId,
      maxScore: sampleAsset.maxScore,
      ageGroupIds: [],
      isPublished: true,
      zipFileName: sampleAsset.fileName,
      zipBytes: sampleAsset.bytes,
    });
  }

  public async getGamesPortalDataAsync(
    activeAgeGroup: AgeGroup | null,
    filter?: PublicGamePortalQuery,
  ): Promise<GamePortalDataResult> {
    const enabled = await this.isGamesModuleEnabledAsync();
    if (!enabled) {
      return { enabled: false };
    }

    const [games, ageLinks, topics, allScores] = await Promise.all([
      this.gameRepository.getAllGamesAsync(),
      this.gameRepository.getAllGameAgeGroupsAsync(),
      this.taxonomyRepository.getAllTopics(),
      this.gameRepository.getAllScoresAsync(),
    ]);

    const ageMap = buildGameAgeGroupMap(ageLinks);
    const topicById = new Map(topics.map((t) => [t.id, t]));
    const scoresByGame = new Map<number, GameScore[]>();
    for (const score of allScores) {
      const list = scoresByGame.get(score.gameId) ?? [];
      list.push(score);
      scoresByGame.set(score.gameId, list);
    }

    const allowedSummaries: GamePortalItemSummary[] = [];
    const availableTopicsMap = new Map<number, Topic>();

    for (const game of games) {
      if (!game.isPublished) {
        continue;
      }
      const ageGroupIds = ageMap.get(game.id) ?? [];
      if (!isContentAllowedForAgeGroup(ageGroupIds, activeAgeGroup)) {
        continue;
      }

      const topic =
        game.topicId !== null ? (topicById.get(game.topicId) ?? null) : null;
      if (topic) {
        availableTopicsMap.set(topic.id, topic);
      }

      const gameScores = scoresByGame.get(game.id) ?? [];
      const uniquePlayers = new Set<number>();
      let topScore: number | null = null;
      for (const s of gameScores) {
        uniquePlayers.add(s.userId);
        if (topScore === null || s.score > topScore) {
          topScore = s.score;
        }
      }

      allowedSummaries.push({
        game,
        topicName: topic?.name ?? null,
        ageGroupIds,
        priorityGroup: computePriorityGroup(ageGroupIds, activeAgeGroup),
        playersCount: uniquePlayers.size,
        topScore,
      });
    }

    allowedSummaries.sort((a, b) => {
      if (a.priorityGroup !== b.priorityGroup) {
        return a.priorityGroup - b.priorityGroup;
      }
      const updDiff = b.game.updatedAt.localeCompare(a.game.updatedAt);
      return updDiff !== 0 ? updDiff : b.game.id - a.game.id;
    });

    const topicFilter =
      filter?.topicId !== undefined && filter.topicId !== 'all'
        ? filter.topicId
        : null;
    const ageFilter =
      filter?.ageGroupId !== undefined && filter.ageGroupId !== 'all'
        ? filter.ageGroupId
        : null;
    const rawQuery = (filter?.query ?? '').trim();

    const filteredItems = allowedSummaries.filter((summary) => {
      if (topicFilter !== null && summary.game.topicId !== topicFilter) {
        return false;
      }
      if (ageFilter !== null) {
        const matchesAge =
          summary.ageGroupIds.length === 0 ||
          summary.ageGroupIds.includes(ageFilter);
        if (!matchesAge) {
          return false;
        }
      }
      if (rawQuery.length > 0) {
        return matchesNormalizedQuery(
          this.searchNormalizer,
          [summary.game.title, summary.game.description, summary.topicName],
          rawQuery,
        );
      }
      return true;
    });

    const availableTopics = Array.from(availableTopicsMap.values()).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
    );

    return {
      enabled: true,
      data: {
        items: filteredItems,
        allAllowedGamesCount: allowedSummaries.length,
        availableTopics,
      },
    };
  }

  public async getPublicGameDetailAsync(
    rawSlug: string,
    activeAgeGroup: AgeGroup | null,
    currentUser: AppUser | null,
  ): Promise<PublicGameDetailResult> {
    const enabled = await this.isGamesModuleEnabledAsync();
    if (!enabled) {
      return { status: 'not_found' };
    }

    const trimmedRaw = (rawSlug ?? '').trim();
    if (!trimmedRaw) {
      return { status: 'not_found' };
    }

    let decodedSlug = trimmedRaw;
    try {
      decodedSlug = decodeURIComponent(trimmedRaw).trim();
    } catch {
      decodedSlug = trimmedRaw;
    }

    let game = await this.gameRepository.getGameBySlugAsync(decodedSlug);
    if (!game && decodedSlug !== trimmedRaw) {
      game = await this.gameRepository.getGameBySlugAsync(trimmedRaw);
    }

    if (!game || !game.isPublished) {
      return { status: 'not_found' };
    }

    const ageGroupIds = await this.gameRepository.getAgeGroupIdsByGameIdAsync(game.id);
    if (!isContentAllowedForAgeGroup(ageGroupIds, activeAgeGroup)) {
      return { status: 'not_found' };
    }

    const [
      srcdoc,
      allTopics,
      allAgeGroups,
      gameScores,
      allUsers,
      allGames,
      allGameAgeGroups,
      allScores,
    ] = await Promise.all([
      this.packageStorage.buildSandboxedGameSrcdocAsync(game.packageFolder),
      this.taxonomyRepository.getAllTopics(),
      this.adminRepository.getActiveAgeGroups(),
      this.gameRepository.getScoresByGameIdAsync(game.id),
      this.adminRepository.getAllUsers(),
      this.gameRepository.getAllGamesAsync(),
      this.gameRepository.getAllGameAgeGroupsAsync(),
      this.gameRepository.getAllScoresAsync(),
    ]);

    if (!srcdoc) {
      return { status: 'not_found' };
    }

    const topicById = new Map(allTopics.map((t) => [t.id, t]));
    const ageById = new Map(allAgeGroups.map((ag) => [ag.id, ag]));
    const usersById = new Map(allUsers.map((u) => [u.id, u]));

    const leaderboardResult = buildRankedLeaderboard(
      gameScores,
      usersById,
      currentUser?.id ?? null,
      this.deletedDisplayName,
    );

    const ageMap = buildGameAgeGroupMap(allGameAgeGroups);
    const scoresCountByGame = new Map<number, { players: Set<number>; top: number | null }>();
    for (const s of allScores) {
      const bucket = scoresCountByGame.get(s.gameId) ?? {
        players: new Set<number>(),
        top: null,
      };
      bucket.players.add(s.userId);
      if (bucket.top === null || s.score > bucket.top) {
        bucket.top = s.score;
      }
      scoresCountByGame.set(s.gameId, bucket);
    }

    const relatedGames: GamePortalItemSummary[] = [];
    for (const candidate of allGames) {
      if (candidate.id === game.id || !candidate.isPublished) {
        continue;
      }
      const candAges = ageMap.get(candidate.id) ?? [];
      if (!isContentAllowedForAgeGroup(candAges, activeAgeGroup)) {
        continue;
      }
      const stats = scoresCountByGame.get(candidate.id);
      relatedGames.push({
        game: candidate,
        topicName:
          candidate.topicId !== null
            ? (topicById.get(candidate.topicId)?.name ?? null)
            : null,
        ageGroupIds: candAges,
        priorityGroup: computePriorityGroup(candAges, activeAgeGroup),
        playersCount: stats?.players.size ?? 0,
        topScore: stats?.top ?? null,
      });
    }

    relatedGames.sort((a, b) => {
      const aSameTopic = game.topicId !== null && a.game.topicId === game.topicId ? 0 : 1;
      const bSameTopic = game.topicId !== null && b.game.topicId === game.topicId ? 0 : 1;
      if (aSameTopic !== bSameTopic) {
        return aSameTopic - bSameTopic;
      }
      if (a.priorityGroup !== b.priorityGroup) {
        return a.priorityGroup - b.priorityGroup;
      }
      return b.game.id - a.game.id;
    });

    return {
      status: 'ok',
      data: {
        game,
        topic: game.topicId !== null ? (topicById.get(game.topicId) ?? null) : null,
        targetAgeGroups: ageGroupIds
          .map((id) => ageById.get(id))
          .filter((ag): ag is AgeGroup => Boolean(ag)),
        srcdoc,
        leaderboard: leaderboardResult.topEntries,
        currentUserBestScore: leaderboardResult.currentUserBestScore,
        currentUserRank: leaderboardResult.currentUserRank,
        relatedGames: relatedGames.slice(0, 4),
      },
    };
  }

  public async submitGameScoreAsync(
    actor: AppUser | null,
    input: SubmitGameScoreInput,
  ): Promise<GamePortalServiceResult<SubmitGameScoreResponse>> {
    const enabled = await this.isGamesModuleEnabledAsync();
    if (!enabled) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'FEATURE_DISABLED',
        messageKey: 'games.error.featureDisabled',
      };
    }

    if (!actor || !actor.isActive || actor.isDeleted) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: 'AUTH_REQUIRED',
        messageKey: 'games.score.error.authRequired',
      };
    }

    const game = await this.gameRepository.getGameByIdAsync(input.gameId);
    if (!game || !game.isPublished) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'notFound.title',
      };
    }

    const ageGroupIds = await this.gameRepository.getAgeGroupIdsByGameIdAsync(game.id);
    if (!isContentAllowedForAgeGroup(ageGroupIds, input.activeAgeGroup)) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'notFound.title',
      };
    }

    const scoreValue = input.score;
    const isValidScore =
      typeof scoreValue === 'number' &&
      Number.isFinite(scoreValue) &&
      Number.isInteger(scoreValue) &&
      scoreValue >= 0 &&
      scoreValue <= game.maxScore;

    if (!isValidScore) {
      this.logger.warn('INVALID_GAME_SCORE_REJECTED', {
        actorId: actor.id,
        gameId: game.id,
        rawScore: scoreValue,
        maxScore: game.maxScore,
      });
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_GAME_SCORE',
        messageKey: 'games.score.error.invalidScore',
      };
    }

    const recordedScore = await this.gameRepository.addGameScoreAsync({
      gameId: game.id,
      userId: actor.id,
      score: scoreValue,
      createdAt: this.clock.nowUtcIso(),
    });

    const [gameScores, allUsers] = await Promise.all([
      this.gameRepository.getScoresByGameIdAsync(game.id),
      this.adminRepository.getAllUsers(),
    ]);
    const usersById = new Map(allUsers.map((u) => [u.id, u]));
    const leaderboardResult = buildRankedLeaderboard(
      gameScores,
      usersById,
      actor.id,
      this.deletedDisplayName,
    );

    this.logger.info('GAME_SCORE_RECORDED', {
      actorId: actor.id,
      gameId: game.id,
      score: recordedScore.score,
      maxScore: game.maxScore,
    });

    return {
      ok: true,
      statusCode: 200,
      data: {
        recordedScore,
        leaderboard: leaderboardResult.topEntries,
        currentUserBestScore: leaderboardResult.currentUserBestScore ?? recordedScore.score,
        currentUserRank: leaderboardResult.currentUserRank,
        endMessage: game.endMessage,
      },
    };
  }

  public async getGameLeaderboardAsync(
    gameId: number,
    currentUser: AppUser | null,
  ): Promise<GameLeaderboardEntry[]> {
    const [gameScores, allUsers] = await Promise.all([
      this.gameRepository.getScoresByGameIdAsync(gameId),
      this.adminRepository.getAllUsers(),
    ]);
    const usersById = new Map(allUsers.map((u) => [u.id, u]));
    return buildRankedLeaderboard(
      gameScores,
      usersById,
      currentUser?.id ?? null,
      this.deletedDisplayName,
    ).topEntries;
  }
}
