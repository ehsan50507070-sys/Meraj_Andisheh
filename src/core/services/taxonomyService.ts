import type { ILogger } from '../abstractions/ILogger';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import type { AppUser } from '../domain/auth';
import type { PermissionKey } from '../domain/permissions';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../domain/taxonomy';
import { FileUploadService } from './fileUploadService';
import { normalizeDigits } from './identifierService';
import { PermissionPolicyService } from './permissionPolicyService';
import { ensureUniqueSlug } from './slugService';
import { isValidThemeKey, type ThemeKey } from './themeService';

export const TAXONOMY_ROUTE_PATH = '#/admin/taxonomy';
export const TAXONOMY_PERMISSION_KEY: PermissionKey = 'taxonomy.manage';
export const MAX_TOPIC_NAME_LENGTH = 120;
export const MAX_TOPIC_ICON_LENGTH = 64;
export const MAX_TAG_NAME_LENGTH = 80;
export const MAX_PERSON_NAME_LENGTH = 120;
export const MAX_PERSON_BIO_LENGTH = 1000;
export const MAX_IMPACT_LEVEL_NAME_LENGTH = 80;
export const MAX_AGE_GROUP_NAME_LENGTH = 80;
export const MAX_AGE_BOUND = 150;

export type TaxonomyErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'ENTITY_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INVALID_PARENT'
  | 'TOPIC_CIRCULAR_PARENT'
  | 'TOPIC_HAS_CONTENT'
  | 'TOPIC_HAS_CHILDREN'
  | 'TAG_IN_USE'
  | 'PERSON_BIO_TOO_LONG'
  | 'PERSON_PHOTO_UPLOAD_FAILED'
  | 'PERSON_IN_USE'
  | 'IMPACT_LEVEL_IN_USE'
  | 'INVALID_AGE_RANGE'
  | 'INVALID_THEME_KEY'
  | 'LAST_ACTIVE_AGE_GROUP';

export interface TaxonomyResult<T = void> {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404;
  data?: T;
  errorCode?: TaxonomyErrorCode;
  messageKey?: string;
}

export interface TopicTreeNode {
  topic: Topic;
  depth: number;
  contentCount: number;
  totalSubtreeContentCount: number;
  children: TopicTreeNode[];
}

export interface TopicsOverviewData {
  topics: Topic[];
  tree: TopicTreeNode[];
  contentCountByTopicId: Record<number, number>;
}

export interface SaveTopicInput {
  parentId: number | null;
  name: string;
  slug?: string;
  icon?: string | null;
  sortOrder: number | string;
  isActive: boolean;
}

export interface SaveTagInput {
  name: string;
  slug?: string;
}

export interface PersonPhotoInput {
  originalFileName: string;
  bytes: Uint8Array;
  overrideSizeBytes?: number;
}

export interface SavePersonInput {
  name: string;
  slug?: string;
  bio: string;
  photoFile?: PersonPhotoInput | null;
  removePhoto?: boolean;
}

export interface SaveImpactLevelInput {
  name: string;
  sortOrder: number | string;
}

export interface UpdateAgeGroupInput {
  name: string;
  minAge: number | string;
  maxAge: number | string | null;
  themeKey: string;
  sortOrder: number | string;
  isActive: boolean;
}

function parseNonNegativeInteger(value: number | string): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  const normalized = normalizeDigits(String(value ?? '')).trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function collectDescendantTopicIds(
  rootTopicId: number,
  allTopics: readonly Topic[],
): Set<number> {
  const descendants = new Set<number>();
  const queue: number[] = [rootTopicId];
  const visited = new Set<number>([rootTopicId]);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const candidate of allTopics) {
      if (candidate.parentId === currentId && !visited.has(candidate.id)) {
        visited.add(candidate.id);
        descendants.add(candidate.id);
        queue.push(candidate.id);
      }
    }
  }

  return descendants;
}

