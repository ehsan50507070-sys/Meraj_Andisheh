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
  VIEW_EVENTS: 'viewEvents',
  DOWNLOAD_EVENTS: 'downloadEvents',
  LIKES: 'likes',
  BOOKMARKS: 'bookmarks',
  COMMENTS: 'comments',
  COMMENT_REPORTS: 'commentReports',
  BLOCKED_WORDS: 'blockedWords',
  CONTENT_REQUESTS: 'contentRequests',
  HERO_SLIDES: 'heroSlides',
  HOME_SHELVES: 'homeShelves',
  STATIC_PAGES: 'staticPages',
  USER_TOPIC_AFFINITIES: 'userTopicAffinities',
  BACKUP_LOGS: 'backupLogs',
  BACKUP_ARCHIVES: 'backupArchives',
  FILM_INFOS: 'filmInfos',
  BOOK_INFOS: 'bookInfos',
  ANNOUNCEMENTS: 'announcements',
  DAILY_STATS: 'dailyStats',
  S3_BUCKET_OBJECTS: 's3BucketObjects',
  GAMES: 'games',
  GAME_AGE_GROUPS: 'gameAgeGroups',
  GAME_SCORES: 'gameScores',
  GAME_PACKAGES: 'gamePackages',
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

export const STAGE13_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.VIEW_EVENTS,
] as const;

export const STAGE14_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.DOWNLOAD_EVENTS,
] as const;

export const STAGE15_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.LIKES,
  STORE_NAMES.BOOKMARKS,
] as const;

export const STAGE16_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.COMMENTS,
  STORE_NAMES.COMMENT_REPORTS,
  STORE_NAMES.BLOCKED_WORDS,
] as const;

export const STAGE17_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.CONTENT_REQUESTS,
] as const;

export const STAGE18_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.HERO_SLIDES,
  STORE_NAMES.HOME_SHELVES,
  STORE_NAMES.STATIC_PAGES,
] as const;

export const STAGE20_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.USER_TOPIC_AFFINITIES,
] as const;

export const STAGE21_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.BACKUP_LOGS,
  STORE_NAMES.BACKUP_ARCHIVES,
] as const;

export const STAGE23_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.FILM_INFOS,
] as const;

export const STAGE24_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.BOOK_INFOS,
] as const;

export const STAGE26_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.ANNOUNCEMENTS,
] as const;

export const STAGE27_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.DAILY_STATS,
] as const;

export const STAGE28_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.S3_BUCKET_OBJECTS,
] as const;

export const STAGE29_OBJECT_STORES: readonly string[] = [
  STORE_NAMES.GAMES,
  STORE_NAMES.GAME_AGE_GROUPS,
  STORE_NAMES.GAME_SCORES,
  STORE_NAMES.GAME_PACKAGES,
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
  up: (db: IDBDatabase, transaction: IDBTransaction | null, oldVersion: number) => void;
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

const STAGE13_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.VIEW_EVENTS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_contentId', keyPath: 'contentId' },
      { name: 'by_visitorId', keyPath: 'visitorId' },
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_occurredAt', keyPath: 'occurredAt' },
      { name: 'by_isCounted', keyPath: 'isCounted' },
    ],
  },
];

const STAGE14_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.DOWNLOAD_EVENTS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_contentId', keyPath: 'contentId' },
      { name: 'by_fileId', keyPath: 'fileId' },
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_kind', keyPath: 'kind' },
      { name: 'by_occurredAt', keyPath: 'occurredAt' },
    ],
  },
];

const STAGE15_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.LIKES,
    keyPath: ['userId', 'contentId'],
    indexes: [
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_contentId', keyPath: 'contentId' },
      { name: 'by_createdAt', keyPath: 'createdAt' },
    ],
  },
  {
    name: STORE_NAMES.BOOKMARKS,
    keyPath: ['userId', 'contentId'],
    indexes: [
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_contentId', keyPath: 'contentId' },
      { name: 'by_createdAt', keyPath: 'createdAt' },
    ],
  },
];

