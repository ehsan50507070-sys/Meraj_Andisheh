import type { ITaxonomyRepository } from '../../core/abstractions/taxonomyRepository';
import type {
  ContentItem,
  ContentPerson,
  ContentTag,
  ContentTopic,
} from '../../core/domain/content';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../../core/domain/taxonomy';
import { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbTaxonomyRepository implements ITaxonomyRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  // Topics
  public async getAllTopics(): Promise<Topic[]> {
    const items = await this.dataStore.getAll<Topic>(STORE_NAMES.TOPICS);
    return items.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  public async getTopicById(id: number): Promise<Topic | null> {
    return this.dataStore.getByKey<Topic>(STORE_NAMES.TOPICS, id);
  }

  public async createTopic(topic: Omit<Topic, 'id'>): Promise<Topic> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.TOPICS, topic);
    return { ...topic, id };
  }

  public async updateTopic(topic: Topic): Promise<void> {
    await this.dataStore.putRecord(STORE_NAMES.TOPICS, topic);
  }

  public async deleteTopic(id: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.TOPICS, id);
  }

  // Tags
  public async getAllTags(): Promise<Tag[]> {
    const items = await this.dataStore.getAll<Tag>(STORE_NAMES.TAGS);
    return items.sort((a, b) => b.id - a.id);
  }

  public async getTagById(id: number): Promise<Tag | null> {
    return this.dataStore.getByKey<Tag>(STORE_NAMES.TAGS, id);
  }

  public async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.TAGS, tag);
    return { ...tag, id };
  }

  public async updateTag(tag: Tag): Promise<void> {
    await this.dataStore.putRecord(STORE_NAMES.TAGS, tag);
  }

  public async deleteTag(id: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.TAGS, id);
  }

  // Persons
  public async getAllPersons(): Promise<Person[]> {
    const items = await this.dataStore.getAll<Person>(STORE_NAMES.PERSONS);
    return items.sort((a, b) => b.id - a.id);
  }

  public async getPersonById(id: number): Promise<Person | null> {
    return this.dataStore.getByKey<Person>(STORE_NAMES.PERSONS, id);
  }

  public async createPerson(person: Omit<Person, 'id'>): Promise<Person> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.PERSONS, person);
    return { ...person, id };
  }

  public async updatePerson(person: Person): Promise<void> {
    await this.dataStore.putRecord(STORE_NAMES.PERSONS, person);
  }

  public async deletePerson(id: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.PERSONS, id);
  }

  // Impact Levels
  public async getAllImpactLevels(): Promise<ImpactLevel[]> {
    const items = await this.dataStore.getAll<ImpactLevel>(STORE_NAMES.IMPACT_LEVELS);
    return items.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  public async getImpactLevelById(id: number): Promise<ImpactLevel | null> {
    return this.dataStore.getByKey<ImpactLevel>(STORE_NAMES.IMPACT_LEVELS, id);
  }

  public async createImpactLevel(level: Omit<ImpactLevel, 'id'>): Promise<ImpactLevel> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.IMPACT_LEVELS, level);
    return { ...level, id };
  }

  public async updateImpactLevel(level: ImpactLevel): Promise<void> {
    await this.dataStore.putRecord(STORE_NAMES.IMPACT_LEVELS, level);
  }

  public async deleteImpactLevel(id: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.IMPACT_LEVELS, id);
  }

  // Age Groups
  public async getAllAgeGroups(): Promise<AgeGroup[]> {
    const items = await this.dataStore.getAll<AgeGroup>(STORE_NAMES.AGE_GROUPS);
    return items.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  public async getAgeGroupById(id: number): Promise<AgeGroup | null> {
    return this.dataStore.getByKey<AgeGroup>(STORE_NAMES.AGE_GROUPS, id);
  }

  public async updateAgeGroup(group: AgeGroup): Promise<void> {
    await this.dataStore.putRecord(STORE_NAMES.AGE_GROUPS, group);
  }

  // Referential integrity helpers
  public async getContentTopicLinks(): Promise<ContentTopic[]> {
    return this.dataStore.getAll<ContentTopic>(STORE_NAMES.CONTENT_TOPICS);
  }

  public async countContentTagsByTagId(tagId: number): Promise<number> {
    const links = await this.dataStore.getAllByIndex<ContentTag>(
      STORE_NAMES.CONTENT_TAGS,
      'by_tagId',
      tagId,
    );
    return links.length;
  }

  public async countContentPersonsByPersonId(personId: number): Promise<number> {
    const links = await this.dataStore.getAllByIndex<ContentPerson>(
      STORE_NAMES.CONTENT_PERSONS,
      'by_personId',
      personId,
    );
    return links.length;
  }

  public async countContentItemsByImpactLevelId(impactLevelId: number): Promise<number> {
    const items = await this.dataStore.getAllByIndex<ContentItem>(
      STORE_NAMES.CONTENT_ITEMS,
      'by_impactLevelId',
      impactLevelId,
    );
    return items.length;
  }

  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.CONTENT_ITEMS, item);
    return { ...item, id };
  }

  public async linkContentTopic(contentId: number, topicId: number): Promise<void> {
    await this.dataStore.putRecord<ContentTopic>(STORE_NAMES.CONTENT_TOPICS, {
      contentId,
      topicId,
    });
  }
}
