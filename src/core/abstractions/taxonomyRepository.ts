import type {
  ContentItem,
  ContentTopic,
} from '../domain/content';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../domain/taxonomy';

export interface ITaxonomyRepository {
  // Topics
  getAllTopics(): Promise<Topic[]>;
  getTopicById(id: number): Promise<Topic | null>;
  createTopic(topic: Omit<Topic, 'id'>): Promise<Topic>;
  updateTopic(topic: Topic): Promise<void>;
  deleteTopic(id: number): Promise<void>;

  // Tags
  getAllTags(): Promise<Tag[]>;
  getTagById(id: number): Promise<Tag | null>;
  createTag(tag: Omit<Tag, 'id'>): Promise<Tag>;
  updateTag(tag: Tag): Promise<void>;
  deleteTag(id: number): Promise<void>;

  // Persons
  getAllPersons(): Promise<Person[]>;
  getPersonById(id: number): Promise<Person | null>;
  createPerson(person: Omit<Person, 'id'>): Promise<Person>;
  updatePerson(person: Person): Promise<void>;
  deletePerson(id: number): Promise<void>;

  // Impact Levels
  getAllImpactLevels(): Promise<ImpactLevel[]>;
  getImpactLevelById(id: number): Promise<ImpactLevel | null>;
  createImpactLevel(level: Omit<ImpactLevel, 'id'>): Promise<ImpactLevel>;
  updateImpactLevel(level: ImpactLevel): Promise<void>;
  deleteImpactLevel(id: number): Promise<void>;

  // Age Groups
  getAllAgeGroups(): Promise<AgeGroup[]>;
  getAgeGroupById(id: number): Promise<AgeGroup | null>;
  updateAgeGroup(group: AgeGroup): Promise<void>;

  // Referential usage counts & links (for safe deletion guards)
  getContentTopicLinks(): Promise<ContentTopic[]>;
  countContentTagsByTagId(tagId: number): Promise<number>;
  countContentPersonsByPersonId(personId: number): Promise<number>;
  countContentItemsByImpactLevelId(impactLevelId: number): Promise<number>;

  // Helpers for content link testing
  createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem>;
  linkContentTopic(contentId: number, topicId: number): Promise<void>;
}
