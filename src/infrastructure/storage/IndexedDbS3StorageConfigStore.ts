import type { IS3StorageConfigStore } from '../../core/abstractions/s3Storage';
import {
  DEFAULT_S3_STORAGE_CONFIG,
  type S3StorageConfig,
} from '../../core/domain/storage';
import type { IndexedDbDataStore } from '../data/IndexedDbDataStore';

export const S3_STORAGE_CONFIG_META_KEY = 'stage28_s3_storage_config_v1';

export class IndexedDbS3StorageConfigStore implements IS3StorageConfigStore {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async getConfigAsync(): Promise<S3StorageConfig> {
    const meta = await this.dataStore.getMeta(S3_STORAGE_CONFIG_META_KEY);
    if (!meta || !meta.value) {
      return { ...DEFAULT_S3_STORAGE_CONFIG };
    }
    try {
      const parsed = JSON.parse(meta.value) as Partial<S3StorageConfig>;
      return {
        provider: parsed.provider === 's3' ? 's3' : 'local',
        endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
        bucketName: typeof parsed.bucketName === 'string' ? parsed.bucketName : '',
        region:
          typeof parsed.region === 'string' && parsed.region.trim()
            ? parsed.region
            : DEFAULT_S3_STORAGE_CONFIG.region,
        accessKeyId:
          typeof parsed.accessKeyId === 'string' ? parsed.accessKeyId : '',
        secretAccessKey:
          typeof parsed.secretAccessKey === 'string' ? parsed.secretAccessKey : '',
        forcePathStyle:
          typeof parsed.forcePathStyle === 'boolean' ? parsed.forcePathStyle : true,
        publicBaseUrl:
          typeof parsed.publicBaseUrl === 'string' ? parsed.publicBaseUrl : '',
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      };
    } catch {
      return { ...DEFAULT_S3_STORAGE_CONFIG };
    }
  }

  public async saveConfigAsync(
    config: S3StorageConfig,
  ): Promise<S3StorageConfig> {
    const sanitized: S3StorageConfig = {
      provider: config.provider === 's3' ? 's3' : 'local',
      endpoint: (config.endpoint ?? '').trim(),
      bucketName: (config.bucketName ?? '').trim(),
      region:
        (config.region ?? '').trim() || DEFAULT_S3_STORAGE_CONFIG.region,
      accessKeyId: (config.accessKeyId ?? '').trim(),
      secretAccessKey: (config.secretAccessKey ?? '').trim(),
      forcePathStyle: Boolean(config.forcePathStyle),
      publicBaseUrl: (config.publicBaseUrl ?? '').trim(),
      updatedAt: config.updatedAt ?? new Date().toISOString(),
    };

    await this.dataStore.setMeta({
      key: S3_STORAGE_CONFIG_META_KEY,
      value: JSON.stringify(sanitized),
      updatedAtUtc: sanitized.updatedAt ?? new Date().toISOString(),
    });

    return sanitized;
  }
}
