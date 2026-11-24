import type { IClock } from '../../core/abstractions/IClock';
import type { ILogger } from '../../core/abstractions/ILogger';
import type {
  IBackupLogRepository,
  IBackupService,
} from '../../core/abstractions/backupService';

export const WEEKLY_BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEV_TEST_BACKUP_INTERVAL_MS = 60 * 1000;

export interface BackupSchedulerState {
  isRunning: boolean;
  intervalMs: number;
  isDevOneMinuteMode: boolean;
  lastScheduledSucceededAt: string | null;
  nextRunAtIso: string;
}

export interface BackupSchedulerDependencies {
  backupService: IBackupService;
  backupLogRepository: IBackupLogRepository;
  clock: IClock;
  logger?: ILogger;
  intervalMs?: number;
}

export class BackupScheduler {
  private readonly backupService: IBackupService;
  private readonly backupLogRepository: IBackupLogRepository;
  private readonly clock: IClock;
  private readonly logger?: ILogger;
  private readonly listeners = new Set<() => void>();

  private intervalMs: number;
  private isRunning = false;
  private isTickInProgress = false;
  private modeAnchorMs: number;
  private lastScheduledSucceededAt: string | null = null;
  private timerHandle: ReturnType<typeof setInterval> | null = null;

  constructor(deps: BackupSchedulerDependencies) {
    this.backupService = deps.backupService;
    this.backupLogRepository = deps.backupLogRepository;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.intervalMs = deps.intervalMs ?? WEEKLY_BACKUP_INTERVAL_MS;
    this.modeAnchorMs = this.clock.now().getTime();
  }

  public start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.modeAnchorMs = this.clock.now().getTime();
    this.resetPollingTimer();
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

  public setIntervalMs(nextIntervalMs: number): void {
    const safeMs = Math.max(1000, Math.floor(nextIntervalMs));
    this.intervalMs = safeMs;
    this.modeAnchorMs = this.clock.now().getTime();
    if (this.isRunning) {
      this.resetPollingTimer();
    }
    this.notifyListeners();
  }

  public setDevOneMinuteMode(enabled: boolean): void {
    this.setIntervalMs(
      enabled ? DEV_TEST_BACKUP_INTERVAL_MS : WEEKLY_BACKUP_INTERVAL_MS,
    );
  }

  public isDevOneMinuteMode(): boolean {
    return this.intervalMs === DEV_TEST_BACKUP_INTERVAL_MS;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): BackupSchedulerState {
    const lastScheduledMs = this.lastScheduledSucceededAt
      ? Date.parse(this.lastScheduledSucceededAt)
      : NaN;
    const referenceMs = Number.isFinite(lastScheduledMs)
      ? Math.max(lastScheduledMs, this.modeAnchorMs)
      : this.modeAnchorMs;
    const nextRunAtIso = new Date(referenceMs + this.intervalMs).toISOString();

    return {
      isRunning: this.isRunning,
      intervalMs: this.intervalMs,
      isDevOneMinuteMode: this.isDevOneMinuteMode(),
      lastScheduledSucceededAt: this.lastScheduledSucceededAt,
      nextRunAtIso,
    };
  }

  public async tickAsync(): Promise<{ executed: boolean; backupLogId?: number }> {
    if (this.isTickInProgress) {
      return { executed: false };
    }

    this.isTickInProgress = true;
    try {
      const logs = await this.backupLogRepository.listBackupLogsAsync();
      const latestScheduled = [...logs]
        .filter((l) => l.kind === 'Scheduled' && l.status === 'Succeeded')
        .sort((a, b) => {
          const cmp = b.startedAt.localeCompare(a.startedAt);
          return cmp !== 0 ? cmp : b.id - a.id;
        })[0];

      this.lastScheduledSucceededAt = latestScheduled?.startedAt ?? null;

      const lastRunMs = latestScheduled ? Date.parse(latestScheduled.startedAt) : NaN;
      const referenceMs = Number.isFinite(lastRunMs)
        ? Math.max(lastRunMs, this.modeAnchorMs)
        : this.modeAnchorMs;
      const nowMs = this.clock.now().getTime();

      if (nowMs - referenceMs < this.intervalMs) {
        return { executed: false };
      }

      const result = await this.backupService.runBackupAsync('SYSTEM', 'Scheduled');
      if (result.ok && result.backupLog) {
        this.lastScheduledSucceededAt = result.backupLog.startedAt;
        this.notifyListeners();
        return {
          executed: true,
          backupLogId: result.backupLog.id,
        };
      }

      return { executed: false };
    } catch (error) {
      this.logger?.error('BACKUP_SCHEDULER_TICK_FAILED', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { executed: false };
    } finally {
      this.isTickInProgress = false;
    }
  }

  private resetPollingTimer(): void {
    if (this.timerHandle !== null) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    const cadenceMs = Math.max(
      1000,
      Math.min(Math.floor(this.intervalMs / 12), 60_000),
    );
    this.timerHandle = setInterval(() => {
      void this.tickAsync();
    }, cadenceMs);
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
