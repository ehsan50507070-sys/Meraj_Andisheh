export type SystemHealthState = 'healthy' | 'degraded' | 'unhealthy';

export type DatabaseConnectionState = 'connected' | 'disconnected';

export interface DatabaseHealthDetails {
  state: DatabaseConnectionState;
  databaseName: string;
  databaseVersion: number;
  metaStoreName: string;
  readWriteVerified: boolean;
  latencyMs: number;
  errorMessage?: string;
}

export interface HealthStatus {
  appHealthy: boolean;
  overallState: SystemHealthState;
  checkedAtUtc: string;
  checkedAtJalali: string;
  database: DatabaseHealthDetails;
}
