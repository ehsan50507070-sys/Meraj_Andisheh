export const STORE_NAMES = {
  META: '_meta',
  AGE_GROUPS: 'ageGroups',
  TOPICS: 'topics',
  TAGS: 'tags',
  PERSONS: 'persons',
  IMPACT_LEVELS: 'impactLevels',
  CONTENT_ITEMS: 'contentItems',
  CONTENT_SOURCES: 'contentSources',
  CONTENT_FILES: 'contentFiles',
  CONTENT_TOPICS: 'contentTopics',
  CONTENT_TAGS: 'contentTags',
  CONTENT_PERSONS: 'contentPersons',
  CONTENT_AGE_GROUPS: 'contentAgeGroups',
  SITE_SETTINGS: 'siteSettings',
  FEATURE_FLAGS: 'featureFlags',
  USERS: 'users',
  AUTH_TOKENS: 'authTokens',
  SESSIONS: 'sessions',
  OTP_CODES: 'otpCodes',
  STAFF_PERMISSIONS: 'staffPermissions',
  STORED_FILES: 'storedFiles',
} as const;

export const STAGE3_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.AGE_GROUPS,
  STORE_NAMES.TOPICS,
  STORE_NAMES.TAGS,
  STORE_NAMES.PERSONS,
  STORE_NAMES.IMPACT_LEVELS,
  STORE_NAMES.CONTENT_ITEMS,
  STORE_NAMES.CONTENT_SOURCES,
  STORE_NAMES.CONTENT_FILES,
  STORE_NAMES.CONTENT_TOPICS,
  STORE_NAMES.CONTENT_TAGS,
  STORE_NAMES.CONTENT_PERSONS,
  STORE_NAMES.CONTENT_AGE_GROUPS,
  STORE_NAMES.SITE_SETTINGS,
  STORE_NAMES.FEATURE_FLAGS,
] as const;

export const STAGE4_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.USERS,
  STORE_NAMES.AUTH_TOKENS,
  STORE_NAMES.SESSIONS,
] as const;

export const STAGE5_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.OTP_CODES,
] as const;

export const STAGE6_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.STAFF_PERMISSIONS,
] as const;

export const STAGE7_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.STORED_FILES,
] as const;

interface IndexSpec {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
}

interface StoreSpec {
  name: string;
  keyPath: string | string[];
  autoIncrement?: boolean;
  indexes?: readonly IndexSpec[];
}

interface MigrationStep {
  version: number;
  up: (db: IDBDatabase, transaction: IDBTransaction | null) => void;
}

function ensureStore(
  db: IDBDatabase,
  transaction: IDBTransaction | null,
  spec: StoreSpec,
): void {
  const store = db.objectStoreNames.contains(spec.name)
    ? transaction?.objectStore(spec.name)
    : db.createObjectStore(spec.name, {
        keyPath: spec.keyPath,
        autoIncrement: Boolean(spec.autoIncrement),
      });

  if (!store || !spec.indexes) {
    return;
  }

  for (const idx of spec.indexes) {
    if (!store.indexNames.contains(idx.name)) {
      store.createIndex(idx.name, idx.keyPath, { unique: Boolean(idx.unique) });
    }
  }
}