export function buildTopicTree(
  topics: readonly Topic[],
  directContentCounts: ReadonlyMap<number, number>,
): TopicTreeNode[] {
  const sorted = [...topics].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const byParent = new Map<number | null, Topic[]>();

  for (const topic of sorted) {
    const bucket = byParent.get(topic.parentId) ?? [];
    bucket.push(topic);
    byParent.set(topic.parentId, bucket);
  }

  const knownIds = new Set(sorted.map((t) => t.id));
  const rootTopics = sorted.filter(
    (t) => t.parentId === null || !knownIds.has(t.parentId),
  );

  const visited = new Set<number>();

  const buildNode = (topic: Topic, depth: number): TopicTreeNode => {
    visited.add(topic.id);
    const directChildren = (byParent.get(topic.id) ?? []).filter((c) => !visited.has(c.id));
    const childNodes = directChildren.map((child) => buildNode(child, depth + 1));
    const ownCount = directContentCounts.get(topic.id) ?? 0;
    const subtreeCount =
      ownCount + childNodes.reduce((sum, node) => sum + node.totalSubtreeContentCount, 0);

    return {
      topic,
      depth,
      contentCount: ownCount,
      totalSubtreeContentCount: subtreeCount,
      children: childNodes,
    };
  };

  return rootTopics.map((root) => buildNode(root, 0));
}

export class TaxonomyService {
  private readonly repository: ITaxonomyRepository;
  private readonly policyService: PermissionPolicyService;
  private readonly fileUploadService: FileUploadService;
  private readonly logger: ILogger;

  constructor(
    repository: ITaxonomyRepository,
    policyService: PermissionPolicyService,
    fileUploadService: FileUploadService,
    logger: ILogger,
  ) {
    this.repository = repository;
    this.policyService = policyService;
    this.fileUploadService = fileUploadService;
    this.logger = logger;
  }

  private async authorizeTaxonomy<T>(actor: AppUser | null): Promise<TaxonomyResult<T> | null> {
    const auth = await this.policyService.authorizePermission(
      actor,
      TAXONOMY_PERMISSION_KEY,
      TAXONOMY_ROUTE_PATH,
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

  // ==================== Topics (Tree) ====================

  public async getTopicsOverviewAsync(
    actor: AppUser | null,
  ): Promise<TaxonomyResult<TopicsOverviewData>> {
    const denied = await this.authorizeTaxonomy<TopicsOverviewData>(actor);
    if (denied) return denied;

    const [topics, links] = await Promise.all([
      this.repository.getAllTopics(),
      this.repository.getContentTopicLinks(),
    ]);

    const directCounts = new Map<number, number>();
    for (const link of links) {
      directCounts.set(link.topicId, (directCounts.get(link.topicId) ?? 0) + 1);
    }

    const tree = buildTopicTree(topics, directCounts);
    const contentCountByTopicId: Record<number, number> = {};
    for (const topic of topics) {
      contentCountByTopicId[topic.id] = directCounts.get(topic.id) ?? 0;
    }

    return {
      ok: true,
      statusCode: 200,
      data: {
        topics,
        tree,
        contentCountByTopicId,
      },
    };
  }

  public async createTopicAsync(
    actor: AppUser | null,
    input: SaveTopicInput,
  ): Promise<TaxonomyResult<Topic>> {
    const denied = await this.authorizeTaxonomy<Topic>(actor);
    if (denied) return denied;

    const trimmedName = (input.name ?? '').trim();
    if (!trimmedName || trimmedName.length > MAX_TOPIC_NAME_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.topicNameInvalid',
      };
    }

    const parsedSortOrder = parseNonNegativeInteger(input.sortOrder);
    if (parsedSortOrder === null) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.sortOrderInvalid',
      };
    }

