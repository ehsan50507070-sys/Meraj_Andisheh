import type { IContentRepository } from '../../core/abstractions/contentRepository';
import type {
  ContentAgeGroup,
  ContentFile,
  ContentItem,
  ContentPerson,
  ContentSource,
  ContentTag,
  ContentTopic,
} from '../../core/domain/content';
import type { AppUser } from '../../core/domain/auth';
import { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbContentRepository implements IContentRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async getAllContentItems(): Promise<ContentItem[]> {
    return this.dataStore.getAll<ContentItem>(STORE_NAMES.CONTENT_ITEMS);
  }

  public async getContentItemById(id: number): Promise<ContentItem | null> {
    return this.dataStore.getByKey<ContentItem>(STORE_NAMES.CONTENT_ITEMS, id);
  }

  public async getContentItemBySlug(slug: string): Promise<ContentItem | null> {
    return this.dataStore.getByIndex<ContentItem>(
      STORE_NAMES.CONTENT_ITEMS,
      'by_slug',
      slug,
    );
  }

  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    const creatorExists = await this.userExists(item.createdById);
    if (!creatorExists) {
      throw new Error(`FOREIGN_KEY_VIOLATION: createdById=${item.createdById} not found in users`);
    }
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.CONTENT_ITEMS, item);
    return { ...item, id };
  }

  public async updateContentItem(item: ContentItem): Promise<void> {
    await this.dataStore.putRecord(STORE_NAMES.CONTENT_ITEMS, item);
  }

  public async getSourcesByContentId(contentId: number): Promise<ContentSource[]> {
    const items = await this.dataStore.getAllByIndex<ContentSource>(
      STORE_NAMES.CONTENT_SOURCES,
      'by_contentId',
      contentId,
    );
    return items.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  public async getAllSources(): Promise<ContentSource[]> {
    return this.dataStore.getAll<ContentSource>(STORE_NAMES.CONTENT_SOURCES);
  }

  public async replaceSources(
    contentId: number,
    sources: Omit<ContentSource, 'id'>[],
  ): Promise<ContentSource[]> {
    const existing = await this.getSourcesByContentId(contentId);
    for (const item of existing) {
      await this.dataStore.deleteByKey(STORE_NAMES.CONTENT_SOURCES, item.id);
    }

    const inserted: ContentSource[] = [];
    for (const source of sources) {
      const payload = { ...source, contentId };
      const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.CONTENT_SOURCES, payload);
      inserted.push({ ...payload, id });
    }
    return inserted.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  public async getFilesByContentId(contentId: number): Promise<ContentFile[]> {
    const items = await this.dataStore.getAllByIndex<ContentFile>(
      STORE_NAMES.CONTENT_FILES,
      'by_contentId',
      contentId,
    );
    return items.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  public async getAllFiles(): Promise<ContentFile[]> {
    return this.dataStore.getAll<ContentFile>(STORE_NAMES.CONTENT_FILES);
  }

  public async replaceFiles(
    contentId: number,
    files: Omit<ContentFile, 'id'>[],
  ): Promise<ContentFile[]> {
    const existing = await this.getFilesByContentId(contentId);
    for (const item of existing) {
      await this.dataStore.deleteByKey(STORE_NAMES.CONTENT_FILES, item.id);
    }

    const inserted: ContentFile[] = [];
    for (const file of files) {
      const payload = { ...file, contentId };
      const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.CONTENT_FILES, payload);
      inserted.push({ ...payload, id });
    }
    return inserted.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  public async updateFile(file: ContentFile): Promise<void> {
    await this.dataStore.putRecord(STORE_NAMES.CONTENT_FILES, file);
  }

  public async getTopicIdsByContentId(contentId: number): Promise<number[]> {
    const links = await this.dataStore.getAllByIndex<ContentTopic>(
      STORE_NAMES.CONTENT_TOPICS,
      'by_contentId',
      contentId,
    );
    return links.map((link) => link.topicId);
  }

  public async getAllContentTopics(): Promise<ContentTopic[]> {
    return this.dataStore.getAll<ContentTopic>(STORE_NAMES.CONTENT_TOPICS);
  }

  public async replaceContentTopics(contentId: number, topicIds: number[]): Promise<void> {
    const existing = await this.dataStore.getAllByIndex<ContentTopic>(
      STORE_NAMES.CONTENT_TOPICS,
      'by_contentId',
      contentId,
    );
    for (const link of existing) {
      await this.dataStore.deleteByKey(STORE_NAMES.CONTENT_TOPICS, [contentId, link.topicId]);
    }
    const uniqueIds = Array.from(new Set(topicIds));
    for (const topicId of uniqueIds) {
      await this.dataStore.putRecord<ContentTopic>(STORE_NAMES.CONTENT_TOPICS, {
        contentId,
        topicId,
      });
    }
  }

  public async getTagIdsByContentId(contentId: number): Promise<number[]> {
    const links = await this.dataStore.getAllByIndex<ContentTag>(
      STORE_NAMES.CONTENT_TAGS,
      'by_contentId',
      contentId,
    );
    return links.map((link) => link.tagId);
  }

  public async getAllContentTags(): Promise<ContentTag[]> {
    return this.dataStore.getAll<ContentTag>(STORE_NAMES.CONTENT_TAGS);
  }

  public async replaceContentTags(contentId: number, tagIds: number[]): Promise<void> {
    const existing = await this.dataStore.getAllByIndex<ContentTag>(
      STORE_NAMES.CONTENT_TAGS,
      'by_contentId',
      contentId,
    );
    for (const link of existing) {
      await this.dataStore.deleteByKey(STORE_NAMES.CONTENT_TAGS, [contentId, link.tagId]);
    }
    const uniqueIds = Array.from(new Set(tagIds));
    for (const tagId of uniqueIds) {
      await this.dataStore.putRecord<ContentTag>(STORE_NAMES.CONTENT_TAGS, {
        contentId,
        tagId,
      });
    }
  }

  public async getPersonIdsByContentId(contentId: number): Promise<number[]> {
    const links = await this.dataStore.getAllByIndex<ContentPerson>(
      STORE_NAMES.CONTENT_PERSONS,
      'by_contentId',
      contentId,
    );
    return links.map((link) => link.personId);
  }

  public async getAllContentPersons(): Promise<ContentPerson[]> {
    return this.dataStore.getAll<ContentPerson>(STORE_NAMES.CONTENT_PERSONS);
  }

  public async replaceContentPersons(contentId: number, personIds: number[]): Promise<void> {
    const existing = await this.dataStore.getAllByIndex<ContentPerson>(
      STORE_NAMES.CONTENT_PERSONS,
      'by_contentId',
      contentId,
    );
    for (const link of existing) {
      await this.dataStore.deleteByKey(STORE_NAMES.CONTENT_PERSONS, [contentId, link.personId]);
    }
    const uniqueIds = Array.from(new Set(personIds));
    for (const personId of uniqueIds) {
      await this.dataStore.putRecord<ContentPerson>(STORE_NAMES.CONTENT_PERSONS, {
        contentId,
        personId,
      });
    }
  }

  public async getAgeGroupIdsByContentId(contentId: number): Promise<number[]> {
    const links = await this.dataStore.getAllByIndex<ContentAgeGroup>(
      STORE_NAMES.CONTENT_AGE_GROUPS,
      'by_contentId',
      contentId,
    );
    return links.map((link) => link.ageGroupId);
  }

  public async getAllContentAgeGroups(): Promise<ContentAgeGroup[]> {
    return this.dataStore.getAll<ContentAgeGroup>(STORE_NAMES.CONTENT_AGE_GROUPS);
  }

  public async replaceContentAgeGroups(contentId: number, ageGroupIds: number[]): Promise<void> {
    const existing = await this.dataStore.getAllByIndex<ContentAgeGroup>(
      STORE_NAMES.CONTENT_AGE_GROUPS,
      'by_contentId',
      contentId,
    );
    for (const link of existing) {
      await this.dataStore.deleteByKey(STORE_NAMES.CONTENT_AGE_GROUPS, [
        contentId,
        link.ageGroupId,
      ]);
    }
    const uniqueIds = Array.from(new Set(ageGroupIds));
    for (const ageGroupId of uniqueIds) {
      await this.dataStore.putRecord<ContentAgeGroup>(STORE_NAMES.CONTENT_AGE_GROUPS, {
        contentId,
        ageGroupId,
      });
    }
  }

  public async userExists(userId: number): Promise<boolean> {
    const user = await this.dataStore.getByKey<AppUser>(STORE_NAMES.USERS, userId);
    return user !== null;
  }
}
