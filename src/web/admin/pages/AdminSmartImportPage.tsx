import {
  ArrowRight,
  CheckCircle2,
  Copy,
  FileCheck2,
  PlusCircle,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ContentFormat } from '../../../core/domain/content';
import { isSafeAnchorHref } from '../../../core/services/htmlSanitizer';
import type {
  MissingNameSuggestion,
  MissingTopicSuggestion,
  SmartImportParseResult,
  SmartImportPromptTemplates,
} from '../../../core/services/smartImportParser';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Button, SanitizedHtmlPreview, Tag } from '../../components/ui';
import { formatAgeGroupWithRange } from '../../resources/ageGroupFormatters';
import type { ResourceKey } from '../../resources/fa';
import { toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';
import { navigateToHash } from '../../router/HashRouter';
import { appContainer } from '../../services/appContainer';
import { smartImportDraftBridge } from '../../services/smartImportDraftBridge';
import { AdminLayout } from '../AdminLayout';
import { canSeeAdminNavItem } from '../adminNavConfig';

interface AdminSmartImportPageProps {
  currentRoute: string;
}

function getFormatResourceKey(format: ContentFormat): ResourceKey {
  switch (format) {
    case 'Video':
      return 'content.format.Video';
    case 'Audio':
      return 'content.format.Audio';
    case 'Article':
      return 'content.format.Article';
    case 'Image':
      return 'content.format.Image';
    case 'Pdf':
      return 'content.format.Pdf';
    case 'Presentation':
      return 'content.format.Presentation';
    case 'Book':
      return 'content.format.Book';
    case 'Film':
    default:
      return 'content.format.Film';
  }
}

export function AdminSmartImportPage({ currentRoute }: AdminSmartImportPageProps) {
  const { currentUser, userPermissions } = useAuth();
  const canManageTaxonomy = canSeeAdminNavItem(
    currentUser,
    userPermissions,
    'taxonomy.manage',
  );

  // Section 1: Prompt state
  const [includeSiteLists, setIncludeSiteLists] = useState<boolean>(true);
  const [promptText, setPromptText] = useState<string>('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Section 2: Input & Analyzer state
  const [rawInput, setRawInput] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  // Section 3: Results & Manual Suggestion creation state
  const [parseResult, setParseResult] = useState<SmartImportParseResult | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    variant: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);
  const [creatingKey, setCreatingKey] = useState<string | null>(null);

  const promptTemplates: SmartImportPromptTemplates = useMemo(
    () => ({
      header: t('admin.smartImport.prompt.header'),
      templateBlock: t('admin.smartImport.prompt.templateBlock'),
      rulesBlock: t('admin.smartImport.prompt.rulesBlock'),
      siteListsHeading: t('admin.smartImport.prompt.siteListsHeading'),
      siteTopicsLabel: t('admin.smartImport.prompt.siteTopicsLabel'),
      siteAgeGroupsLabel: t('admin.smartImport.prompt.siteAgeGroupsLabel'),
      siteImpactLevelsLabel: t('admin.smartImport.prompt.siteImpactLevelsLabel'),
      siteEmptyFallback: t('admin.smartImport.prompt.siteEmptyFallback'),
    }),
    [],
  );

  const loadPrompt = useCallback(async () => {
    const res = await appContainer.smartImportService.buildPromptAsync(
      currentUser,
      promptTemplates,
      includeSiteLists,
    );
    if (res.ok && typeof res.data === 'string') {
      setPromptText(res.data);
    }
  }, [currentUser, includeSiteLists, promptTemplates]);

  useEffect(() => {
    void loadPrompt();
  }, [loadPrompt]);

  const handleCopyPrompt = async () => {
    if (!promptText) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(promptText);
        setCopyStatus('copied');
        return;
      }
      throw new Error('Clipboard API unavailable');
    } catch {
      const el = promptTextareaRef.current;
      if (el) {
        el.focus();
        el.select();
        try {
          const ok = document.execCommand('copy');
          setCopyStatus(ok ? 'copied' : 'failed');
          return;
        } catch {
          setCopyStatus('failed');
          return;
        }
      }
      setCopyStatus('failed');
    }
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setActionFeedback(null);
    try {
      const res = await appContainer.smartImportService.parseInputAsync(currentUser, rawInput);
      if (res.ok && res.data) {
        setParseResult(res.data);
      } else {
        setParseResult(null);
        setActionFeedback({
          variant: 'error',
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.content.error.notFound'),
        });
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleInsertSample = () => {
    setRawInput(t('admin.smartImport.sampleText'));
    setActionFeedback(null);
  };

  const handleClear = () => {
    setRawInput('');
    setParseResult(null);
    setActionFeedback(null);
  };

  const handleCreateMissingTopic = async (item: MissingTopicSuggestion) => {
    if (!canManageTaxonomy) return;
    const key = `topic:${item.rawText}`;
    setCreatingKey(key);
    setActionFeedback(null);
    try {
      let resolvedParentId = item.existingParentTopicId;
      if (item.parentName && resolvedParentId === null) {
        const parentRes = await appContainer.taxonomyService.createTopicAsync(currentUser, {
          parentId: null,
          name: item.parentName,
          icon: null,
          sortOrder: 0,
          isActive: true,
        });
        if (!parentRes.ok || !parentRes.data) {
          setActionFeedback({
            variant: 'error',
            message: parentRes.messageKey
              ? t(parentRes.messageKey as ResourceKey)
              : t('admin.content.error.notFound'),
          });
          return;
        }
        resolvedParentId = parentRes.data.id;
      }

      const topicRes = await appContainer.taxonomyService.createTopicAsync(currentUser, {
        parentId: resolvedParentId,
        name: item.name,
        icon: null,
        sortOrder: 0,
        isActive: true,
      });
      if (!topicRes.ok || !topicRes.data) {
        setActionFeedback({
          variant: 'error',
          message: topicRes.messageKey
            ? t(topicRes.messageKey as ResourceKey)
            : t('admin.content.error.notFound'),
        });
        return;
      }

      const createdTopic = topicRes.data;
      setParseResult((prev) => {
        if (!prev) return prev;
        const alreadyHas = prev.draft.topicIds.includes(createdTopic.id);
        return {
          ...prev,
          draft: {
            ...prev.draft,
            topicIds: alreadyHas ? prev.draft.topicIds : [...prev.draft.topicIds, createdTopic.id],
            matchedTopics: alreadyHas
              ? prev.draft.matchedTopics
              : [...prev.draft.matchedTopics, createdTopic],
          },
          suggestions: {
            ...prev.suggestions,
            missingTopics: prev.suggestions.missingTopics.filter(
              (m) => m.rawText !== item.rawText,
            ),
          },
        };
      });

      setActionFeedback({
        variant: 'success',
        message: t('admin.smartImport.suggestions.createdSuccess', { name: createdTopic.name }),
      });
      await loadPrompt();
    } finally {
      setCreatingKey(null);
    }
  };

  const handleCreateMissingTag = async (item: MissingNameSuggestion) => {
    if (!canManageTaxonomy) return;
    const key = `tag:${item.name}`;
    setCreatingKey(key);
    setActionFeedback(null);
    try {
      const res = await appContainer.taxonomyService.createTagAsync(currentUser, {
        name: item.name,
      });
      if (!res.ok || !res.data) {
        setActionFeedback({
          variant: 'error',
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.content.error.notFound'),
        });
        return;
      }

      const createdTag = res.data;
      setParseResult((prev) => {
        if (!prev) return prev;
        const alreadyHas = prev.draft.tagIds.includes(createdTag.id);
        return {
          ...prev,
          draft: {
            ...prev.draft,
            tagIds: alreadyHas ? prev.draft.tagIds : [...prev.draft.tagIds, createdTag.id],
            matchedTags: alreadyHas
              ? prev.draft.matchedTags
              : [...prev.draft.matchedTags, createdTag],
          },
          suggestions: {
            ...prev.suggestions,
            missingTags: prev.suggestions.missingTags.filter((m) => m.name !== item.name),
          },
        };
      });

      setActionFeedback({
        variant: 'success',
        message: t('admin.smartImport.suggestions.createdSuccess', { name: createdTag.name }),
      });
    } finally {
      setCreatingKey(null);
    }
  };

  const handleCreateMissingPerson = async (item: MissingNameSuggestion) => {
    if (!canManageTaxonomy) return;
    const key = `person:${item.name}`;
    setCreatingKey(key);
    setActionFeedback(null);
    try {
      const res = await appContainer.taxonomyService.createPersonAsync(currentUser, {
        name: item.name,
        bio: '',
      });
      if (!res.ok || !res.data) {
        setActionFeedback({
          variant: 'error',
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.content.error.notFound'),
        });
        return;
      }

      const createdPerson = res.data;
      setParseResult((prev) => {
        if (!prev) return prev;
        const alreadyHas = prev.draft.personIds.includes(createdPerson.id);
        return {
          ...prev,
          draft: {
            ...prev.draft,
            personIds: alreadyHas
              ? prev.draft.personIds
              : [...prev.draft.personIds, createdPerson.id],
            matchedPersons: alreadyHas
              ? prev.draft.matchedPersons
              : [...prev.draft.matchedPersons, createdPerson],
          },
          suggestions: {
            ...prev.suggestions,
            missingPersons: prev.suggestions.missingPersons.filter((m) => m.name !== item.name),
          },
        };
      });

      setActionFeedback({
        variant: 'success',
        message: t('admin.smartImport.suggestions.createdSuccess', { name: createdPerson.name }),
      });
    } finally {
      setCreatingKey(null);
    }
  };

  const handleTransferToForm = () => {
    if (!parseResult || !parseResult.isValid) return;
    smartImportDraftBridge.setPendingTransfer({
      draft: parseResult.draft,
      suggestions: parseResult.suggestions,
    });
    navigateToHash('/admin/content/new');
  };

  const hasMissingSuggestions = Boolean(
    parseResult &&
      (parseResult.suggestions.missingTopics.length > 0 ||
        parseResult.suggestions.missingTags.length > 0 ||
        parseResult.suggestions.missingPersons.length > 0),
  );

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        {/* Header */}
        <header className="pb-5 border-b border-[var(--color-border)] flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <span>{t('admin.smartImport.title')}</span>
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('admin.smartImport.subtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => navigateToHash('/admin/content')}
              startIcon={<ArrowRight className="w-4 h-4" />}
            >
              {t('admin.smartImport.backToList')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                smartImportDraftBridge.clear();
                navigateToHash('/admin/content/new');
              }}
            >
              {t('admin.smartImport.newFormButton')}
            </Button>
          </div>
        </header>

        {actionFeedback && (
          <Alert
            variant={actionFeedback.variant}
            message={actionFeedback.message}
            onDismiss={() => setActionFeedback(null)}
          />
        )}

        {/* Section 1: Ready-to-copy Prompt Builder */}
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 max-w-2xl">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                {t('admin.smartImport.prompt.sectionTitle')}
              </h2>
              <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                {t('admin.smartImport.prompt.sectionDesc')}
              </p>
            </div>

            <Button
              variant="secondary"
              onClick={() => void handleCopyPrompt()}
              disabled={!promptText}
              startIcon={<Copy className="w-4 h-4" />}
            >
              {t('admin.smartImport.prompt.copyButton')}
            </Button>
          </div>

          <label className="inline-flex items-center gap-2.5 text-xs sm:text-sm text-[var(--color-text)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSiteLists}
              onChange={(e) => {
                setIncludeSiteLists(e.target.checked);
                setCopyStatus('idle');
              }}
              className="w-4 h-4 accent-[var(--color-primary)]"
            />
            <span>{t('admin.smartImport.prompt.includeSiteListsLabel')}</span>
          </label>

          {copyStatus === 'copied' && (
            <Alert
              variant="success"
              message={t('admin.smartImport.prompt.copiedSuccess')}
              onDismiss={() => setCopyStatus('idle')}
            />
          )}
          {copyStatus === 'failed' && (
            <Alert
              variant="warning"
              message={t('admin.smartImport.prompt.copyFailed')}
              onDismiss={() => setCopyStatus('idle')}
            />
          )}

          <textarea
            ref={promptTextareaRef}
            readOnly
            rows={12}
            value={promptText}
            aria-label={t('admin.smartImport.prompt.sectionTitle')}
            className="w-full rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] text-[var(--color-text)] border border-[var(--color-border)] px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
          />
        </section>

        {/* Section 2: Raw AI Output Input */}
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
          <div className="space-y-1 max-w-3xl">
            <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
              {t('admin.smartImport.input.sectionTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('admin.smartImport.input.sectionDesc')}
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="smart-import-raw-input"
              className="block text-xs sm:text-sm font-semibold text-[var(--color-text)]"
            >
              {t('admin.smartImport.input.label')}
            </label>
            <textarea
              id="smart-import-raw-input"
              rows={11}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder={t('admin.smartImport.input.placeholder')}
              className="w-full rounded-[var(--radius-control)] bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border-strong)] px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="primary"
              disabled={isAnalyzing}
              onClick={() => void handleAnalyze()}
              startIcon={<Wand2 className="w-4 h-4" />}
            >
              {isAnalyzing
                ? t('admin.smartImport.input.analyzingButton')
                : t('admin.smartImport.input.analyzeButton')}
            </Button>

            <Button
              variant="outline"
              disabled={isAnalyzing}
              onClick={handleInsertSample}
              startIcon={<Sparkles className="w-4 h-4" />}
            >
              {t('admin.smartImport.input.insertSampleButton')}
            </Button>

            <Button
              variant="ghost"
              disabled={isAnalyzing || (!rawInput && !parseResult)}
              onClick={handleClear}
              startIcon={<Trash2 className="w-4 h-4" />}
            >
              {t('admin.smartImport.input.clearButton')}
            </Button>
          </div>
        </section>

        {/* Section 3: Deterministic Preview, Suggestions & Form Transfer */}
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--color-border)]">
            <div className="space-y-1.5">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                <FileCheck2
                  className="w-5 h-5 text-[var(--color-primary)] shrink-0"
                  aria-hidden="true"
                />
                <span>{t('admin.smartImport.result.sectionTitle')}</span>
              </h2>
              <div>
                <Tag label={t('admin.smartImport.result.draftBadge')} variant="neutral" />
              </div>
            </div>

            <Button
              variant="primary"
              disabled={!parseResult || !parseResult.isValid}
              onClick={handleTransferToForm}
              startIcon={<CheckCircle2 className="w-4 h-4" />}
            >
              {t('admin.smartImport.result.transferButton')}
            </Button>
          </div>

          {!parseResult ? (
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed py-4 text-center">
              {t('admin.smartImport.result.emptyHint')}
            </p>
          ) : (
            <div className="space-y-5">
              {/* Validation Errors (blocking transfer) */}
              {parseResult.errors.length > 0 && (
                <div className="space-y-2">
                  <Alert
                    variant="error"
                    title={t('admin.smartImport.result.errorsTitle')}
                    message={parseResult.errors
                      .map((err) => t(err.messageKey as ResourceKey))
                      .join(' ')}
                  />
                </div>
              )}

              {/* Non-blocking Warnings */}
              {parseResult.warnings.length > 0 && (
                <div className="rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-3 text-xs sm:text-sm text-[var(--color-warning-text)] space-y-1.5">
                  <p className="font-bold">{t('admin.smartImport.result.warningsTitle')}</p>
                  <ul className="list-disc pr-5 space-y-1">
                    {parseResult.warnings.map((warn, idx) => (
                      <li key={`${warn.code}-${idx}`}>
                        <span>{t(warn.messageKey as ResourceKey)}</span>
                        {warn.detail ? (
                          <span dir="ltr" className="mx-1.5 font-mono text-xs underline">
                            ({warn.detail})
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Extracted Draft Preview (when valid) */}
              {parseResult.isValid && (
                <>
                  <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-xs sm:text-sm">
                    <div className="space-y-1 min-w-0">
                      <dt className="text-[var(--color-muted)]">
                        {t('admin.smartImport.result.fieldTitle')}
                      </dt>
                      <dd className="font-bold text-[var(--color-text)] break-words">
                        {parseResult.draft.title}
                      </dd>
                    </div>

                    <div className="space-y-1 min-w-0">
                      <dt className="text-[var(--color-muted)]">
                        {t('admin.smartImport.result.fieldSlug')}
                      </dt>
                      <dd dir="ltr" className="font-mono text-xs text-[var(--color-text)] break-all">
                        /{parseResult.draft.slug}
                      </dd>
                    </div>

                    <div className="space-y-1">
                      <dt className="text-[var(--color-muted)]">
                        {t('admin.smartImport.result.fieldFormat')}
                      </dt>
                      <dd>
                        <Tag
                          label={t(getFormatResourceKey(parseResult.draft.format))}
                          variant="primary"
                        />
                      </dd>
                    </div>

                    <div className="space-y-1 tabular-nums-strict">
                      <dt className="text-[var(--color-muted)]">
                        {t('admin.smartImport.result.fieldMinutes')}
                      </dt>
                      <dd className="font-semibold text-[var(--color-text)]">
                        {parseResult.draft.readWatchMinutes !== null
                          ? toPersianDigits(parseResult.draft.readWatchMinutes)
                          : t('admin.smartImport.result.fieldMinutesEmpty')}
                      </dd>
                    </div>

                    <div className="md:col-span-2 space-y-1 min-w-0">
                      <dt className="text-[var(--color-muted)]">
                        {t('admin.smartImport.result.fieldSummary')}
                      </dt>
                      <dd className="text-[var(--color-text)] leading-relaxed break-words">
                        {parseResult.draft.summary || t('admin.smartImport.result.fieldEmpty')}
                      </dd>
                    </div>
                  </dl>

                  {/* Matched Taxonomy Summary */}
                  <div className="p-4 rounded-[var(--radius-control)] border border-[var(--color-border)] space-y-3">
                    <h3 className="text-sm font-bold text-[var(--color-text)]">
                      {t('admin.smartImport.result.matchedTaxonomyTitle')}
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm">
                      <div className="space-y-1.5">
                        <p className="text-[var(--color-muted)]">
                          {t('admin.smartImport.result.matchedTopicsLabel')}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {parseResult.draft.matchedTopics.length > 0 ? (
                            parseResult.draft.matchedTopics.map((topic) => (
                              <Tag key={topic.id} label={topic.name} variant="success" />
                            ))
                          ) : (
                            <span className="text-xs text-[var(--color-muted)]">
                              {t('admin.smartImport.result.noneMatched')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <p className="text-[var(--color-muted)]">
                          {t('admin.smartImport.result.matchedTagsLabel')}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {parseResult.draft.matchedTags.length > 0 ? (
                            parseResult.draft.matchedTags.map((tag) => (
                              <Tag key={tag.id} label={tag.name} variant="primary" />
                            ))
                          ) : (
                            <span className="text-xs text-[var(--color-muted)]">
                              {t('admin.smartImport.result.noneMatched')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <p className="text-[var(--color-muted)]">
                          {t('admin.smartImport.result.matchedPersonsLabel')}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {parseResult.draft.matchedPersons.length > 0 ? (
                            parseResult.draft.matchedPersons.map((person) => (
                              <Tag key={person.id} label={person.name} variant="accent" />
                            ))
                          ) : (
                            <span className="text-xs text-[var(--color-muted)]">
                              {t('admin.smartImport.result.noneMatched')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <p className="text-[var(--color-muted)]">
                          {t('admin.smartImport.result.matchedAgeGroupsLabel')}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {parseResult.draft.matchedAgeGroups.length > 0 ? (
                            parseResult.draft.matchedAgeGroups.map((group) => (
                              <Tag
                                key={group.id}
                                label={formatAgeGroupWithRange(group)}
                                variant="neutral"
                              />
                            ))
                          ) : (
                            <span className="text-xs text-[var(--color-muted)]">
                              {t('admin.smartImport.result.noneMatched')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="sm:col-span-2 space-y-1.5">
                        <p className="text-[var(--color-muted)]">
                          {t('admin.smartImport.result.matchedImpactLabel')}
                        </p>
                        <div>
                          {parseResult.draft.matchedImpactLevel ? (
                            <Tag
                              label={parseResult.draft.matchedImpactLevel.name}
                              variant="success"
                            />
                          ) : (
                            <span className="text-xs text-[var(--color-muted)]">
                              {t('admin.smartImport.result.noneMatched')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Missing Taxonomy Suggestions Card (Never Auto-Created) */}
                  {hasMissingSuggestions && (
                    <div className="p-4 rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-[var(--color-warning-text)]">
                          {t('admin.smartImport.suggestions.title')}
                        </h3>
                        <Tag label={t('admin.smartImport.suggestions.badge')} variant="warning" />
                      </div>

                      <p className="text-xs sm:text-sm text-[var(--color-warning-text)] leading-relaxed">
                        {t('admin.smartImport.suggestions.noAutoCreateNote')}
                      </p>

                      {!canManageTaxonomy && (
                        <p className="text-xs text-[var(--color-warning-text)] font-medium">
                          {t('admin.smartImport.suggestions.noTaxonomyPermissionNote')}
                        </p>
                      )}

                      <ul className="divide-y divide-[var(--color-warning-border)] bg-[var(--color-surface)] rounded-[var(--radius-control)] border border-[var(--color-warning-border)] px-3">
                        {parseResult.suggestions.missingTopics.map((item) => {
                          const rowKey = `topic:${item.rawText}`;
                          const displayName = item.parentName
                            ? t('admin.smartImport.suggestions.topicWithParent', {
                                parent: item.parentName,
                                name: item.name,
                              })
                            : item.name;
                          return (
                            <li
                              key={rowKey}
                              className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm"
                            >
                              <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <Tag
                                  label={t('admin.smartImport.suggestions.typeTopic')}
                                  variant="neutral"
                                />
                                <span className="font-semibold text-[var(--color-text)] break-words">
                                  {displayName}
                                </span>
                              </div>

                              {canManageTaxonomy && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={creatingKey === rowKey}
                                  onClick={() => void handleCreateMissingTopic(item)}
                                  startIcon={<PlusCircle className="w-3.5 h-3.5" />}
                                >
                                  {creatingKey === rowKey
                                    ? t('admin.smartImport.suggestions.creatingAction')
                                    : t('admin.smartImport.suggestions.createAndAddAction')}
                                </Button>
                              )}
                            </li>
                          );
                        })}

                        {parseResult.suggestions.missingTags.map((item) => {
                          const rowKey = `tag:${item.name}`;
                          return (
                            <li
                              key={rowKey}
                              className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm"
                            >
                              <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <Tag
                                  label={t('admin.smartImport.suggestions.typeTag')}
                                  variant="neutral"
                                />
                                <span className="font-semibold text-[var(--color-text)] break-words">
                                  {item.name}
                                </span>
                              </div>

                              {canManageTaxonomy && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={creatingKey === rowKey}
                                  onClick={() => void handleCreateMissingTag(item)}
                                  startIcon={<PlusCircle className="w-3.5 h-3.5" />}
                                >
                                  {creatingKey === rowKey
                                    ? t('admin.smartImport.suggestions.creatingAction')
                                    : t('admin.smartImport.suggestions.createAndAddAction')}
                                </Button>
                              )}
                            </li>
                          );
                        })}

                        {parseResult.suggestions.missingPersons.map((item) => {
                          const rowKey = `person:${item.name}`;
                          return (
                            <li
                              key={rowKey}
                              className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm"
                            >
                              <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <Tag
                                  label={t('admin.smartImport.suggestions.typePerson')}
                                  variant="neutral"
                                />
                                <span className="font-semibold text-[var(--color-text)] break-words">
                                  {item.name}
                                </span>
                              </div>

                              {canManageTaxonomy && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={creatingKey === rowKey}
                                  onClick={() => void handleCreateMissingPerson(item)}
                                  startIcon={<PlusCircle className="w-3.5 h-3.5" />}
                                >
                                  {creatingKey === rowKey
                                    ? t('admin.smartImport.suggestions.creatingAction')
                                    : t('admin.smartImport.suggestions.createAndAddAction')}
                                </Button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Extracted Sources Table */}
                  <div className="space-y-2.5">
                    <h3 className="text-sm font-bold text-[var(--color-text)] tabular-nums-strict">
                      {t('admin.smartImport.result.sourcesTitle', {
                        count: toPersianDigits(parseResult.draft.sources.length),
                      })}
                    </h3>

                    {parseResult.draft.sources.length === 0 ? (
                      <p className="text-xs text-[var(--color-muted)]">
                        {t('admin.smartImport.result.sourcesEmpty')}
                      </p>
                    ) : (
                      <div className="overflow-x-auto rounded-[var(--radius-control)] border border-[var(--color-border)]">
                        <table className="w-full text-right text-xs sm:text-sm">
                          <thead className="bg-[var(--color-surface-alt)] text-[var(--color-muted)] border-b border-[var(--color-border)]">
                            <tr>
                              <th className="py-2.5 px-3 font-semibold">
                                {t('admin.smartImport.result.sourceColTitle')}
                              </th>
                              <th className="py-2.5 px-3 font-semibold">
                                {t('admin.smartImport.result.sourceColUrl')}
                              </th>
                              <th className="py-2.5 px-3 font-semibold">
                                {t('admin.smartImport.result.sourceColNote')}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-border)]">
                            {parseResult.draft.sources.map((src, idx) => (
                              <tr key={`${src.title}-${idx}`}>
                                <td className="py-2.5 px-3 font-medium text-[var(--color-text)]">
                                  {src.title}
                                </td>
                                <td className="py-2.5 px-3">
                                  {src.url && isSafeAnchorHref(src.url) ? (
                                    <a
                                      href={src.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      dir="ltr"
                                      className="font-mono text-xs text-[var(--color-primary)] underline underline-offset-4 break-all"
                                    >
                                      {src.url}
                                    </a>
                                  ) : (
                                    <span className="text-xs text-[var(--color-muted)]">—</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-[var(--color-muted)]">
                                  {src.note || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Sanitized HTML Body Preview */}
                  <div className="space-y-2.5">
                    <h3 className="text-sm font-bold text-[var(--color-text)]">
                      {t('admin.smartImport.result.bodyTitle')}
                    </h3>
                    <div className="p-4 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-sm text-[var(--color-text)]">
                      <SanitizedHtmlPreview html={parseResult.draft.bodyHtml} />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
