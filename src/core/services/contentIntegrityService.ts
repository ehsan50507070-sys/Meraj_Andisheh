import type { IAuthRepository } from '../abstractions/authRepository';
import type { ContentItem } from '../domain/content';

export interface ContentCreationResult {
  ok: boolean;
  item?: ContentItem;
  errorCode?: 'INVALID_CREATED_BY_USER';
  messageKey?: string;
}

export class ContentIntegrityService {
  private readonly repository: IAuthRepository;

  constructor(repository: IAuthRepository) {
    this.repository = repository;
  }

  public async verifyCreatorExists(createdById: number): Promise<boolean> {
    if (typeof createdById !== 'number' || !Number.isInteger(createdById) || createdById <= 0) {
      return false;
    }
    return this.repository.userExists(createdById);
  }

  public async createContentItem(
    item: Omit<ContentItem, 'id'>,
  ): Promise<ContentCreationResult> {
    const creatorExists = await this.verifyCreatorExists(item.createdById);
    if (!creatorExists) {
      return {
        ok: false,
        errorCode: 'INVALID_CREATED_BY_USER',
        messageKey: 'content.error.invalidCreatedByUser',
      };
    }

    const created = await this.repository.createContentItem(item);
    return {
      ok: true,
      item: created,
    };
  }
}
