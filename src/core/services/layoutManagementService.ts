import type { IFileStorage } from '../abstractions/fileStorage';
import type { ILogger } from '../abstractions/ILogger';
import type { ILayoutRepository } from '../abstractions/layoutRepository';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import type { AppUser } from '../domain/auth';
import {
  HOME_SHELF_TYPES,
  MAX_HERO_SLIDE_LINK_URL,
  MAX_HERO_SLIDE_SUBTITLE,
  MAX_HERO_SLIDE_TITLE,
  MAX_HOME_SHELF_TITLE,
  MAX_STATIC_PAGE_BODY,
  MAX_STATIC_PAGE_SLUG,
  MAX_STATIC_PAGE_TITLE,
  type HeroSlide,
  type HomeShelf,
  type HomeShelfType,
  type StaticPage,
} from '../domain/layout';
import type { FileUploadService } from './fileUploadService';
import { sanitizeHtml } from './htmlSanitizer';
import type { PermissionPolicyService } from './permissionPolicyService';
import { ensureUniqueSlug, generateSlug } from './slugService';

export interface LayoutServiceDependencies {
  layoutRepository: ILayoutRepository;
  taxonomyRepository: ITaxonomyRepository;
  permissionPolicyService: PermissionPolicyService;
  fileUploadService: FileUploadService;
  fileStorage: IFileStorage;
  logger: ILogger;
}

export type LayoutErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SLIDE_TITLE_INVALID'
  | 'SLIDE_SUBTITLE_INVALID'
  | 'SLIDE_LINK_INVALID'
  | 'SLIDE_AGE_GROUP_INVALID'
  | 'SLIDE_IMAGE_INVALID'
  | 'SHELF_TITLE_INVALID'
  | 'SHELF_TYPE_INVALID'
  | 'SHELF_TOPIC_REQUIRED'
  | 'STATIC_PAGE_TITLE_INVALID'
  | 'STATIC_PAGE_SLUG_INVALID'
  | 'STATIC_PAGE_SLUG_DUPLICATE'
  | 'STATIC_PAGE_BODY_INVALID'
  | 'VALIDATION_FAILED';

export interface LayoutActionResult<T = void> {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404;
  data?: T;
  errorCode?: LayoutErrorCode;
  messageKey?: string;
}

export interface SaveHeroSlideInput {
  id?: number;
  title: string;
  subtitle: string;
  linkUrl: string;
  sortOrder?: number;
  isActive: boolean;
  ageGroupId: number | null;
  uploadedImage?: {
    originalFileName: string;
    bytes: Uint8Array;
  } | null;
  removeImage?: boolean;
}

export interface SaveHomeShelfInput {
  id?: number;
  title: string;
  type: HomeShelfType;
  topicId: number | null;
  sortOrder?: number;
  isVisible: boolean;
}

export interface SaveStaticPageInput {
  id?: number;
  title: string;
  slug?: string;
  body: string;
  showInFooter: boolean;
  sortOrder?: number;
}

export function validateHeroSlideLinkUrl(raw: string): {
  ok: boolean;
  normalizedUrl: string;
} {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed.length > MAX_HERO_SLIDE_LINK_URL) {
    return { ok: false, normalizedUrl: '' };
  }
  if (/[\x00-\x1f\s]/.test(trimmed)) {
    return { ok: false, normalizedUrl: '' };
  }

  if (trimmed.startsWith('#/')) {
    return { ok: true, normalizedUrl: trimmed };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { ok: true, normalizedUrl: trimmed };
    }
  } catch {
    return { ok: false, normalizedUrl: '' };
  }

  return { ok: false, normalizedUrl: '' };
}

function normalizeSortOrder(raw: number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  return fallback;
}

export class LayoutManagementService {
  private readonly layoutRepository: ILayoutRepository;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly permissionPolicyService: PermissionPolicyService;
  private readonly fileUploadService: FileUploadService;
  private readonly fileStorage: IFileStorage;
  private readonly logger: ILogger;

  constructor(deps: LayoutServiceDependencies) {
    this.layoutRepository = deps.layoutRepository;
    this.taxonomyRepository = deps.taxonomyRepository;
    this.permissionPolicyService = deps.permissionPolicyService;
    this.fileUploadService = deps.fileUploadService;
    this.fileStorage = deps.fileStorage;
    this.logger = deps.logger;
  }

