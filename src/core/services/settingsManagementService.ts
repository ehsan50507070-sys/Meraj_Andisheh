import type { IAdminRepository } from '../abstractions/adminRepository';
import type { ILogger } from '../abstractions/ILogger';
import type { AppUser } from '../domain/auth';
import {
  FEATURE_FLAG_KEYS,
  type FeatureFlag,
  type FeatureFlagKey,
  type SiteSetting,
} from '../domain/settings';
import { normalizeDigits } from './identifierService';
import { PermissionPolicyService } from './permissionPolicyService';

export const KNOWN_SITE_SETTING_KEYS = [
  'Site.Title',
  'Site.Subtitle',
  'Personalization.DefaultEnabled',
  'Personalization.MinViews',
  'Comments.MaxLength',
  'Upload.MaxVideoMb',
  'Upload.MaxOtherMb',
  'Home.ItemsPerShelf',
] as const;

export type KnownSiteSettingKey = (typeof KNOWN_SITE_SETTING_KEYS)[number];

const POSITIVE_INTEGER_SETTING_KEYS: readonly KnownSiteSettingKey[] = [
  'Personalization.MinViews',
  'Comments.MaxLength',
  'Upload.MaxVideoMb',
  'Upload.MaxOtherMb',
  'Home.ItemsPerShelf',
];

export interface GetFeatureFlagsResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  items?: FeatureFlag[];
  messageKey?: string;
}

export interface ToggleFeatureFlagResult {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404;
  flag?: FeatureFlag;
  messageKey?: string;
}

export interface GetSiteSettingsResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  items?: SiteSetting[];
  messageKey?: string;
}

export interface UpdateSiteSettingsResult {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404;
  items?: SiteSetting[];
  fieldErrors?: Record<string, string>;
  errorCode?: 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION_FAILED';
  messageKey?: string;
}

export function isValidFeatureFlagKey(key: string): key is FeatureFlagKey {
  return (FEATURE_FLAG_KEYS as readonly string[]).includes(key);
}

export class SettingsManagementService {
  private readonly repository: IAdminRepository;
  private readonly logger: ILogger;
  private readonly policyService: PermissionPolicyService;

  constructor(
    repository: IAdminRepository,
    logger: ILogger,
    policyService: PermissionPolicyService,
  ) {
    this.repository = repository;
    this.logger = logger;
    this.policyService = policyService;
  }

  public async getPublicSiteTitle(fallbackTitle: string): Promise<string> {
    const setting = await this.repository.getSiteSettingByKey('Site.Title');
    const trimmed = setting?.value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : fallbackTitle;
  }

  public async getPublicSiteSubtitle(fallbackSubtitle: string): Promise<string> {
    const setting = await this.repository.getSiteSettingByKey('Site.Subtitle');
    const trimmed = setting?.value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : fallbackSubtitle;
  }

  public async getPublicFeatureFlagState(key: FeatureFlagKey): Promise<boolean> {
    const stored = await this.repository.getAllFeatureFlags();
    return stored.find((flag) => flag.key === key)?.isEnabled === true;
  }

  public async getFeatureFlags(actor: AppUser | null): Promise<GetFeatureFlagsResult> {
    const auth = await this.policyService.authorizePermission(
      actor,
      'settings.manage',
      '#/admin/settings',
    );
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const stored = await this.repository.getAllFeatureFlags();
    const byKey = new Map(stored.map((flag) => [flag.key, flag]));
    const ordered: FeatureFlag[] = FEATURE_FLAG_KEYS.map((key) => ({
      key,
      isEnabled: byKey.get(key)?.isEnabled ?? false,
    }));

    return {
      ok: true,
      statusCode: 200,
      items: ordered,
    };
  }

  public async toggleFeatureFlag(
    actor: AppUser | null,
    key: FeatureFlagKey,
    isEnabled: boolean,
  ): Promise<ToggleFeatureFlagResult> {
    const auth = await this.policyService.authorizePermission(
      actor,
      'settings.manage',
      '#/admin/settings',
    );
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    if (!isValidFeatureFlagKey(key)) {
      return {
        ok: false,
        statusCode: 400,
        messageKey: 'admin.settings.error.invalidFlagKey',
      };
    }

    const flag: FeatureFlag = { key, isEnabled };
    await this.repository.upsertFeatureFlag(flag);

    this.logger.info('ADMIN_FEATURE_FLAG_UPDATED', {
      actorId: actor.id,
      flagKey: key,
      isEnabled,
    });

    return {
      ok: true,
      statusCode: 200,
      flag,
    };
  }

  public async getSiteSettings(actor: AppUser | null): Promise<GetSiteSettingsResult> {
    const auth = await this.policyService.authorizePermission(
      actor,
      'settings.manage',
      '#/admin/settings',
    );
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const stored = await this.repository.getAllSiteSettings();
    const byKey = new Map(stored.map((item) => [item.key, item]));
    const ordered: SiteSetting[] = [];

    for (const key of KNOWN_SITE_SETTING_KEYS) {
      const existing = byKey.get(key);
      if (existing) {
        ordered.push(existing);
      }
    }
    for (const item of stored) {
      if (!(KNOWN_SITE_SETTING_KEYS as readonly string[]).includes(item.key)) {
        ordered.push(item);
      }
    }

    return {
      ok: true,
      statusCode: 200,
      items: ordered,
    };
  }

  public async updateSiteSettings(
    actor: AppUser | null,
    values: Record<string, string>,
  ): Promise<UpdateSiteSettingsResult> {
    const auth = await this.policyService.authorizePermission(
      actor,
      'settings.manage',
      '#/admin/settings',
    );
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const fieldErrors: Record<string, string> = {};
    const normalizedSettings: SiteSetting[] = [];

    for (const key of KNOWN_SITE_SETTING_KEYS) {
      if (!(key in values)) {
        continue;
      }
      const rawValue = values[key] ?? '';

      if (key === 'Site.Title' || key === 'Site.Subtitle') {
        const trimmed = rawValue.trim();
        const maxLen = key === 'Site.Title' ? 120 : 240;
        if (trimmed.length === 0 || trimmed.length > maxLen) {
          fieldErrors[key] = 'admin.settings.error.requiredText';
        } else {
          normalizedSettings.push({ key, value: trimmed });
        }
        continue;
      }

      if (key === 'Personalization.DefaultEnabled') {
        const normalizedBool = normalizeDigits(rawValue).trim();
        if (normalizedBool !== '0' && normalizedBool !== '1') {
          fieldErrors[key] = 'admin.settings.error.booleanFlag';
        } else {
          normalizedSettings.push({ key, value: normalizedBool });
        }
        continue;
      }

      if (POSITIVE_INTEGER_SETTING_KEYS.includes(key)) {
        const normalizedInt = normalizeDigits(rawValue).trim();
        if (!/^\d+$/.test(normalizedInt) || Number(normalizedInt) < 1) {
          fieldErrors[key] = 'admin.settings.error.positiveInteger';
        } else {
          normalizedSettings.push({
            key,
            value: String(Number(normalizedInt)),
          });
        }
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_FAILED',
        fieldErrors,
        messageKey: 'admin.settings.error.validationFailed',
      };
    }

    await this.repository.upsertSiteSettings(normalizedSettings);

    this.logger.info('ADMIN_SITE_SETTINGS_UPDATED', {
      actorId: actor.id,
      updatedKeys: normalizedSettings.map((item) => item.key),
    });

    return {
      ok: true,
      statusCode: 200,
      items: normalizedSettings,
    };
  }
}