const STAGE16_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.COMMENTS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_contentId', keyPath: 'contentId' },
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_status', keyPath: 'status' },
      { name: 'by_createdAt', keyPath: 'createdAt' },
    ],
  },
  {
    name: STORE_NAMES.COMMENT_REPORTS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_commentId', keyPath: 'commentId' },
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_comment_user', keyPath: ['commentId', 'userId'], unique: true },
    ],
  },
  {
    name: STORE_NAMES.BLOCKED_WORDS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [{ name: 'by_word', keyPath: 'word', unique: true }],
  },
];

const STAGE17_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.CONTENT_REQUESTS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_status', keyPath: 'status' },
      { name: 'by_createdAt', keyPath: 'createdAt' },
      { name: 'by_linkedContentId', keyPath: 'linkedContentId' },
    ],
  },
];

const STAGE18_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.HERO_SLIDES,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_sortOrder', keyPath: 'sortOrder' },
      { name: 'by_isActive', keyPath: 'isActive' },
      { name: 'by_ageGroupId', keyPath: 'ageGroupId' },
    ],
  },
  {
    name: STORE_NAMES.HOME_SHELVES,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_sortOrder', keyPath: 'sortOrder' },
      { name: 'by_isVisible', keyPath: 'isVisible' },
      { name: 'by_type', keyPath: 'type' },
    ],
  },
  {
    name: STORE_NAMES.STATIC_PAGES,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_slug', keyPath: 'slug', unique: true },
      { name: 'by_showInFooter', keyPath: 'showInFooter' },
      { name: 'by_sortOrder', keyPath: 'sortOrder' },
    ],
  },
];

const STAGE20_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.USER_TOPIC_AFFINITIES,
    keyPath: ['userId', 'rootTopicId'],
    indexes: [
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_rootTopicId', keyPath: 'rootTopicId' },
      { name: 'by_viewCount', keyPath: 'viewCount' },
      { name: 'by_lastViewedAt', keyPath: 'lastViewedAt' },
    ],
  },
];

const STAGE21_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.BACKUP_LOGS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_startedAt', keyPath: 'startedAt' },
      { name: 'by_kind', keyPath: 'kind' },
      { name: 'by_status', keyPath: 'status' },
      { name: 'by_filePath', keyPath: 'filePath' },
    ],
  },
  {
    name: STORE_NAMES.BACKUP_ARCHIVES,
    keyPath: 'filePath',
    indexes: [{ name: 'by_createdAt', keyPath: 'createdAt' }],
  },
];

const STAGE23_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.FILM_INFOS,
    keyPath: 'contentId',
    indexes: [
      { name: 'by_kind', keyPath: 'kind' },
      { name: 'by_isWeeklyPick', keyPath: 'isWeeklyPick' },
      { name: 'by_releaseYear', keyPath: 'releaseYear' },
    ],
  },
];

const STAGE24_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.BOOK_INFOS,
    keyPath: 'contentId',
    indexes: [
      { name: 'by_author', keyPath: 'author' },
      { name: 'by_publisher', keyPath: 'publisher' },
      { name: 'by_publishYear', keyPath: 'publishYear' },
    ],
  },
];

const STAGE26_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.ANNOUNCEMENTS,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_isActive', keyPath: 'isActive' },
      { name: 'by_priority', keyPath: 'priority' },
      { name: 'by_startsAt', keyPath: 'startsAt' },
      { name: 'by_endsAt', keyPath: 'endsAt' },
    ],
  },
];

const STAGE27_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.DAILY_STATS,
    keyPath: ['date', 'ageGroupId', 'rootTopicId'],
    indexes: [
      { name: 'date', keyPath: 'date' },
      { name: 'ageGroupId', keyPath: 'ageGroupId' },
      { name: 'rootTopicId', keyPath: 'rootTopicId' },
    ],
  },
];

