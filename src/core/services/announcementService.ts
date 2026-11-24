import type { IClock } from '../abstractions/IClock';
import type { ILogger } from '../abstractions/ILogger';
import type { IAdminRepository } from '../abstractions/adminRepository';
import type { IAnnouncementDismissStorage } from '../abstractions/announcementDismissStorage';
import type { IAnnouncementRepository } from '../abstractions/announcementRepository';
import type { AppUser } from '../domain/auth';
import {
  MAX_ANNOUNCEMENT_LINK_URL,
  MAX_ANNOUNCEMENT_TEXT,
  type AnnouncementComputedStatus,
  type AnnouncementItem,
} from '../domain/layout';
import type { PermissionPolicyService } from './permissionPolicyService';

export interface AnnouncementServiceDependencies {
  announcementRepository: IAnnouncementRepository;
  adminRepository: IAdminRepository;
  dismissStorage: IAnnouncementDismissStorage;
  permissionPolicyService: PermissionPolicyService;
  clock: IClock;
  logger: ILogger;
}

export type AnnouncementErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ANNOUNCEMENT_TEXT_INVALID'
  | 'ANNOUNCEMENT_LINK_INVALID'
  | 'INVALID_DATE'
  | 'INVALID_DATE_RANGE'
  | 'INVALID_PRIORITY';

export interface AnnouncementActionResult<T = void> {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404;
  data?: T;
  errorCode?: AnnouncementErrorCode;
  messageKey?: string;
}

export interface SaveAnnouncementInput {
  id?: number;
  text: string;
  linkUrl?: string | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  priority?: number | string;
}

export interface PublicAnnouncementsResult {
  enabled: boolean;
  activeAnnouncements: AnnouncementItem[];
  currentAnnouncement: AnnouncementItem | null;
}

export interface AdminAnnouncementRow {
  item: AnnouncementItem;
  computedStatus: AnnouncementComputedStatus;
}

export interface AdminAnnouncementListResult {
  isFeatureEnabled: boolean;
  rows: AdminAnnouncementRow[];
}

export interface AnnouncementLinkValidationResult {
  valid: boolean;
  normalized: string | null;
}

export function normalizeAnnouncementDigitsToLatin(raw: string): string {
  return raw
    .replace(/[۰-۹]/g, (char) => String(char.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (char) => String(char.charCodeAt(0) - 0x0660));
}

export function parseAnnouncementPriority(
  raw: number | string | undefined,
): { ok: boolean; value: number } {
  if (raw === undefined) {
    return { ok: true, value: 0 };
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      return { ok: false, value: 0 };
    }
    return { ok: true, value: raw };
  }
  const normalized = normalizeAnnouncementDigitsToLatin(raw).trim();
  if (!normalized) {
    return { ok: true, value: 0 };
  }
  if (!/^-?\d+$/.test(normalized)) {
    return { ok: false, value: 0 };
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed)) {
    return { ok: false, value: 0 };
  }
  return { ok: true, value: parsed };
}

export function validateAnnouncementLinkUrl(
  raw: string | null | undefined,
): AnnouncementLinkValidationResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { valid: true, normalized: null };
  }
  if (trimmed.length > MAX_ANNOUNCEMENT_LINK_URL) {
    return { valid: false, normalized: null };
  }
  if (/[\x00-\x1f\s]/.test(trimmed)) {
    return { valid: false, normalized: null };
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:')
  ) {
    return { valid: false, normalized: null };
  }

  if (trimmed.startsWith('#/')) {
    // Public news ticker must never link or refer to admin routes
    if (/^#\/admin(?:$|[/?#])/i.test(trimmed)) {
      return { valid: false, normalized: null };
    }
    return { valid: true, normalized: trimmed };
  }

  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.length > 0
    ) {
      return { valid: true, normalized: trimmed };
    }
  } catch {
    return { valid: false, normalized: null };
  }

  return { valid: false, normalized: null };
}

export function computeAnnouncementStatusAtTime(
  item: AnnouncementItem,
  nowMs: number,
): AnnouncementComputedStatus {
  if (!item.isActive) {
    return 'Disabled';
  }
  const startMs = Date.parse(item.startsAt);
  const endMs = Date.parse(item.endsAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return 'Disabled';
  }
  if (nowMs < startMs) {
    return 'Scheduled';
  }
  if (nowMs >= endMs) {
    return 'Expired';
  }
  return 'ActiveNow';
}