    const trimmedIcon = input.icon ? input.icon.trim() : '';
    if (trimmedIcon.length > MAX_TOPIC_ICON_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.topicIconTooLong',
      };
    }

    const allTopics = await this.repository.getAllTopics();
    if (input.parentId !== null) {
      const parentExists = allTopics.some((t) => t.id === input.parentId);
      if (!parentExists) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'INVALID_PARENT',
          messageKey: 'admin.taxonomy.error.parentNotFound',
        };
      }
    }

    const slugSource = (input.slug ?? '').trim() || trimmedName;
    const uniqueSlug = ensureUniqueSlug(
      slugSource,
      allTopics.map((t) => t.slug),
    );

    const created = await this.repository.createTopic({
      parentId: input.parentId,
      name: trimmedName,
      slug: uniqueSlug,
      icon: trimmedIcon || null,
      sortOrder: parsedSortOrder,
      isActive: Boolean(input.isActive),
    });

    this.logger.info('ADMIN_TOPIC_CREATED', {
      actorId: actor?.id,
      topicId: created.id,
      parentId: created.parentId,
      slug: created.slug,
    });

    return {
      ok: true,
      statusCode: 200,
      data: created,
    };
  }

  public async updateTopicAsync(
    actor: AppUser | null,
    topicId: number,
    input: SaveTopicInput,
  ): Promise<TaxonomyResult<Topic>> {
    const denied = await this.authorizeTaxonomy<Topic>(actor);
    if (denied) return denied;

    const allTopics = await this.repository.getAllTopics();
    const existing = allTopics.find((t) => t.id === topicId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.taxonomy.error.entityNotFound',
      };
    }

    const trimmedName = (input.name ?? '').trim();
    if (!trimmedName || trimmedName.length > MAX_TOPIC_NAME_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.topicNameInvalid',
      };
    }

    const parsedSortOrder = parseNonNegativeInteger(input.sortOrder);
    if (parsedSortOrder === null) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.sortOrderInvalid',
      };
    }

    const trimmedIcon = input.icon ? input.icon.trim() : '';
    if (trimmedIcon.length > MAX_TOPIC_ICON_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.topicIconTooLong',
      };
    }

    if (input.parentId !== null) {
      if (input.parentId === topicId) {
        this.logger.warn('ADMIN_TOPIC_CIRCULAR_PARENT_BLOCKED', {
          actorId: actor?.id,
          topicId,
          attemptedParentId: input.parentId,
        });
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'TOPIC_CIRCULAR_PARENT',
          messageKey: 'admin.taxonomy.error.circularParent',
        };
      }

      const parentExists = allTopics.some((t) => t.id === input.parentId);
      if (!parentExists) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'INVALID_PARENT',
          messageKey: 'admin.taxonomy.error.parentNotFound',
        };
      }

      const descendants = collectDescendantTopicIds(topicId, allTopics);
      if (descendants.has(input.parentId)) {
        this.logger.warn('ADMIN_TOPIC_CIRCULAR_PARENT_BLOCKED', {
          actorId: actor?.id,
          topicId,
          attemptedParentId: input.parentId,
        });
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'TOPIC_CIRCULAR_PARENT',
          messageKey: 'admin.taxonomy.error.circularParent',
        };
      }
    }

    const otherSlugs = allTopics.filter((t) => t.id !== topicId).map((t) => t.slug);
    const slugSource = (input.slug ?? '').trim() || trimmedName;
    const uniqueSlug = ensureUniqueSlug(slugSource, otherSlugs);

    const updated: Topic = {
      ...existing,
      parentId: input.parentId,
      name: trimmedName,
      slug: uniqueSlug,
      icon: trimmedIcon || null,
      sortOrder: parsedSortOrder,
      isActive: Boolean(input.isActive),
    };

    await this.repository.updateTopic(updated);
    this.logger.info('ADMIN_TOPIC_UPDATED', {
      actorId: actor?.id,
      topicId: updated.id,
      parentId: updated.parentId,
      slug: updated.slug,
      isActive: updated.isActive,
    });

    return {
      ok: true,
      statusCode: 200,
      data: updated,
    };
  }

  public async toggleTopicActiveAsync(
    actor: AppUser | null,
    topicId: number,
    isActive: boolean,
  ): Promise<TaxonomyResult<Topic>> {
    const denied = await this.authorizeTaxonomy<Topic>(actor);
    if (denied) return denied;

    const existing = await this.repository.getTopicById(topicId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.taxonomy.error.entityNotFound',
      };
    }

    const updated: Topic = {
      ...existing,
      isActive,
    };
    await this.repository.updateTopic(updated);

    this.logger.info('ADMIN_TOPIC_STATUS_CHANGED', {
      actorId: actor?.id,
      topicId,
      isActive,
    });

    return {
      ok: true,
      statusCode: 200,
      data: updated,
    };
  }

  public async deleteTopicAsync(
    actor: AppUser | null,
    topicId: number,
  ): Promise<TaxonomyResult<void>> {
    const denied = await this.authorizeTaxonomy<void>(actor);
    if (denied) return denied;

    const [allTopics, contentTopicLinks] = await Promise.all([
      this.repository.getAllTopics(),
      this.repository.getContentTopicLinks(),
    ]);

    const existing = allTopics.find((t) => t.id === topicId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.taxonomy.error.entityNotFound',
      };
    }

    // Rule 6.7: Block deletion if topic or any descendant has linked content.
    const subtreeIds = collectDescendantTopicIds(topicId, allTopics);
    subtreeIds.add(topicId);
    const hasLinkedContent = contentTopicLinks.some((link) => subtreeIds.has(link.topicId));
    if (hasLinkedContent) {
      this.logger.warn('ADMIN_TOPIC_DELETE_BLOCKED_HAS_CONTENT', {
        actorId: actor?.id,
        topicId,
      });
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'TOPIC_HAS_CONTENT',
        messageKey: 'admin.taxonomy.error.topicHasContent',
      };
    }

    const hasChildren = allTopics.some((t) => t.parentId === topicId);
    if (hasChildren) {
      this.logger.warn('ADMIN_TOPIC_DELETE_BLOCKED_HAS_CHILDREN', {
        actorId: actor?.id,
        topicId,
      });
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'TOPIC_HAS_CHILDREN',
        messageKey: 'admin.taxonomy.error.topicHasChildren',
      };
    }

    await this.repository.deleteTopic(topicId);
    this.logger.info('ADMIN_TOPIC_DELETED', {
      actorId: actor?.id,
      topicId,
    });

    return {
      ok: true,
      statusCode: 200,
    };
  }

  // ==================== Tags ====================

  public async listTagsAsync(actor: AppUser | null): Promise<TaxonomyResult<Tag[]>> {
    const denied = await this.authorizeTaxonomy<Tag[]>(actor);
    if (denied) return denied;

    const tags = await this.repository.getAllTags();
    return {
      ok: true,
      statusCode: 200,
      data: tags,
    };
  }

  public async createTagAsync(
    actor: AppUser | null,
    input: SaveTagInput,
  ): Promise<TaxonomyResult<Tag>> {
    const denied = await this.authorizeTaxonomy<Tag>(actor);
    if (denied) return denied;

    const trimmedName = (input.name ?? '').trim();
    if (!trimmedName || trimmedName.length > MAX_TAG_NAME_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.tagNameInvalid',
      };
    }

    const existingTags = await this.repository.getAllTags();
    const slugSource = (input.slug ?? '').trim() || trimmedName;
    const uniqueSlug = ensureUniqueSlug(
      slugSource,
      existingTags.map((item) => item.slug),
    );

    const created = await this.repository.createTag({
      name: trimmedName,
      slug: uniqueSlug,
    });

    this.logger.info('ADMIN_TAG_CREATED', {
      actorId: actor?.id,
      tagId: created.id,
      slug: created.slug,
    });

    return {
      ok: true,
      statusCode: 200,
      data: created,
    };
  }

  public async updateTagAsync(
    actor: AppUser | null,
    tagId: number,
    input: SaveTagInput,
  ): Promise<TaxonomyResult<Tag>> {
    const denied = await this.authorizeTaxonomy<Tag>(actor);
    if (denied) return denied;

    const existingTags = await this.repository.getAllTags();
    const existing = existingTags.find((item) => item.id === tagId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.taxonomy.error.entityNotFound',
      };
    }

    const trimmedName = (input.name ?? '').trim();
    if (!trimmedName || trimmedName.length > MAX_TAG_NAME_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.tagNameInvalid',
      };
    }

    const otherSlugs = existingTags.filter((item) => item.id !== tagId).map((item) => item.slug);
    const slugSource = (input.slug ?? '').trim() || trimmedName;
    const uniqueSlug = ensureUniqueSlug(slugSource, otherSlugs);

    const updated: Tag = {
      ...existing,
      name: trimmedName,
      slug: uniqueSlug,
    };
    await this.repository.updateTag(updated);

    this.logger.info('ADMIN_TAG_UPDATED', {
      actorId: actor?.id,
      tagId: updated.id,
      slug: updated.slug,
    });

    return {
      ok: true,
      statusCode: 200,
      data: updated,
    };
  }

  public async deleteTagAsync(
    actor: AppUser | null,
    tagId: number,
  ): Promise<TaxonomyResult<void>> {
    const denied = await this.authorizeTaxonomy<void>(actor);
    if (denied) return denied;

    const existing = await this.repository.getTagById(tagId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.taxonomy.error.entityNotFound',
      };
    }

    const linkedCount = await this.repository.countContentTagsByTagId(tagId);
    if (linkedCount > 0) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'TAG_IN_USE',
        messageKey: 'admin.taxonomy.error.tagInUse',
      };
    }

    await this.repository.deleteTag(tagId);
    this.logger.info('ADMIN_TAG_DELETED', {
      actorId: actor?.id,
      tagId,
    });

    return {
      ok: true,
      statusCode: 200,
    };
  }

  // ==================== Persons (Authors/Speakers/Creators) ====================

  public async listPersonsAsync(actor: AppUser | null): Promise<TaxonomyResult<Person[]>> {
    const denied = await this.authorizeTaxonomy<Person[]>(actor);
    if (denied) return denied;

    const persons = await this.repository.getAllPersons();
    return {
      ok: true,
      statusCode: 200,
      data: persons,
    };
  }

  public async createPersonAsync(
    actor: AppUser | null,
    input: SavePersonInput,
  ): Promise<TaxonomyResult<Person>> {
    const denied = await this.authorizeTaxonomy<Person>(actor);
    if (denied) return denied;

    const trimmedName = (input.name ?? '').trim();
    if (!trimmedName || trimmedName.length > MAX_PERSON_NAME_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.personNameInvalid',
      };
    }

    const normalizedBio = (input.bio ?? '').trim();
    if (normalizedBio.length > MAX_PERSON_BIO_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'PERSON_BIO_TOO_LONG',
        messageKey: 'admin.taxonomy.error.personBioTooLong',
      };
    }

    let photoKey: string | null = null;
    if (input.photoFile) {
      const uploadRes = await this.fileUploadService.uploadFileAsync(
        actor,
        {
          originalFileName: input.photoFile.originalFileName,
          bytes: input.photoFile.bytes,
          visibility: 'public',
          overrideSizeBytes: input.photoFile.overrideSizeBytes,
        },
        {
          allowedPermissions: [TAXONOMY_PERMISSION_KEY],
          routePath: TAXONOMY_ROUTE_PATH,
        },
      );

      if (!uploadRes.ok || !uploadRes.metadata) {
        return {
          ok: false,
          statusCode: uploadRes.statusCode,
          errorCode: 'PERSON_PHOTO_UPLOAD_FAILED',
          messageKey: uploadRes.messageKey ?? 'storage.error.generic',
        };
      }
      photoKey = uploadRes.metadata.storageKey;
    }

    const allPersons = await this.repository.getAllPersons();
    const slugSource = (input.slug ?? '').trim() || trimmedName;
    const uniqueSlug = ensureUniqueSlug(
      slugSource,
      allPersons.map((p) => p.slug),
    );

    const created = await this.repository.createPerson({
      name: trimmedName,
      slug: uniqueSlug,
      bio: normalizedBio,
      photoKey,
    });

    this.logger.info('ADMIN_PERSON_CREATED', {
      actorId: actor?.id,
      personId: created.id,
      hasPhoto: created.photoKey !== null,
    });

    return {
      ok: true,
      statusCode: 200,
      data: created,
    };
  }

  public async updatePersonAsync(
    actor: AppUser | null,
    personId: number,
    input: SavePersonInput,
  ): Promise<TaxonomyResult<Person>> {
    const denied = await this.authorizeTaxonomy<Person>(actor);
    if (denied) return denied;

    const allPersons = await this.repository.getAllPersons();
    const existing = allPersons.find((p) => p.id === personId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.taxonomy.error.entityNotFound',
      };
    }

    const trimmedName = (input.name ?? '').trim();
    if (!trimmedName || trimmedName.length > MAX_PERSON_NAME_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.personNameInvalid',
      };
    }

    const normalizedBio = (input.bio ?? '').trim();
    if (normalizedBio.length > MAX_PERSON_BIO_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'PERSON_BIO_TOO_LONG',
        messageKey: 'admin.taxonomy.error.personBioTooLong',
      };
    }

    let nextPhotoKey = existing.photoKey;
    const previousPhotoKey = existing.photoKey;
    let shouldDeletePreviousPhoto = false;

    if (input.photoFile) {
      const uploadRes = await this.fileUploadService.uploadFileAsync(
        actor,
        {
          originalFileName: input.photoFile.originalFileName,
          bytes: input.photoFile.bytes,
          visibility: 'public',
          overrideSizeBytes: input.photoFile.overrideSizeBytes,
        },
        {
          allowedPermissions: [TAXONOMY_PERMISSION_KEY],
          routePath: TAXONOMY_ROUTE_PATH,
        },
      );

      if (!uploadRes.ok || !uploadRes.metadata) {
        return {
          ok: false,
          statusCode: uploadRes.statusCode,
          errorCode: 'PERSON_PHOTO_UPLOAD_FAILED',
          messageKey: uploadRes.messageKey ?? 'storage.error.generic',
        };
      }

      nextPhotoKey = uploadRes.metadata.storageKey;
      shouldDeletePreviousPhoto = previousPhotoKey !== null && previousPhotoKey !== nextPhotoKey;
    } else if (input.removePhoto && previousPhotoKey) {
      nextPhotoKey = null;
      shouldDeletePreviousPhoto = true;
    }

    const otherSlugs = allPersons.filter((p) => p.id !== personId).map((p) => p.slug);
    const slugSource = (input.slug ?? '').trim() || trimmedName;
    const uniqueSlug = ensureUniqueSlug(slugSource, otherSlugs);

    const updated: Person = {
      ...existing,
      name: trimmedName,
      slug: uniqueSlug,
      bio: normalizedBio,
      photoKey: nextPhotoKey,
    };

    await this.repository.updatePerson(updated);

    if (shouldDeletePreviousPhoto && previousPhotoKey) {
      await this.fileUploadService.deleteFileAsync(actor, previousPhotoKey, {
        allowedPermissions: [TAXONOMY_PERMISSION_KEY],
        routePath: TAXONOMY_ROUTE_PATH,
      });
    }

    this.logger.info('ADMIN_PERSON_UPDATED', {
      actorId: actor?.id,
      personId: updated.id,
      hasPhoto: updated.photoKey !== null,
    });

    return {
      ok: true,
      statusCode: 200,
      data: updated,
    };
  }

  public async deletePersonAsync(
    actor: AppUser | null,
    personId: number,
  ): Promise<TaxonomyResult<void>> {
    const denied = await this.authorizeTaxonomy<void>(actor);
    if (denied) return denied;

    const existing = await this.repository.getPersonById(personId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.taxonomy.error.entityNotFound',
      };
    }

    const linkedCount = await this.repository.countContentPersonsByPersonId(personId);
    if (linkedCount > 0) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'PERSON_IN_USE',
        messageKey: 'admin.taxonomy.error.personInUse',
      };
    }

    await this.repository.deletePerson(personId);

    if (existing.photoKey) {
      await this.fileUploadService.deleteFileAsync(actor, existing.photoKey, {
        allowedPermissions: [TAXONOMY_PERMISSION_KEY],
        routePath: TAXONOMY_ROUTE_PATH,
      });
    }

    this.logger.info('ADMIN_PERSON_DELETED', {
      actorId: actor?.id,
      personId,
    });

    return {
      ok: true,
      statusCode: 200,
    };
  }

  // ==================== Impact Levels ====================

  public async listImpactLevelsAsync(
    actor: AppUser | null,
  ): Promise<TaxonomyResult<ImpactLevel[]>> {
    const denied = await this.authorizeTaxonomy<ImpactLevel[]>(actor);
    if (denied) return denied;

    const items = await this.repository.getAllImpactLevels();
    return {
      ok: true,
      statusCode: 200,
      data: items,
    };
  }

  public async createImpactLevelAsync(
    actor: AppUser | null,
    input: SaveImpactLevelInput,
  ): Promise<TaxonomyResult<ImpactLevel>> {
    const denied = await this.authorizeTaxonomy<ImpactLevel>(actor);
    if (denied) return denied;

    const trimmedName = (input.name ?? '').trim();
    if (!trimmedName || trimmedName.length > MAX_IMPACT_LEVEL_NAME_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.impactNameInvalid',
      };
    }

    const parsedSortOrder = parseNonNegativeInteger(input.sortOrder);
    if (parsedSortOrder === null) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.sortOrderInvalid',
      };
    }

    const created = await this.repository.createImpactLevel({
      name: trimmedName,
      sortOrder: parsedSortOrder,
    });

    this.logger.info('ADMIN_IMPACT_LEVEL_CREATED', {
      actorId: actor?.id,
      impactLevelId: created.id,
    });

    return {
      ok: true,
      statusCode: 200,
      data: created,
    };
  }

  public async updateImpactLevelAsync(
    actor: AppUser | null,
    impactLevelId: number,
    input: SaveImpactLevelInput,
  ): Promise<TaxonomyResult<ImpactLevel>> {
    const denied = await this.authorizeTaxonomy<ImpactLevel>(actor);
    if (denied) return denied;

    const existing = await this.repository.getImpactLevelById(impactLevelId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.taxonomy.error.entityNotFound',
      };
    }

    const trimmedName = (input.name ?? '').trim();
    if (!trimmedName || trimmedName.length > MAX_IMPACT_LEVEL_NAME_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.impactNameInvalid',
      };
    }

    const parsedSortOrder = parseNonNegativeInteger(input.sortOrder);
    if (parsedSortOrder === null) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.sortOrderInvalid',
      };
    }

    const updated: ImpactLevel = {
      ...existing,
      name: trimmedName,
      sortOrder: parsedSortOrder,
    };
    await this.repository.updateImpactLevel(updated);

    this.logger.info('ADMIN_IMPACT_LEVEL_UPDATED', {
      actorId: actor?.id,
      impactLevelId: updated.id,
    });

    return {
      ok: true,
      statusCode: 200,
      data: updated,
    };
  }

  public async deleteImpactLevelAsync(
    actor: AppUser | null,
    impactLevelId: number,
  ): Promise<TaxonomyResult<void>> {
    const denied = await this.authorizeTaxonomy<void>(actor);
    if (denied) return denied;

    const existing = await this.repository.getImpactLevelById(impactLevelId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.taxonomy.error.entityNotFound',
      };
    }

    const linkedCount = await this.repository.countContentItemsByImpactLevelId(impactLevelId);
    if (linkedCount > 0) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'IMPACT_LEVEL_IN_USE',
        messageKey: 'admin.taxonomy.error.impactLevelInUse',
      };
    }

    await this.repository.deleteImpactLevel(impactLevelId);
    this.logger.info('ADMIN_IMPACT_LEVEL_DELETED', {
      actorId: actor?.id,
      impactLevelId,
    });

    return {
      ok: true,
      statusCode: 200,
    };
  }

  // ==================== Age Groups ====================

  public async listAgeGroupsAsync(actor: AppUser | null): Promise<TaxonomyResult<AgeGroup[]>> {
    const denied = await this.authorizeTaxonomy<AgeGroup[]>(actor);
    if (denied) return denied;

    const groups = await this.repository.getAllAgeGroups();
    return {
      ok: true,
      statusCode: 200,
      data: groups,
    };
  }

  public async getPublicActiveAgeGroupsAsync(): Promise<AgeGroup[]> {
    const all = await this.repository.getAllAgeGroups();
    return all
      .filter((group) => group.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  public async updateAgeGroupAsync(
    actor: AppUser | null,
    ageGroupId: number,
    input: UpdateAgeGroupInput,
  ): Promise<TaxonomyResult<AgeGroup>> {
    const denied = await this.authorizeTaxonomy<AgeGroup>(actor);
    if (denied) return denied;

    const allGroups = await this.repository.getAllAgeGroups();
    const existing = allGroups.find((g) => g.id === ageGroupId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.taxonomy.error.entityNotFound',
      };
    }

    const trimmedName = (input.name ?? '').trim();
    if (!trimmedName || trimmedName.length > MAX_AGE_GROUP_NAME_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.ageGroupNameInvalid',
      };
    }

    const parsedMinAge = parseNonNegativeInteger(input.minAge);
    if (parsedMinAge === null || parsedMinAge > MAX_AGE_BOUND) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_AGE_RANGE',
        messageKey: 'admin.taxonomy.error.ageRangeInvalid',
      };
    }

    let parsedMaxAge: number | null = null;
    if (input.maxAge !== null && String(input.maxAge).trim() !== '') {
      const candidateMax = parseNonNegativeInteger(input.maxAge);
      if (candidateMax === null || candidateMax > MAX_AGE_BOUND || candidateMax < parsedMinAge) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'INVALID_AGE_RANGE',
          messageKey: 'admin.taxonomy.error.ageRangeInvalid',
        };
      }
      parsedMaxAge = candidateMax;
    }

    const normalizedThemeKey = (input.themeKey ?? '').trim().toLowerCase();
    if (!isValidThemeKey(normalizedThemeKey)) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_THEME_KEY',
        messageKey: 'admin.taxonomy.error.themeKeyInvalid',
      };
    }

    const parsedSortOrder = parseNonNegativeInteger(input.sortOrder);
    if (parsedSortOrder === null) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.taxonomy.error.sortOrderInvalid',
      };
    }

    if (!input.isActive && existing.isActive) {
      const otherActiveCount = allGroups.filter(
        (g) => g.id !== ageGroupId && g.isActive,
      ).length;
      if (otherActiveCount === 0) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'LAST_ACTIVE_AGE_GROUP',
          messageKey: 'admin.taxonomy.error.lastActiveAgeGroup',
        };
      }
    }

    const updated: AgeGroup = {
      ...existing,
      name: trimmedName,
      minAge: parsedMinAge,
      maxAge: parsedMaxAge,
      themeKey: normalizedThemeKey as ThemeKey,
      sortOrder: parsedSortOrder,
      isActive: Boolean(input.isActive),
    };

    await this.repository.updateAgeGroup(updated);
    this.logger.info('ADMIN_AGE_GROUP_UPDATED', {
      actorId: actor?.id,
      ageGroupId: updated.id,
      key: updated.key,
      minAge: updated.minAge,
      maxAge: updated.maxAge,
      themeKey: updated.themeKey,
      isActive: updated.isActive,
    });

    return {
      ok: true,
      statusCode: 200,
      data: updated,
    };
  }
}
