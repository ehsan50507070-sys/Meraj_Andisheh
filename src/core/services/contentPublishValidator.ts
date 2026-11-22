import {
  CONTENT_FORMATS,
  ContentFileKind,
  FileStorageType,
  type ContentFile,
  type ContentFormat,
  type ContentItem,
  type ContentSource,
} from '../domain/content';

export const CONTENT_TITLE_MAX_LENGTH = 200;
export const CONTENT_SUMMARY_MAX_LENGTH = 600;
export const SOURCE_TITLE_MAX_LENGTH = 300;

export type PublishValidationField =
  | 'title'
  | 'summary'
  | 'topicIds'
  | 'sources'
  | 'format'
  | 'files'
  | 'body'
  | 'thumbnailKey';

export interface PublishValidationError {
  field: PublishValidationField;
  code: string;
  messageKey: string;
}

export interface PublishValidationInput {
  item: Pick<ContentItem, 'title' | 'summary' | 'body' | 'thumbnailKey'> & {
    format: ContentFormat | string | null | undefined;
  };
  topicIds: readonly number[];
  sources: readonly Pick<ContentSource, 'title' | 'url'>[];
  files: readonly Pick<ContentFile, 'kind' | 'storageType' | 'storageKey' | 'externalUrl'>[];
}

export interface PublishValidationResult {
  isValid: boolean;
  errors: PublishValidationError[];
}

function isNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidFormat(format: unknown): format is ContentFormat {
  return typeof format === 'string' && (CONTENT_FORMATS as readonly string[]).includes(format);
}

function hasValidMainFile(
  files: readonly Pick<ContentFile, 'kind' | 'storageType' | 'storageKey' | 'externalUrl'>[],
): boolean {
  return files.some((file) => {
    if (file.kind !== ContentFileKind.Main) {
      return false;
    }
    if (file.storageType === FileStorageType.External) {
      return isNonEmptyText(file.externalUrl);
    }
    return isNonEmptyText(file.storageKey);
  });
}

export function validateForPublish(input: PublishValidationInput): PublishValidationResult {
  const errors: PublishValidationError[] = [];

  const title = input.item.title ?? '';
  const trimmedTitle = title.trim();
  if (trimmedTitle.length === 0) {
    errors.push({
      field: 'title',
      code: 'TITLE_REQUIRED',
      messageKey: 'publish.error.titleRequired',
    });
  } else if (trimmedTitle.length > CONTENT_TITLE_MAX_LENGTH) {
    errors.push({
      field: 'title',
      code: 'TITLE_TOO_LONG',
      messageKey: 'publish.error.titleTooLong',
    });
  }

  const summary = input.item.summary ?? '';
  const trimmedSummary = summary.trim();
  if (trimmedSummary.length === 0) {
    errors.push({
      field: 'summary',
      code: 'SUMMARY_REQUIRED',
      messageKey: 'publish.error.summaryRequired',
    });
  } else if (trimmedSummary.length > CONTENT_SUMMARY_MAX_LENGTH) {
    errors.push({
      field: 'summary',
      code: 'SUMMARY_TOO_LONG',
      messageKey: 'publish.error.summaryTooLong',
    });
  }

  const validTopicIds = input.topicIds.filter(
    (topicId) => typeof topicId === 'number' && Number.isFinite(topicId) && topicId > 0,
  );
  if (validTopicIds.length === 0) {
    errors.push({
      field: 'topicIds',
      code: 'TOPIC_REQUIRED',
      messageKey: 'publish.error.noTopic',
    });
  }

  const validSources = input.sources.filter(
    (source) =>
      isNonEmptyText(source.title) && source.title.trim().length <= SOURCE_TITLE_MAX_LENGTH,
  );
  if (validSources.length === 0) {
    errors.push({
      field: 'sources',
      code: 'SOURCE_REQUIRED',
      messageKey: 'publish.error.noSource',
    });
  }

  const formatValid = isValidFormat(input.item.format);
  if (!formatValid) {
    errors.push({
      field: 'format',
      code: 'FORMAT_INVALID',
      messageKey: 'publish.error.invalidFormat',
    });
  }

  const hasMainFile = hasValidMainFile(input.files);
  if (formatValid) {
    if (input.item.format === 'Article') {
      const hasBody = isNonEmptyText(input.item.body);
      if (!hasBody && !hasMainFile) {
        errors.push({
          field: 'body',
          code: 'ARTICLE_BODY_OR_FILE_REQUIRED',
          messageKey: 'publish.error.articleBodyOrMainFileRequired',
        });
      }
    } else if (!hasMainFile) {
      errors.push({
        field: 'files',
        code: 'MAIN_FILE_REQUIRED',
        messageKey: 'publish.error.mainFileRequired',
      });
    }
  }

  if (!isNonEmptyText(input.item.thumbnailKey)) {
    errors.push({
      field: 'thumbnailKey',
      code: 'THUMBNAIL_REQUIRED',
      messageKey: 'publish.error.noThumbnail',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
