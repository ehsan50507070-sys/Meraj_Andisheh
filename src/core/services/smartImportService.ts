import type { ILogger } from '../abstractions/ILogger';
import type { ISearchNormalizer } from '../abstractions/searchNormalizer';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import type { AppUser } from '../domain/auth';
import type { PermissionKey } from '../domain/permissions';
import { PermissionPolicyService } from './permissionPolicyService';
import {
  buildSmartImportPrompt,
  parseSmartImportText,
  type SmartImportParseResult,
  type SmartImportPromptTemplates,
  type SmartImportTaxonomyDataset,
} from './smartImportParser';

export const SMART_IMPORT_ROUTE_PATH = '#/admin/content/smart-import';
export const SMART_IMPORT_PERMISSION_KEY: PermissionKey = 'content.manage';

export type SmartImportServiceErrorCode = 'NOT_FOUND' | 'FORBIDDEN';

export interface SmartImportServiceResult<T = void> {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  data?: T;
  errorCode?: SmartImportServiceErrorCode;
  messageKey?: string;
}

export class SmartImportService {
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly policyService: PermissionPolicyService;
  private readonly searchNormalizer: ISearchNormalizer;
  private readonly logger: ILogger;

  constructor(
    taxonomyRepository: ITaxonomyRepository,
    policyService: PermissionPolicyService,
    searchNormalizer: ISearchNormalizer,
    logger: ILogger,
  ) {
    this.taxonomyRepository = taxonomyRepository;
    this.policyService = policyService;
    this.searchNormalizer = searchNormalizer;
    this.logger = logger;
  }

  private async authorizeSmartImport<T>(
    actor: AppUser | null,
  ): Promise<SmartImportServiceResult<T> | null> {
    const auth = await this.policyService.authorizePermission(
      actor,
      SMART_IMPORT_PERMISSION_KEY,
      SMART_IMPORT_ROUTE_PATH,
    );
    if (auth.allowed) {
      return null;
    }
    return {
      ok: false,
      statusCode: auth.statusCode,
      errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
      messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
    };
  }

  private async loadTaxonomyDataset(): Promise<SmartImportTaxonomyDataset> {
    const [topics, tags, persons, impactLevels, ageGroups] = await Promise.all([
      this.taxonomyRepository.getAllTopics(),
      this.taxonomyRepository.getAllTags(),
      this.taxonomyRepository.getAllPersons(),
      this.taxonomyRepository.getAllImpactLevels(),
      this.taxonomyRepository.getAllAgeGroups(),
    ]);

    return {
      topics: [...topics].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
      tags: [...tags],
      persons: [...persons],
      impactLevels: [...impactLevels].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
      ageGroups: [...ageGroups].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    };
  }

  public async getTaxonomyDatasetAsync(
    actor: AppUser | null,
  ): Promise<SmartImportServiceResult<SmartImportTaxonomyDataset>> {
    const denied = await this.authorizeSmartImport<SmartImportTaxonomyDataset>(actor);
    if (denied) return denied;

    const dataset = await this.loadTaxonomyDataset();
    return {
      ok: true,
      statusCode: 200,
      data: dataset,
    };
  }

  public async buildPromptAsync(
    actor: AppUser | null,
    templates: SmartImportPromptTemplates,
    includeSiteLists: boolean,
  ): Promise<SmartImportServiceResult<string>> {
    const denied = await this.authorizeSmartImport<string>(actor);
    if (denied) return denied;

    const dataset = includeSiteLists ? await this.loadTaxonomyDataset() : null;
    const promptText = buildSmartImportPrompt(templates, {
      includeSiteLists,
      topics: dataset?.topics,
      activeAgeGroups: dataset?.ageGroups.filter((g) => g.isActive),
      impactLevels: dataset?.impactLevels,
    });

    return {
      ok: true,
      statusCode: 200,
      data: promptText,
    };
  }

  public async parseInputAsync(
    actor: AppUser | null,
    rawText: string,
  ): Promise<SmartImportServiceResult<SmartImportParseResult>> {
    const denied = await this.authorizeSmartImport<SmartImportParseResult>(actor);
    if (denied) return denied;

    const dataset = await this.loadTaxonomyDataset();
    const parsed = parseSmartImportText(rawText, dataset, this.searchNormalizer);

    this.logger.info('ADMIN_SMART_IMPORT_PARSED', {
      actorId: actor?.id,
      isValid: parsed.isValid,
      recognizedTagsCount: parsed.recognizedTagsCount,
      matchedTopics: parsed.draft.topicIds.length,
      missingTopics: parsed.suggestions.missingTopics.length,
      missingTags: parsed.suggestions.missingTags.length,
      missingPersons: parsed.suggestions.missingPersons.length,
      sourcesCount: parsed.draft.sources.length,
    });

    return {
      ok: true,
      statusCode: 200,
      data: parsed,
    };
  }
}