const STAGE28_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.S3_BUCKET_OBJECTS,
    keyPath: 'storageKey',
    indexes: [
      { name: 'by_bucketName', keyPath: 'bucketName' },
      { name: 'by_visibility', keyPath: 'visibility' },
      { name: 'by_category', keyPath: 'category' },
      { name: 'by_migratedAt', keyPath: 'migratedAt' },
    ],
  },
];

const STAGE29_STORE_SPECS: readonly StoreSpec[] = [
  {
    name: STORE_NAMES.GAMES,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_slug', keyPath: 'slug', unique: true },
      { name: 'by_topicId', keyPath: 'topicId' },
      { name: 'by_isPublished', keyPath: 'isPublished' },
    ],
  },
  {
    name: STORE_NAMES.GAME_AGE_GROUPS,
    keyPath: ['gameId', 'ageGroupId'],
    indexes: [
      { name: 'by_gameId', keyPath: 'gameId' },
      { name: 'by_ageGroupId', keyPath: 'ageGroupId' },
    ],
  },
  {
    name: STORE_NAMES.GAME_SCORES,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'by_gameId', keyPath: 'gameId' },
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_score', keyPath: 'score' },
      { name: 'by_createdAt', keyPath: 'createdAt' },
    ],
  },
  {
    name: STORE_NAMES.GAME_PACKAGES,
    keyPath: 'packageFolder',
    indexes: [{ name: 'by_createdAt', keyPath: 'createdAt' }],
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
  {
    version: 7,
    up: (db, transaction) => {
      for (const spec of STAGE13_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
    },
  },
  {
    version: 8,
    up: (db, transaction) => {
      for (const spec of STAGE14_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
    },
  },
  {
    version: 9,
    up: (db, transaction) => {
      for (const spec of STAGE15_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
    },
  },
  {
    version: 10,
    up: (db, transaction, oldVersion) => {
      for (const spec of STAGE16_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
      if (
        oldVersion > 0 &&
        transaction &&
        db.objectStoreNames.contains(STORE_NAMES.FEATURE_FLAGS)
      ) {
        transaction
          .objectStore(STORE_NAMES.FEATURE_FLAGS)
          .put({ key: 'Comments', isEnabled: true });
      }
      if (oldVersion > 0 && transaction && db.objectStoreNames.contains(STORE_NAMES.META)) {
        transaction.objectStore(STORE_NAMES.META).put({
          key: 'stage16_comments_default_enabled_v1',
          value: '1',
          updatedAtUtc: new Date().toISOString(),
        });
      }
    },
  },
  {
    version: 11,
    up: (db, transaction, oldVersion) => {
      for (const spec of STAGE17_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
      if (
        oldVersion > 0 &&
        transaction &&
        db.objectStoreNames.contains(STORE_NAMES.FEATURE_FLAGS)
      ) {
        transaction
          .objectStore(STORE_NAMES.FEATURE_FLAGS)
          .put({ key: 'ContentRequests', isEnabled: true });
      }
      if (oldVersion > 0 && transaction && db.objectStoreNames.contains(STORE_NAMES.META)) {
        transaction.objectStore(STORE_NAMES.META).put({
          key: 'stage17_content_requests_default_enabled_v1',
          value: '1',
          updatedAtUtc: new Date().toISOString(),
        });
      }
    },
  },
  {
    version: 12,
    up: (db, transaction) => {
      for (const spec of STAGE18_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
    },
  },
  {
    version: 13,
    up: (db, transaction) => {
      for (const spec of STAGE20_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
    },
  },
  {
    version: 14,
    up: (db, transaction) => {
      for (const spec of STAGE21_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
    },
  },
  {
    version: 15,
    up: (db, transaction, oldVersion) => {
      for (const spec of STAGE23_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
      if (
        oldVersion > 0 &&
        transaction &&
        db.objectStoreNames.contains(STORE_NAMES.FEATURE_FLAGS)
      ) {
        transaction
          .objectStore(STORE_NAMES.FEATURE_FLAGS)
          .put({ key: 'Films', isEnabled: true });
      }
      if (oldVersion > 0 && transaction && db.objectStoreNames.contains(STORE_NAMES.META)) {
        transaction.objectStore(STORE_NAMES.META).put({
          key: 'stage23_films_default_enabled_v1',
          value: '1',
          updatedAtUtc: new Date().toISOString(),
        });
      }
    },
  },
  {
    version: 16,
    up: (db, transaction, oldVersion) => {
      for (const spec of STAGE24_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
      if (
        oldVersion > 0 &&
        transaction &&
        db.objectStoreNames.contains(STORE_NAMES.FEATURE_FLAGS)
      ) {
        transaction
          .objectStore(STORE_NAMES.FEATURE_FLAGS)
          .put({ key: 'Books', isEnabled: true });
      }
      if (oldVersion > 0 && transaction && db.objectStoreNames.contains(STORE_NAMES.META)) {
        transaction.objectStore(STORE_NAMES.META).put({
          key: 'stage24_books_default_enabled_v1',
          value: '1',
          updatedAtUtc: new Date().toISOString(),
        });
      }
    },
  },
  {
    version: 17,
    up: (db, transaction, oldVersion) => {
      if (
        oldVersion > 0 &&
        transaction &&
        db.objectStoreNames.contains(STORE_NAMES.FEATURE_FLAGS)
      ) {
        transaction
          .objectStore(STORE_NAMES.FEATURE_FLAGS)
          .put({ key: 'StoryGenerator', isEnabled: true });
      }
      if (oldVersion > 0 && transaction && db.objectStoreNames.contains(STORE_NAMES.META)) {
        transaction.objectStore(STORE_NAMES.META).put({
          key: 'stage25_story_generator_default_enabled_v1',
          value: '1',
          updatedAtUtc: new Date().toISOString(),
        });
      }
    },
  },
  {
    version: 18,
    up: (db, transaction, oldVersion) => {
      for (const spec of STAGE26_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
      if (
        oldVersion > 0 &&
        transaction &&
        db.objectStoreNames.contains(STORE_NAMES.FEATURE_FLAGS)
      ) {
        transaction
          .objectStore(STORE_NAMES.FEATURE_FLAGS)
          .put({ key: 'NewsTicker', isEnabled: true });
      }
      if (oldVersion > 0 && transaction && db.objectStoreNames.contains(STORE_NAMES.META)) {
        transaction.objectStore(STORE_NAMES.META).put({
          key: 'stage26_news_ticker_default_enabled_v1',
          value: '1',
          updatedAtUtc: new Date().toISOString(),
        });
      }
    },
  },
  {
    version: 19,
    up: (db, transaction) => {
      for (const spec of STAGE27_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
    },
  },
  {
    version: 20,
    up: (db, transaction) => {
      for (const spec of STAGE28_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
    },
  },
  {
    version: 21,
    up: (db, transaction, oldVersion) => {
      for (const spec of STAGE29_STORE_SPECS) {
        ensureStore(db, transaction, spec);
      }
      if (
        oldVersion > 0 &&
        transaction &&
        db.objectStoreNames.contains(STORE_NAMES.FEATURE_FLAGS)
      ) {
        transaction
          .objectStore(STORE_NAMES.FEATURE_FLAGS)
          .put({ key: 'Games', isEnabled: true });
      }
      if (oldVersion > 0 && transaction && db.objectStoreNames.contains(STORE_NAMES.META)) {
        transaction.objectStore(STORE_NAMES.META).put({
          key: 'stage29_games_default_enabled_v1',
          value: '1',
          updatedAtUtc: new Date().toISOString(),
        });
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
      migration.up(db, transaction, oldVersion);
    }
  }
}