export class AnnouncementService {
  private readonly announcementRepository: IAnnouncementRepository;
  private readonly adminRepository: IAdminRepository;
  private readonly dismissStorage: IAnnouncementDismissStorage;
  private readonly permissionPolicyService: PermissionPolicyService;
  private readonly clock: IClock;
  private readonly logger: ILogger;

  constructor(deps: AnnouncementServiceDependencies) {
    this.announcementRepository = deps.announcementRepository;
    this.adminRepository = deps.adminRepository;
    this.dismissStorage = deps.dismissStorage;
    this.permissionPolicyService = deps.permissionPolicyService;
    this.clock = deps.clock;
    this.logger = deps.logger;
  }

  // ==================== Public Read & Dismiss Methods ====================

  public async isFeatureEnabledAsync(): Promise<boolean> {
    const flags = await this.adminRepository.getAllFeatureFlags();
    const flag = flags.find((item) => item.key === 'NewsTicker');
    return flag?.isEnabled === true;
  }

  public async getActivePublicAnnouncementsAsync(): Promise<PublicAnnouncementsResult> {
    const enabled = await this.isFeatureEnabledAsync();
    if (!enabled) {
      return {
        enabled: false,
        activeAnnouncements: [],
        currentAnnouncement: null,
      };
    }

    const nowMs = this.clock.now().getTime();
    const all = await this.announcementRepository.getAllAnnouncements();
    const activeAnnouncements = all
      .filter((item) => {
        if (!item.isActive) {
          return false;
        }
        const startMs = Date.parse(item.startsAt);
        const endMs = Date.parse(item.endsAt);
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
          return false;
        }
        if (startMs > nowMs || nowMs >= endMs) {
          return false;
        }
        // Extra defense: never expose any announcement with an unsafe link
        const linkCheck = validateAnnouncementLinkUrl(item.linkUrl);
        return linkCheck.valid;
      })
      .sort((a, b) => b.priority - a.priority || b.id - a.id);

    const currentAnnouncement =
      activeAnnouncements.find((item) => !this.dismissStorage.isDismissed(item.id)) ??
      null;