  // ==================== Public Read Methods ====================

  public async getPublicStaticPageBySlug(rawSlug: string): Promise<StaticPage | null> {
    const normalizedSlug = (rawSlug ?? '').trim().toLowerCase();
    if (!normalizedSlug) {
      return null;
    }
    const page = await this.layoutRepository.getStaticPageBySlug(normalizedSlug);
    if (!page) {
      return null;
    }
    return {
      ...page,
      body: sanitizeHtml(page.body),
    };
  }

  public async listFooterStaticPages(): Promise<StaticPage[]> {
    const pages = await this.layoutRepository.getAllStaticPages();
    return pages
      .filter((page) => page.showInFooter)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
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

  // ==================== HeroSlide Admin CRUD ====================

  public async listHeroSlidesAdmin(
    actor: AppUser | null,
  ): Promise<LayoutActionResult<HeroSlide[]>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const slides = await this.layoutRepository.getAllHeroSlides();
    return {
      ok: true,
      statusCode: 200,
      data: [...slides].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    };
  }

  public async saveHeroSlide(
    actor: AppUser | null,
    input: SaveHeroSlideInput,
  ): Promise<LayoutActionResult<HeroSlide>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const title = (input.title ?? '').trim();
    if (title.length < 1 || title.length > MAX_HERO_SLIDE_TITLE) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'SLIDE_TITLE_INVALID',
        messageKey: 'admin.layout.error.slideTitleInvalid',
      };
    }

    const subtitle = (input.subtitle ?? '').trim();
    if (subtitle.length > MAX_HERO_SLIDE_SUBTITLE) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'SLIDE_SUBTITLE_INVALID',
        messageKey: 'admin.layout.error.slideSubtitleInvalid',
      };
    }

    const linkValidation = validateHeroSlideLinkUrl(input.linkUrl);
    if (!linkValidation.ok) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'SLIDE_LINK_INVALID',
        messageKey: 'admin.layout.error.slideLinkInvalid',
      };
    }

    let ageGroupId: number | null = null;
    if (input.ageGroupId !== null) {
      const ageGroups = await this.taxonomyRepository.getAllAgeGroups();
      const matched = ageGroups.find((g) => g.id === input.ageGroupId && g.isActive);
      if (!matched) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'SLIDE_AGE_GROUP_INVALID',
          messageKey: 'admin.layout.error.slideAgeGroupInvalid',
        };
      }
      ageGroupId = matched.id;
    }

    let existingSlide: HeroSlide | null = null;
    if (input.id !== undefined) {
      existingSlide = await this.layoutRepository.getHeroSlideById(input.id);
      if (!existingSlide) {
        return {
          ok: false,
          statusCode: 404,
          errorCode: 'NOT_FOUND',
          messageKey: 'admin.layout.error.notFound',
        };
      }
    }

    let nextImageKey: string | null = existingSlide ? existingSlide.imageKey : null;
    if (input.removeImage) {
      nextImageKey = null;
    }

    if (input.uploadedImage) {
      const uploadResult = await this.fileUploadService.uploadFileAsync(
        actor,
        {
          originalFileName: input.uploadedImage.originalFileName,
          bytes: input.uploadedImage.bytes,
          visibility: 'public',
        },
        {
          allowedPermissions: ['layout.manage'],
          routePath: '#/admin/layout',
        },
      );
      if (!uploadResult.ok || !uploadResult.metadata) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'SLIDE_IMAGE_INVALID',
          messageKey: uploadResult.messageKey ?? 'admin.layout.error.slideImageInvalid',
        };
      }
      nextImageKey = uploadResult.metadata.storageKey;
    }

    const oldImageKey = existingSlide?.imageKey ?? null;
    if (oldImageKey && oldImageKey !== nextImageKey) {
      await this.fileStorage.deleteAsync(oldImageKey);
    }

    if (existingSlide) {
      const updated = await this.layoutRepository.updateHeroSlide({
        id: existingSlide.id,
        title,
        subtitle,
        imageKey: nextImageKey,
        linkUrl: linkValidation.normalizedUrl,
        sortOrder: normalizeSortOrder(input.sortOrder, existingSlide.sortOrder),
        isActive: Boolean(input.isActive),
        ageGroupId,
      });

      this.logger.info('ADMIN_HERO_SLIDE_UPDATED', {
        actorId: actor.id,
        slideId: updated.id,
        ageGroupId: updated.ageGroupId,
        isActive: updated.isActive,
      });

      return { ok: true, statusCode: 200, data: updated };
    }

    const currentSlides = await this.layoutRepository.getAllHeroSlides();
    const maxSort = currentSlides.reduce((max, s) => Math.max(max, s.sortOrder), 0);
    const created = await this.layoutRepository.createHeroSlide({
      title,
      subtitle,
      imageKey: nextImageKey,
      linkUrl: linkValidation.normalizedUrl,
      sortOrder: normalizeSortOrder(input.sortOrder, maxSort + 1),
      isActive: Boolean(input.isActive),
      ageGroupId,
    });

    this.logger.info('ADMIN_HERO_SLIDE_CREATED', {
      actorId: actor.id,
      slideId: created.id,
      ageGroupId: created.ageGroupId,
      isActive: created.isActive,
    });

    return { ok: true, statusCode: 200, data: created };
  }

  public async toggleHeroSlideActive(
    actor: AppUser | null,
    id: number,
    isActive: boolean,
  ): Promise<LayoutActionResult<HeroSlide>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const existing = await this.layoutRepository.getHeroSlideById(id);
    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'admin.layout.error.notFound',
      };
    }

    const updated = await this.layoutRepository.updateHeroSlide({
      ...existing,
      isActive: Boolean(isActive),
    });

    this.logger.info('ADMIN_HERO_SLIDE_TOGGLED', {
      actorId: actor.id,
      slideId: updated.id,
      isActive: updated.isActive,
    });

    return { ok: true, statusCode: 200, data: updated };
  }

  public async moveHeroSlide(
    actor: AppUser | null,
    id: number,
    direction: 'up' | 'down',
  ): Promise<LayoutActionResult<HeroSlide[]>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const slides = (await this.layoutRepository.getAllHeroSlides()).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
    );
    const index = slides.findIndex((s) => s.id === id);
    if (index === -1) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'admin.layout.error.notFound',
      };
    }

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < slides.length) {
      const temp = slides[index];
      slides[index] = slides[targetIndex];
      slides[targetIndex] = temp;
    }

    const normalized: HeroSlide[] = [];
    for (let i = 0; i < slides.length; i += 1) {
      const nextSort = i + 1;
      const item = slides[i];
      if (item.sortOrder !== nextSort) {
        normalized.push(
          await this.layoutRepository.updateHeroSlide({ ...item, sortOrder: nextSort }),
        );
      } else {
        normalized.push(item);
      }
    }

    this.logger.info('ADMIN_HERO_SLIDE_REORDERED', {
      actorId: actor.id,
      slideId: id,
      direction,
    });

    return { ok: true, statusCode: 200, data: normalized };
  }

  public async deleteHeroSlide(
    actor: AppUser | null,
    id: number,
  ): Promise<LayoutActionResult<void>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const existing = await this.layoutRepository.getHeroSlideById(id);
    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'admin.layout.error.notFound',
      };
    }

    if (existing.imageKey) {
      await this.fileStorage.deleteAsync(existing.imageKey);
    }
    await this.layoutRepository.deleteHeroSlide(id);

    this.logger.info('ADMIN_HERO_SLIDE_DELETED', {
      actorId: actor.id,
      slideId: id,
    });

    return { ok: true, statusCode: 200 };
  }

  // ==================== HomeShelf Admin CRUD ====================

  public async listHomeShelvesAdmin(
    actor: AppUser | null,
  ): Promise<LayoutActionResult<HomeShelf[]>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const shelves = await this.layoutRepository.getAllHomeShelves();
    return {
      ok: true,
      statusCode: 200,
      data: [...shelves].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    };
  }

  public async saveHomeShelf(
    actor: AppUser | null,
    input: SaveHomeShelfInput,
  ): Promise<LayoutActionResult<HomeShelf>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const title = (input.title ?? '').trim();
    if (title.length < 1 || title.length > MAX_HOME_SHELF_TITLE) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'SHELF_TITLE_INVALID',
        messageKey: 'admin.layout.error.shelfTitleInvalid',
      };
    }

    if (!(HOME_SHELF_TYPES as readonly string[]).includes(input.type)) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'SHELF_TYPE_INVALID',
        messageKey: 'admin.layout.error.shelfTypeInvalid',
      };
    }

    let topicId: number | null = null;
    if (input.type === 'ByTopic') {
      if (input.topicId === null || !Number.isInteger(input.topicId) || input.topicId <= 0) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'SHELF_TOPIC_REQUIRED',
          messageKey: 'admin.layout.error.shelfTopicRequired',
        };
      }
      const topic = await this.taxonomyRepository.getTopicById(input.topicId);
      if (!topic) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'SHELF_TOPIC_REQUIRED',
          messageKey: 'admin.layout.error.shelfTopicRequired',
        };
      }
      topicId = topic.id;
    }

    if (input.id !== undefined) {
      const existing = await this.layoutRepository.getHomeShelfById(input.id);
      if (!existing) {
        return {
          ok: false,
          statusCode: 404,
          errorCode: 'NOT_FOUND',
          messageKey: 'admin.layout.error.notFound',
        };
      }

      const updated = await this.layoutRepository.updateHomeShelf({
        id: existing.id,
        title,
        type: input.type,
        topicId,
        sortOrder: normalizeSortOrder(input.sortOrder, existing.sortOrder),
        isVisible: Boolean(input.isVisible),
      });

      this.logger.info('ADMIN_HOME_SHELF_UPDATED', {
        actorId: actor.id,
        shelfId: updated.id,
        type: updated.type,
        topicId: updated.topicId,
        isVisible: updated.isVisible,
      });

      return { ok: true, statusCode: 200, data: updated };
    }

    const currentShelves = await this.layoutRepository.getAllHomeShelves();
    const maxSort = currentShelves.reduce((max, s) => Math.max(max, s.sortOrder), 0);
    const created = await this.layoutRepository.createHomeShelf({
      title,
      type: input.type,
      topicId,
      sortOrder: normalizeSortOrder(input.sortOrder, maxSort + 1),
      isVisible: Boolean(input.isVisible),
    });

    this.logger.info('ADMIN_HOME_SHELF_CREATED', {
      actorId: actor.id,
      shelfId: created.id,
      type: created.type,
      topicId: created.topicId,
      isVisible: created.isVisible,
    });

    return { ok: true, statusCode: 200, data: created };
  }

  public async toggleHomeShelfVisible(
    actor: AppUser | null,
    id: number,
    isVisible: boolean,
  ): Promise<LayoutActionResult<HomeShelf>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const existing = await this.layoutRepository.getHomeShelfById(id);
    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'admin.layout.error.notFound',
      };
    }

    const updated = await this.layoutRepository.updateHomeShelf({
      ...existing,
      isVisible: Boolean(isVisible),
    });

    this.logger.info('ADMIN_HOME_SHELF_TOGGLED', {
      actorId: actor.id,
      shelfId: updated.id,
      isVisible: updated.isVisible,
    });

    return { ok: true, statusCode: 200, data: updated };
  }

  public async moveHomeShelf(
    actor: AppUser | null,
    id: number,
    direction: 'up' | 'down',
  ): Promise<LayoutActionResult<HomeShelf[]>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const shelves = (await this.layoutRepository.getAllHomeShelves()).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
    );
    const index = shelves.findIndex((s) => s.id === id);
    if (index === -1) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'admin.layout.error.notFound',
      };
    }

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < shelves.length) {
      const temp = shelves[index];
      shelves[index] = shelves[targetIndex];
      shelves[targetIndex] = temp;
    }

    const normalized: HomeShelf[] = [];
    for (let i = 0; i < shelves.length; i += 1) {
      const nextSort = i + 1;
      const item = shelves[i];
      if (item.sortOrder !== nextSort) {
        normalized.push(
          await this.layoutRepository.updateHomeShelf({ ...item, sortOrder: nextSort }),
        );
      } else {
        normalized.push(item);
      }
    }

    this.logger.info('ADMIN_HOME_SHELF_REORDERED', {
      actorId: actor.id,
      shelfId: id,
      direction,
    });

    return { ok: true, statusCode: 200, data: normalized };
  }

  public async deleteHomeShelf(
    actor: AppUser | null,
    id: number,
  ): Promise<LayoutActionResult<void>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const existing = await this.layoutRepository.getHomeShelfById(id);
    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'admin.layout.error.notFound',
      };
    }

    await this.layoutRepository.deleteHomeShelf(id);

    this.logger.info('ADMIN_HOME_SHELF_DELETED', {
      actorId: actor.id,
      shelfId: id,
    });

    return { ok: true, statusCode: 200 };
  }

  // ==================== StaticPage Admin CRUD ====================

  public async listStaticPagesAdmin(
    actor: AppUser | null,
  ): Promise<LayoutActionResult<StaticPage[]>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const pages = await this.layoutRepository.getAllStaticPages();
    return {
      ok: true,
      statusCode: 200,
      data: [...pages].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    };
  }

  public async saveStaticPage(
    actor: AppUser | null,
    input: SaveStaticPageInput,
  ): Promise<LayoutActionResult<StaticPage>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const title = (input.title ?? '').trim();
    if (title.length < 1 || title.length > MAX_STATIC_PAGE_TITLE) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'STATIC_PAGE_TITLE_INVALID',
        messageKey: 'admin.layout.error.staticPageTitleInvalid',
      };
    }

    const sanitizedBody = sanitizeHtml(input.body ?? '').trim();
    if (sanitizedBody.length < 1 || sanitizedBody.length > MAX_STATIC_PAGE_BODY) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'STATIC_PAGE_BODY_INVALID',
        messageKey: 'admin.layout.error.staticPageBodyInvalid',
      };
    }

    const allPages = await this.layoutRepository.getAllStaticPages();
    const otherSlugs = allPages
      .filter((p) => p.id !== input.id)
      .map((p) => p.slug);

    const rawSlugInput = (input.slug ?? '').trim();
    let finalSlug: string;
    if (rawSlugInput.length > 0) {
      const normalized = generateSlug(rawSlugInput).toLowerCase();
      if (normalized.length < 1 || normalized.length > MAX_STATIC_PAGE_SLUG) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'STATIC_PAGE_SLUG_INVALID',
          messageKey: 'admin.layout.error.staticPageSlugInvalid',
        };
      }
      if (otherSlugs.includes(normalized)) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'STATIC_PAGE_SLUG_DUPLICATE',
          messageKey: 'admin.layout.error.staticPageSlugDuplicate',
        };
      }
      finalSlug = normalized;
    } else {
      const baseSlug = (generateSlug(title) || 'page').toLowerCase().slice(0, 100);
      finalSlug = ensureUniqueSlug(baseSlug, otherSlugs);
    }

    if (input.id !== undefined) {
      const existing = allPages.find((p) => p.id === input.id);
      if (!existing) {
        return {
          ok: false,
          statusCode: 404,
          errorCode: 'NOT_FOUND',
          messageKey: 'admin.layout.error.notFound',
        };
      }

      const updated = await this.layoutRepository.updateStaticPage({
        id: existing.id,
        slug: finalSlug,
        title,
        body: sanitizedBody,
        showInFooter: Boolean(input.showInFooter),
        sortOrder: normalizeSortOrder(input.sortOrder, existing.sortOrder),
      });

      this.logger.info('ADMIN_STATIC_PAGE_UPDATED', {
        actorId: actor.id,
        pageId: updated.id,
        slug: updated.slug,
        showInFooter: updated.showInFooter,
      });

      return { ok: true, statusCode: 200, data: updated };
    }

    const maxSort = allPages.reduce((max, p) => Math.max(max, p.sortOrder), 0);
    const created = await this.layoutRepository.createStaticPage({
      slug: finalSlug,
      title,
      body: sanitizedBody,
      showInFooter: Boolean(input.showInFooter),
      sortOrder: normalizeSortOrder(input.sortOrder, maxSort + 1),
    });

    this.logger.info('ADMIN_STATIC_PAGE_CREATED', {
      actorId: actor.id,
      pageId: created.id,
      slug: created.slug,
      showInFooter: created.showInFooter,
    });

    return { ok: true, statusCode: 200, data: created };
  }

  public async deleteStaticPage(
    actor: AppUser | null,
    id: number,
  ): Promise<LayoutActionResult<void>> {
    const auth = await this.authorizeLayoutManage(actor);
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const existing = await this.layoutRepository.getStaticPageById(id);
    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'admin.layout.error.notFound',
      };
    }

    await this.layoutRepository.deleteStaticPage(id);

    this.logger.info('ADMIN_STATIC_PAGE_DELETED', {
      actorId: actor.id,
      pageId: id,
    });

    return { ok: true, statusCode: 200 };
  }
}
