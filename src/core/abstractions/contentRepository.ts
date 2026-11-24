import type {
  ContentFile,
  ContentItem,
  ContentPerson,
  ContentSource,
  ContentTag,
  ContentTopic,
} from '../domain/content';

export interface ContentAggregate {
  item: ContentItem;
  sources: ContentSource[];
  files: ContentFile[];
  topicIds: number[];
  tagIds: number[];
  personIds: number[];
  ageGroupIds: number[];
}

export interface IContentRepository {
  getAllContentItems(): Promise<ContentItem[]>;
  getContentItemById(id: number): Promise<ContentItem | null>;
  getContentItemBySlug(slug: string): Promise<ContentItem | null>;
  createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem>;
  updateContentItem(item: ContentItem): Promise<void>;

  getSourcesByContentId(contentId: number): Promise<ContentSource[]>;
  getAllSources(): Promise<ContentSource[]>;
  replaceSources(
    contentId: number,
    sources: Omit<ContentSource, 'id'>[],
  ): Promise<ContentSource[]>;

  getFilesByContentId(contentId: number): Promise<ContentFile[]>;
  getAllFiles(): Promise<ContentFile[]>;
  replaceFiles(
    contentId: number,
    files: Omit<ContentFile, 'id'>[],
  ): Promise<ContentFile[]>;
  updateFile?(file: ContentFile): Promise<void>;

  getTopicIdsByContentId(contentId: number): Promise<number[]>;
  getAllContentTopics(): Promise<ContentTopic[]>;
  replaceContentTopics(contentId: number, topicIds: number[]): Promise<void>;

  getTagIdsByContentId(contentId: number): Promise<number[]>;
  getAllContentTags(): Promise<ContentTag[]>;
  replaceContentTags(contentId: number, tagIds: number[]): Promise<void>;

  getPersonIdsByContentId(contentId: number): Promise<number[]>;
  getAllContentPersons(): Promise<ContentPerson[]>;
  replaceContentPersons(contentId: number, personIds: number[]): Promise<void>;

  getAgeGroupIdsByContentId(contentId: number): Promise<number[]>;
  getAllContentAgeGroups(): Promise<Array<{ contentId: number; ageGroupId: number }>>;
  replaceContentAgeGroups(contentId: number, ageGroupIds: number[]): Promise<void>;

  userExists(userId: number): Promise<boolean>;
}
