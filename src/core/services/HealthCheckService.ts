import type { IClock } from '../abstractions/IClock';
import type { IDataStore } from '../abstractions/IDataStore';
import type { ILogger } from '../abstractions/ILogger';
import type { HealthStatus } from '../domain/HealthStatus';

export class HealthCheckService {
  private readonly dataStore: IDataStore;
  private readonly logger: ILogger;
  private readonly clock: IClock;

  constructor(dataStore: IDataStore, logger: ILogger, clock: IClock) {
    this.dataStore = dataStore;
    this.logger = logger;
    this.clock = clock;
  }

  public async checkHealth(logSuccessMessage?: string, logFailureMessage?: string): Promise<HealthStatus> {
    const checkedAtUtc = this.clock.nowUtcIso();
    const checkedAtJalali = this.clock.nowJalali();
    const probe = await this.dataStore.verifyConnection();

    const appHealthy = true;
    const isDatabaseConnected = probe.connected && probe.readWriteVerified;
    const overallState = appHealthy && isDatabaseConnected ? 'healthy' : 'degraded';

    const status: HealthStatus = {
      appHealthy,
      overallState,
      checkedAtUtc,
      checkedAtJalali,
      database: {
        state: isDatabaseConnected ? 'connected' : 'disconnected',
        databaseName: probe.metadata.databaseName,
        databaseVersion: probe.metadata.databaseVersion,
        metaStoreName: probe.metadata.metaStoreName,
        readWriteVerified: probe.readWriteVerified,
        latencyMs: probe.latencyMs,
        errorMessage: probe.errorMessage,
      },
    };

    if (isDatabaseConnected) {
      if (logSuccessMessage) {
        this.logger.info(logSuccessMessage, {
          database: probe.metadata.databaseName,
          version: probe.metadata.databaseVersion,
          latencyMs: probe.latencyMs,
          readWriteVerified: probe.readWriteVerified,
        });
      }
    } else if (logFailureMessage) {
      this.logger.error(logFailureMessage, {
        database: probe.metadata.databaseName,
        error: probe.errorMessage ?? 'UNKNOWN_DB_ERROR',
      });
    }

    return status;
  }
}
