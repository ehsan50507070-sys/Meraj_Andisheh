import type { AgeGroup } from '../domain/taxonomy';

export interface AgeFilterableItem<T> {
  item: T;
  ageGroupIds: readonly number[];
  publishedAt: string | null;
  createdAt?: string;
  id?: number;
}

export type AgePriorityGroup = 1 | 2 | 3;

export interface AgePrioritizedEntry<T> {
  item: T;
  ageGroupIds: readonly number[];
  priorityGroup: AgePriorityGroup;
  isExplicitTarget: boolean;
  isUniversal: boolean;
}

function parseTimestampMs(iso: string | null | undefined): number {
  if (!iso) {
    return 0;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function compareNewestFirst<T>(a: AgeFilterableItem<T>, b: AgeFilterableItem<T>): number {
  const pubDiff = parseTimestampMs(b.publishedAt) - parseTimestampMs(a.publishedAt);
  if (pubDiff !== 0) {
    return pubDiff;
  }

  const createdDiff = parseTimestampMs(b.createdAt) - parseTimestampMs(a.createdAt);
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return (b.id ?? 0) - (a.id ?? 0);
}

/**
 * Hard filter for 'child' age group (Section 3.2):
 * Allowed iff content has no specific ageGroupIds ([] = all ages)
 * OR explicitly includes the child ageGroup id.
 * Other age groups never hide content.
 */
export function isContentAllowedForAgeGroup(
  contentAgeGroupIds: readonly number[],
  activeAgeGroup: AgeGroup | null,
): boolean {
  if (!activeAgeGroup || activeAgeGroup.key !== 'child') {
    return true;
  }

  return (
    contentAgeGroupIds.length === 0 || contentAgeGroupIds.includes(activeAgeGroup.id)
  );
}

/**
 * Full Section 3.2 filtering & prioritization returning items along with
 * their computed priority group (1 = explicit target, 2 = all ages [], 3 = others).
 */
export function applyAgeGroupRulesWithMeta<T>(
  entries: readonly AgeFilterableItem<T>[],
  activeAgeGroup: AgeGroup | null,
): AgePrioritizedEntry<T>[] {
  if (!activeAgeGroup) {
    return [...entries]
      .sort(compareNewestFirst)
      .map((entry) => ({
        item: entry.item,
        ageGroupIds: [...entry.ageGroupIds],
        priorityGroup: entry.ageGroupIds.length === 0 ? 2 : 3,
        isExplicitTarget: false,
        isUniversal: entry.ageGroupIds.length === 0,
      }));
  }

  // Hard filter for 'child'
  if (activeAgeGroup.key === 'child') {
    const allowed = entries.filter((entry) =>
      isContentAllowedForAgeGroup(entry.ageGroupIds, activeAgeGroup),
    );

    const group1: AgeFilterableItem<T>[] = [];
    const group2: AgeFilterableItem<T>[] = [];

    for (const entry of allowed) {
      if (entry.ageGroupIds.includes(activeAgeGroup.id)) {
        group1.push(entry);
      } else {
        group2.push(entry);
      }
    }

    group1.sort(compareNewestFirst);
    group2.sort(compareNewestFirst);

    return [
      ...group1.map((entry) => ({
        item: entry.item,
        ageGroupIds: [...entry.ageGroupIds],
        priorityGroup: 1 as const,
        isExplicitTarget: true,
        isUniversal: false,
      })),
      ...group2.map((entry) => ({
        item: entry.item,
        ageGroupIds: [...entry.ageGroupIds],
        priorityGroup: 2 as const,
        isExplicitTarget: false,
        isUniversal: true,
      })),
    ];
  }

  // Soft 3-tier prioritization for teen / youth / adult
  const group1Explicit: AgeFilterableItem<T>[] = [];
  const group2Universal: AgeFilterableItem<T>[] = [];
  const group3Other: AgeFilterableItem<T>[] = [];

  for (const entry of entries) {
    if (entry.ageGroupIds.includes(activeAgeGroup.id)) {
      group1Explicit.push(entry);
    } else if (entry.ageGroupIds.length === 0) {
      group2Universal.push(entry);
    } else {
      group3Other.push(entry);
    }
  }

  group1Explicit.sort(compareNewestFirst);
  group2Universal.sort(compareNewestFirst);
  group3Other.sort(compareNewestFirst);

  return [
    ...group1Explicit.map((entry) => ({
      item: entry.item,
      ageGroupIds: [...entry.ageGroupIds],
      priorityGroup: 1 as const,
      isExplicitTarget: true,
      isUniversal: false,
    })),
    ...group2Universal.map((entry) => ({
      item: entry.item,
      ageGroupIds: [...entry.ageGroupIds],
      priorityGroup: 2 as const,
      isExplicitTarget: false,
      isUniversal: true,
    })),
    ...group3Other.map((entry) => ({
      item: entry.item,
      ageGroupIds: [...entry.ageGroupIds],
      priorityGroup: 3 as const,
      isExplicitTarget: false,
      isUniversal: false,
    })),
  ];
}

export function applyAgeGroupRules<T>(
  entries: readonly AgeFilterableItem<T>[],
  activeAgeGroup: AgeGroup | null,
): T[] {
  return applyAgeGroupRulesWithMeta(entries, activeAgeGroup).map((res) => res.item);
}