    return {
      enabled: true,
      activeAnnouncements,
      currentAnnouncement,
    };
  }

  public async getCurrentBannerAnnouncementAsync(): Promise<{
    enabled: boolean;
    currentAnnouncement: AnnouncementItem | null;
  }> {
    const result = await this.getActivePublicAnnouncementsAsync();
    return {
      enabled: result.enabled,
      currentAnnouncement: result.currentAnnouncement,
    };
  }

  public dismissAnnouncementForSession(id: number): boolean {
    if (!Number.isInteger(id) || id <= 0) {
      return false;
    }
    this.dismissStorage.dismissAnnouncement(id);
    return true;
  }

  public computeStatus(
    item: AnnouncementItem,
    referenceDateMs?: number,
  ): AnnouncementComputedStatus {
    const nowMs =
      typeof referenceDateMs === 'number' && Number.isFinite(referenceDateMs)
        ? referenceDateMs
        : this.clock.now().getTime();
    return computeAnnouncementStatusAtTime(item, nowMs);
  }

  // ==================== Admin RBAC Guard ====================

  private async authorizeLayoutManage(actor: AppUser | null): Promise<{
    allowed: boolean;
    statusCode: 200 | 403 | 404;
  }> {
    const auth = await this.permissionPolicyService.authorizePermission(
      actor,
      'layout.manage',
      '#/admin/layout',
    );
    return {
      allowed: auth.allowed && Boolean(actor),
      statusCode: auth.statusCode,
    };
  }

  // ==================== Admin CRUD Methods ====================

  public async listAdminAnnouncementsAsync(
    actor: AppUser | null,
  ): Promise<AnnouncementActionResult<AdminAnnouncementListResult>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const [isFeatureEnabled, all] = await Promise.all([
      this.isFeatureEnabledAsync(),
      this.announcementRepository.getAllAnnouncements(),
    ]);
    const nowMs = this.clock.now().getTime();

    const rows: AdminAnnouncementRow[] = [...all]
      .sort((a, b) => b.priority - a.priority || b.id - a.id)
      .map((item) => ({
        item,
        computedStatus: computeAnnouncementStatusAtTime(item, nowMs),
      }));

    return {
      ok: true,
      statusCode: 200,
      data: {
        isFeatureEnabled,
        rows,
      },
    };
  }

  public async createAnnouncementAsync(
    actor: AppUser | null,
    input: Omit<SaveAnnouncementInput, 'id'>,
  ): Promise<AnnouncementActionResult<AnnouncementItem>> {
    return this.saveAnnouncementAsync(actor, { ...input, id: undefined });
  }

  public async updateAnnouncementAsync(
    actor: AppUser | null,
    id: number,
    input: Omit<SaveAnnouncementInput, 'id'>,
  ): Promise<AnnouncementActionResult<AnnouncementItem>> {
    return this.saveAnnouncementAsync(actor, { ...input, id });
  }

  public async saveAnnouncementAsync(
    actor: AppUser | null,
    input: SaveAnnouncementInput,
  ): Promise<AnnouncementActionResult<AnnouncementItem>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const text = (input.text ?? '').trim();
    if (text.length < 1 || text.length > MAX_ANNOUNCEMENT_TEXT) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ANNOUNCEMENT_TEXT_INVALID',
        messageKey: 'admin.layout.announcements.error.textInvalid',
      };
    }

    const linkValidation = validateAnnouncementLinkUrl(input.linkUrl);
    if (!linkValidation.valid) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ANNOUNCEMENT_LINK_INVALID',
        messageKey: 'admin.layout.announcements.error.linkInvalid',
      };
    }

    const startMs = Date.parse((input.startsAt ?? '').trim());
    const endMs = Date.parse((input.endsAt ?? '').trim());
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_DATE',
        messageKey: 'admin.layout.announcements.error.invalidDate',
      };
    }
    if (startMs >= endMs) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_DATE_RANGE',
        messageKey: 'admin.layout.announcements.error.invalidDateRange',
      };
    }

    const priorityValidation = parseAnnouncementPriority(input.priority);
    if (!priorityValidation.ok) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_PRIORITY',
        messageKey: 'admin.layout.announcements.error.invalidPriority',
      };
    }

    const nowIso = this.clock.nowUtcIso();
    const startsAtIso = new Date(startMs).toISOString();
    const endsAtIso = new Date(endMs).toISOString();

    if (input.id !== undefined) {
      const existing = await this.announcementRepository.getAnnouncementById(input.id);
      if (!existing) {
        return {
          ok: false,
          statusCode: 404,
          errorCode: 'NOT_FOUND',
          messageKey: 'admin.layout.error.notFound',
        };
      }

      const updated = await this.announcementRepository.updateAnnouncement({
        id: existing.id,
        text,
        linkUrl: linkValidation.normalized,
        startsAt: startsAtIso,
        endsAt: endsAtIso,
        isActive: Boolean(input.isActive),
        priority: priorityValidation.value,
        createdAt: existing.createdAt,
        updatedAt: nowIso,
      });

      this.logger.info('ADMIN_ANNOUNCEMENT_UPDATED', {
        actorId: actor.id,
        announcementId: updated.id,
        priority: updated.priority,
        isActive: updated.isActive,
      });

      return { ok: true, statusCode: 200, data: updated };
    }

    const created = await this.announcementRepository.createAnnouncement({
      text,
      linkUrl: linkValidation.normalized,
      startsAt: startsAtIso,
      endsAt: endsAtIso,
      isActive: Boolean(input.isActive),
      priority: priorityValidation.value,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    this.logger.info('ADMIN_ANNOUNCEMENT_CREATED', {
      actorId: actor.id,
      announcementId: created.id,
      priority: created.priority,
      isActive: created.isActive,
    });

    return { ok: true, statusCode: 200, data: created };
  }

  public async toggleAnnouncementActiveAsync(
    actor: AppUser | null,
    id: number,
    isActive: boolean,
  ): Promise<AnnouncementActionResult<AnnouncementItem>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const existing = await this.announcementRepository.getAnnouncementById(id);
    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'admin.layout.error.notFound',
      };
    }

    const updated = await this.announcementRepository.updateAnnouncement({
      ...existing,
      isActive: Boolean(isActive),
      updatedAt: this.clock.nowUtcIso(),
    });

    this.logger.info('ADMIN_ANNOUNCEMENT_TOGGLED', {
      actorId: actor.id,
      announcementId: updated.id,
      isActive: updated.isActive,
    });

    return { ok: true, statusCode: 200, data: updated };
  }

  public async deleteAnnouncementAsync(
    actor: AppUser | null,
    id: number,
  ): Promise<AnnouncementActionResult<void>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const existing = await this.announcementRepository.getAnnouncementById(id);
    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'admin.layout.error.notFound',
      };
    }

    await this.announcementRepository.deleteAnnouncement(id);

    this.logger.info('ADMIN_ANNOUNCEMENT_DELETED', {
      actorId: actor.id,
      announcementId: id,
    });

    return { ok: true, statusCode: 200 };
  }
}
