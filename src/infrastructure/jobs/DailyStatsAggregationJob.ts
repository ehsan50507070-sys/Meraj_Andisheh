import type { IClock } from '../../core/abstractions/IClock';
import type { ILogger } from '../../core/abstractions/ILogger';
import type { DailyAggregationResult } from '../../core/domain/analytics';
import type { DailyStatAggregationService } from '../../core/services/dailyStatAggregationService';

export const NIGHTLY_AGGREGATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface DailyStatsAggregationJobState {
  isRunning: boolean;
  isAggregationInProgress: boolean;
  intervalMs: number;
  lastRunAtIso: string | null;
  lastRunRecordsCount: number;
}

export interface DailyStatsAggregationJobDependencies {
  aggregationService: DailyStatAggregationService;
  clock: IClock;
  logger?: ILogger;
  intervalMs?: number;
}

export class DailyStatsAggregationJob {
  private readonly aggregationService: DailyStatAggregationService;
  private readonly clock: IClock;
  private readonly logger?: ILogger;
  private readonly intervalMs: number;
  private readonly listeners = new Set<() => void>();

  private isRunning = false;
  private isAggregationInProgress = false;
  private lastRunAtIso: string | null = null;
  private lastRunRecordsCount = 0;
  private timerHandle: ReturnType<typeof setInterval> | null = null;

  constructor(deps: DailyStatsAggregationJobDependencies) {
    this.aggregationService = deps.aggregationService;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.intervalMs = Math.max(
      1000,
      Math.floor(deps.intervalMs ?? NIGHTLY_AGGREGATION_INTERVAL_MS),
    );
  }

  public start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    const pollCadenceMs = Math.max(
      1000,
      Math.min(Math.floor(this.intervalMs / 12), 60_000),
    );
    this.timerHandle = setInterval(() => {
      void this.tickAsync();
    }, pollCadenceMs);

    void this.tickAsync();
    this.notifyListeners();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timerHandle !== null) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    this.notifyListeners();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): DailyStatsAggregationJobState {
    return {
      isRunning: this.isRunning,
      isAggregationInProgress: this.isAggregationInProgress,
      intervalMs: this.intervalMs,
      lastRunAtIso: this.lastRunAtIso,
      lastRunRecordsCount: this.lastRunRecordsCount,
    };
  }

  public async tickAsync(): Promise<{
    executed: boolean;
    result?: DailyAggregationResult;
  }> {
    if (this.isAggregationInProgress) {
      return { executed: false };
    }

    const lastPersistedIso =
      this.lastRunAtIso ?? (await this.aggregationService.getLastAggregatedAtAsync());
    const lastMs = lastPersistedIso ? Date.parse(lastPersistedIso) : NaN;
    const nowMs = this.clock.now().getTime();

    if (Number.isFinite(lastMs) && nowMs - lastMs < this.intervalMs) {
      this.lastRunAtIso = lastPersistedIso;
      return { executed: false };
    }

    return this.runNowAsync();
  }

  public async runNowAsync(): Promise<{
    executed: boolean;
    result?: DailyAggregationResult;
  }> {
    if (this.isAggregationInProgress) {
      return { executed: false };
    }

    this.isAggregationInProgress = true;
    this.notifyListeners();
    try {
      const result = await this.aggregationService.aggregateDailyStatsAsync();
      this.lastRunAtIso = result.aggregatedAt;
      this.lastRunRecordsCount = result.writtenRecordsCount;
      this.notifyListeners();
      return { executed: true, result };
    } catch (error) {
      this.logger?.error('DAILY_STATS_AGGREGATION_JOB_FAILED', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { executed: false };
    } finally {
      this.isAggregationInProgress = false;
      this.notifyListeners();
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Ignore subscriber errors
      }
    }
  }
}
