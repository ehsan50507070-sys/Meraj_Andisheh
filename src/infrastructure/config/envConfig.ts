export type RuntimeEnvironment = 'development' | 'production';

export interface EnvConfig {
  readonly environment: RuntimeEnvironment;
  readonly isDevelopment: boolean;
  readonly isProduction: boolean;
  readonly isDevPreview: boolean;
  readonly stageNumber: number;
  readonly totalStages: number;
  readonly databaseName: string;
  readonly databaseVersion: number;
  readonly metaStoreName: string;
  readonly logStorageKey: string;
  readonly maxStoredLogs: number;
  readonly defaultHashRoute: string;
  readonly themeStorageKey: string;
  readonly sessionStorageKey: string;
  readonly initialSuperAdminEmail?: string;
  readonly initialSuperAdminTempPassword?: string;
}

function resolveRuntimeEnvironment(): RuntimeEnvironment {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env.PROD ? 'production' : 'development';
  }
  return 'development';
}

function readOptionalEnvString(key: string): string | undefined {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const val = (import.meta.env as Record<string, string | boolean | undefined>)[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
}

function resolveDevPreviewFlag(isDev: boolean): boolean {
  if (isDev) {
    return true;
  }
  const flag = readOptionalEnvString('VITE_ENABLE_DEV_PREVIEW');
  return flag === 'true';
}

const currentEnvironment = resolveRuntimeEnvironment();
const isDevelopment = currentEnvironment === 'development';

export const envConfig: EnvConfig = Object.freeze({
  environment: currentEnvironment,
  isDevelopment,
  isProduction: currentEnvironment === 'production',
  isDevPreview: resolveDevPreviewFlag(isDevelopment),
  stageNumber: 25,
  totalStages: 31,
  databaseName: 'MerajAndishehDB',
  databaseVersion: 17,
  metaStoreName: '_meta',
  logStorageKey: 'meraj_andisheh_logs_v1',
  maxStoredLogs: 200,
  defaultHashRoute: '#/',
  themeStorageKey: 'meraj_andisheh_theme_v1',
  sessionStorageKey: 'meraj_andisheh_session_token_v1',
  initialSuperAdminEmail: readOptionalEnvString('VITE_INITIAL_SUPERADMIN_EMAIL'),
  initialSuperAdminTempPassword: readOptionalEnvString('VITE_INITIAL_SUPERADMIN_TEMP_PASSWORD'),
});