const STAGE3_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.AGE_GROUPS,
    keyPath: 'id',
    indexes: [
      { name: 'by_key', keyPath: 'key', unique: true },
      { name: 'by_sortOrder', keyPath: 'sortOrder' },
    ],
  },
  {
    name: STORE_NAMES.TOPICS,
    keyPath: 'id',
    indexes: [
      { name: 'by_slug', keyPath: 'slug', unique: true },
      { name: 'by_parentId', keyPath: 'parentId' },
      { name: 'by_sortOrder', keyPath: 'sortOrder' },
    ],
  },
  {
    name: STORE_NAMES.TAGS,
    keyPath: 'id',
    indexes: [{ name: 'by_slug', keyPath: 'slug', unique: true }],
  },
  {
    name: STORE_NAMES.PERSONS,
    keyPath: 'id',
    indexes: [{ name: 'by_slug', keyPath: 'slug', unique: true }],
  },
  {
    name: STORE_NAMES.IMPACT_LEVELS,
    keyPath: 'id',
    indexes: [{ name: 'by_sortOrder', keyPath: 'sortOrder' }],
  },
  {
    name: STORE_NAMES.CONTENT_ITEMS,
    keyPath: 'id',
    indexes: [
      { name: 'by_slug', keyPath: 'slug', unique: true },
      { name: 'by_status', keyPath: 'status' },
      { name: 'by_format', keyPath: 'format' },
      { name: 'by_publishedAt', keyPath: 'publishedAt' },
      { name: 'by_impactLevelId', keyPath: 'impactLevelId' },
    ],
  },
  {
    name: STORE_NAMES.CONTENT_SOURCES,
    keyPath: 'id',
    indexes: [{ name: 'by_contentId', keyPath: 'contentId' }],
  },
  {
    name: STORE_NAMES.CONTENT_FILES,
    keyPath: 'id',
    indexes: [
      { name: 'by_contentId', keyPath: 'contentId' },
      { name: 'by_kind', keyPath: 'kind' },
    ],
  },
  {
    name: STORE_NAMES.CONTENT_TOPICS,
    keyPath: ['contentId', 'topicId'],
    indexes: [
      { name: 'by_contentId', keyPath: 'contentId' },
      { name: 'by_topicId', keyPath: 'topicId' },
    ],
  },
  {
    name: STORE_NAMES.CONTENT_TAGS,
    keyPath: ['contentId', 'tagId'],
    indexes: [
      { name: 'by_contentId', keyPath: 'contentId' },
      { name: 'by_tagId', keyPath: 'tagId' },
    ],
  },
  {
    name: STORE_NAMES.CONTENT_PERSONS,
    keyPath: ['contentId', 'personId'],
    indexes: [
      { name: 'by_contentId', keyPath: 'contentId' },
      { name: 'by_personId', keyPath: 'personId' },
    ],
  },
  {
    name: STORE_NAMES.CONTENT_AGE_GROUPS,
    keyPath: ['contentId', 'ageGroupId'],
    indexes: [
      { name: 'by_contentId', keyPath: 'contentId' },
      { name: 'by_ageGroupId', keyPath: 'ageGroupId' },
    ],
  },
  {
    name: STORE_NAMES.SITE_SETTINGS,
    keyPath: 'key',
  },
  {
    name: STORE_NAMES.FEATURE_FLAGS,
    keyPath: 'key',
  },
];

const STAGE4_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.USERS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_normalizedEmail', keyPath: 'normalizedEmail', unique: true },
      { name: 'by_role', keyPath: 'role' },
    ],
  },
  {
    name: STORE_NAMES.AUTH_TOKENS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_tokenHash', keyPath: 'tokenHash', unique: true },
    ],
  },
  {
    name: STORE_NAMES.SESSIONS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_tokenHash', keyPath: 'tokenHash', unique: true },
      { name: 'by_userId', keyPath: 'userId' },
    ],
  },
  {
    name: STORE_NAMES.CONTENT_ITEMS,
    keyPath: 'id',
    indexes: [{ name: 'by_createdById', keyPath: 'createdById' }],
  },
];

const STAGE5_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.OTP_CODES,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_phoneNumber', keyPath: 'phoneNumber' },
      { name: 'by_createdAt', keyPath: 'createdAt' },
    ],
  },
  {
    name: STORE_NAMES.USERS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_normalizedPhoneNumber', keyPath: 'normalizedPhoneNumber', unique: true },
    ],
  },
];

const STAGE6_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.STAFF_PERMISSIONS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_user_permission', keyPath: ['userId', 'permissionKey'], unique: true },
    ],
  },
];

const STAGE7_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.STORED_FILES,
    keyPath: 'storageKey',
    indexes: [
      { name: 'by_visibility', keyPath: 'visibility' },
      { name: 'by_category', keyPath: 'category' },
      { name: 'by_createdAt', keyPath: 'createdAt' },
    ],
  },
];

export const DATABASE_MIGRATIONS: readonly MigrationStep[] = [
  {
    version: 1,
    up: (db, transaction) => {
      ensureStore(db, transaction, {
        name: STORE_NAMES.META,
        keyPath: 'key',
      });
    },
  },
  {
    version: 2,
    up: (db, transaction) => {
      for (const spec of STAGE3_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
    },
  },
  {
    version: 3,
    up: (db, transaction) => {
      for (const spec of STAGE4_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
    },
  },
  {
    version: 4,
    up: (db, transaction) => {
      for (const spec of STAGE5_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
    },
  },
  {
    version: 5,
    up: (db, transaction) => {
      for (const spec of STAGE6_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
    },
  },
  {
    version: 6,
    up: (db, transaction) => {
      for (const spec of STAGE7_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
    },
  },
];

export function applyMigrations(
  db: IDBDatabase,
  oldVersion: number,
  newVersion: number,
  transaction: IDBTransaction | null,
): void {
  for (const migration of DATABASE_MIGRATIONS) {
    if (migration.version > oldVersion && migration.version <= newVersion) {
      migration.up(db, transaction);
    }
  }
}
