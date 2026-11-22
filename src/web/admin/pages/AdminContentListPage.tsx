import {
  Archive,
  CheckCircle2,
  Edit3,
  FileText,
  Image as ImageIcon,
  Plus,
  RotateCcw,
  Sparkles,
  Star,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONTENT_FORMATS,
  ContentStatus,
  type ContentFormat,
} from '../../../core/domain/content';
import type { Topic } from '../../../core/domain/taxonomy';
import type { PublishValidationError } from '../../../core/services/contentPublishValidator';
import type {
  AdminContentListResult,
  AdminContentSummary,
} from '../../../core/services/contentManagementService';
import type { TopicTreeNode } from '../../../core/services/taxonomyService';
import { useAuth } from '../../auth/AuthContext';
import {
  Alert,
  Button,
  FormField,
  Modal,
  Pagination,
  Table,
  Tag,
  type SelectOption,
  type TableColumn,
} from '../../components/ui';
import type { ResourceKey } from '../../resources/fa';
import { toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';
import { navigateToHash } from '../../router/HashRouter';
import { appContainer } from '../../services/appContainer';
import { AdminLayout } from '../AdminLayout';

interface AdminContentListPageProps {
  currentRoute: string;
}

const PAGE_SIZE = 10;

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

function getStatusInfo(status: ContentStatus): {
  labelKey: ResourceKey;
  variant: 'neutral' | 'success' | 'warning';
} {
  switch (status) {
    case ContentStatus.Published:
      return { labelKey: 'content.status.Published', variant: 'success' };
    case ContentStatus.Archived:
      return { labelKey: 'content.status.Archived', variant: 'warning' };
    case ContentStatus.Draft:
    default:
      return { labelKey: 'content.status.Draft', variant: 'neutral' };
  }
}

function flattenTopicOptions(nodes: readonly TopicTreeNode[], out: SelectOption[] = []): SelectOption[] {
  for (const node of nodes) {
    const prefix = node.depth > 0 ? `${'-- '.repeat(node.depth)}` : '';
    out.push({
      value: String(node.topic.id),
      label: `${prefix}${node.topic.name}`,
    });
    if (node.children.length > 0) {
      flattenTopicOptions(node.children, out);
    }
  }
  return out;
}

export function AdminContentListPage({ currentRoute }: AdminContentListPageProps) {
  const { currentUser } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [topicFilter, setTopicFilter] = useState<string>('all');
  const [page, setPage] = useState<number>(1);

  const [listResult, setListResult] = useState<AdminContentListResult>({
    items: [],
    totalCount: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 1,
  });
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicTree, setTopicTree] = useState<TopicTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isMutatingId, setIsMutatingId] = useState<number | null>(null);

  const [thumbnailUrls, setThumbnailUrls] = useState<Record<number, string>>({});
  const objectUrlsRef = useRef<string[]>([]);

  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error' | 'warning';
    title?: string;
    message: string;
    validationErrors?: PublishValidationError[];
    editTargetId?: number;
  } | null>(null);

  const [archiveTarget, setArchiveTarget] = useState<AdminContentSummary | null>(null);

  const revokeThumbnailUrls = useCallback(() => {
    for (const url of objectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    objectUrlsRef.current = [];
  }, []);

  const loadThumbnailsForRows = useCallback(
    async (rows: readonly AdminContentSummary[]) => {
      revokeThumbnailUrls();
      const nextMap: Record<number, string> = {};
      const nextUrls: string[] = [];

      await Promise.all(
        rows.map(async (row) => {
          if (!row.item.thumbnailKey) return;
          const res = await appContainer.fileUploadService.openPublicMediaAsync(
            row.item.thumbnailKey,
          );
          if (res.ok && res.bytes && res.metadata) {
            const copy = new Uint8Array(res.bytes.byteLength);
            copy.set(res.bytes);
            const blob = new Blob([copy.buffer], { type: res.metadata.mimeType });
            const url = URL.createObjectURL(blob);
            nextUrls.push(url);
            nextMap[row.item.id] = url;
          }
        }),
      );

      objectUrlsRef.current = nextUrls;
      setThumbnailUrls(nextMap);
    },
    [revokeThumbnailUrls],
  );

  const loadTopics = useCallback(async () => {
    const res = await appContainer.contentManagementService.getTaxonomyOptionsForContent(
      currentUser,
    );
    if (res.ok && res.data) {
      setTopics(res.data.topics);
      setTopicTree(res.data.topicTree);
    }
  }, [currentUser]);

  const loadContents = useCallback(async () => {
    setIsLoading(true);
    try {
      const parsedStatus =
        statusFilter === 'all' ? 'all' : (Number(statusFilter) as ContentStatus);
      const parsedFormat =
        formatFilter === 'all' ? 'all' : (formatFilter as ContentFormat);
      const parsedTopic = topicFilter === 'all' ? 'all' : Number(topicFilter);

      const res = await appContainer.contentManagementService.listAdminContents(currentUser, {
        search,
        status: parsedStatus,
        format: parsedFormat,
        topicId: parsedTopic,
        page,
        pageSize: PAGE_SIZE,
      });

      if (res.ok && res.data) {
        setListResult(res.data);
        await loadThumbnailsForRows(res.data.items);
      } else if (res.messageKey) {
        setFeedback({
          variant: 'error',
          message: t(res.messageKey as ResourceKey),
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, search, statusFilter, formatFilter, topicFilter, page, loadThumbnailsForRows]);

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  useEffect(() => {
    void loadContents();
  }, [loadContents]);

  useEffect(() => {
    return () => {
      revokeThumbnailUrls();
    };
  }, [revokeThumbnailUrls]);

  const statusOptions: SelectOption[] = useMemo(
    () => [
      { value: 'all', label: t('admin.content.list.statusAll') },
      { value: String(ContentStatus.Draft), label: t('content.status.Draft') },
      { value: String(ContentStatus.Published), label: t('content.status.Published') },
      { value: String(ContentStatus.Archived), label: t('content.status.Archived') },
    ],
    [],
  );

  const formatOptions: SelectOption[] = useMemo(
    () => [
      { value: 'all', label: t('admin.content.list.formatAll') },
      ...CONTENT_FORMATS.map((fmt) => ({
        value: fmt,
        label: t(getFormatResourceKey(fmt)),
      })),
    ],
    [],
  );

  const topicOptions: SelectOption[] = useMemo(() => {
    const flattened =
      topicTree.length > 0
        ? flattenTopicOptions(topicTree)
        : topics.map((topic) => ({ value: String(topic.id), label: topic.name }));
    return [{ value: 'all', label: t('admin.content.list.topicAll') }, ...flattened];
  }, [topicTree, topics]);

  const handlePublishRow = async (row: AdminContentSummary) => {
    setIsMutatingId(row.item.id);
    setFeedback(null);
    try {
      const res = await appContainer.contentManagementService.publishContent(
        currentUser,
        row.item.id,
      );
      if (res.ok) {
        setFeedback({
          variant: 'success',
          message: t('admin.content.list.feedback.published', { title: row.item.title }),
        });
        await loadContents();
      } else {
        setFeedback({
          variant: 'error',
          title: t('admin.content.form.publishChecklistFailedTitle'),
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.content.error.notFound'),
          validationErrors: res.validationErrors,
          editTargetId: row.item.id,
        });
      }
    } finally {
      setIsMutatingId(null);
    }
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    setIsMutatingId(archiveTarget.item.id);
    setFeedback(null);
    try {
      const res = await appContainer.contentManagementService.archiveContent(
        currentUser,
        archiveTarget.item.id,
      );
      if (res.ok) {
        setFeedback({
          variant: 'warning',
          message: t('admin.content.list.feedback.archived', {
            title: archiveTarget.item.title,
          }),
        });
        setArchiveTarget(null);
        await loadContents();
      } else if (res.messageKey) {
        setFeedback({
          variant: 'error',
          message: t(res.messageKey as ResourceKey),
        });
      }
    } finally {
      setIsMutatingId(null);
    }
  };

  const handleRestoreRow = async (row: AdminContentSummary) => {
    setIsMutatingId(row.item.id);
    setFeedback(null);
    try {
      const res = await appContainer.contentManagementService.restoreToDraft(
        currentUser,
        row.item.id,
      );
      if (res.ok) {
        setFeedback({
          variant: 'success',
          message: t('admin.content.list.feedback.restored', { title: row.item.title }),
        });
        await loadContents();
      } else if (res.messageKey) {
        setFeedback({
          variant: 'error',
          message: t(res.messageKey as ResourceKey),
        });
      }
    } finally {
      setIsMutatingId(null);
    }
  };

  const columns: TableColumn<AdminContentSummary>[] = [
    {
      key: 'title',
      header: t('admin.content.list.col.title'),
      render: (row) => {
        const thumbUrl = thumbnailUrls[row.item.id];
        return (
          <div className="flex items-start gap-3 min-w-[240px]">
            <div className="w-16 h-10 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] overflow-hidden shrink-0 flex items-center justify-center">
              {thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt={row.item.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <ImageIcon className="w-4 h-4 text-[var(--color-muted)]" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-[var(--color-text)] line-clamp-1">
                  {row.item.title}
                </span>
                {row.item.isFeatured && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent)]">
                    <Star className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>{t('admin.content.list.featuredBadge')}</span>
                  </span>
                )}
              </div>
              <p dir="ltr" className="text-[11px] font-mono text-[var(--color-muted)] truncate">
                /{row.item.slug}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'format',
      header: t('admin.content.list.col.format'),
      render: (row) => (
        <Tag label={t(getFormatResourceKey(row.item.format))} variant="neutral" />
      ),
    },
    {
      key: 'status',
      header: t('admin.content.list.col.status'),
      render: (row) => {
        const statusInfo = getStatusInfo(row.item.status);
        return <Tag label={t(statusInfo.labelKey)} variant={statusInfo.variant} />;
      },
    },
    {
      key: 'stats',
      header: t('admin.content.list.col.stats'),
      numeric: true,
      render: (row) => (
        <div className="space-y-0.5 text-xs text-[var(--color-muted)] tabular-nums-strict">
          <div>
            {t('admin.content.list.sourcesCount', {
              count: toPersianDigits(row.sourcesCount),
            })}
          </div>
          <div>
            {t('admin.content.list.filesCount', {
              count: toPersianDigits(row.filesCount),
            })}
          </div>
        </div>
      ),
    },
    {
      key: 'updatedAt',
      header: t('admin.content.list.col.updatedAt'),
      numeric: true,
      render: (row) => (
        <span dir="ltr" className="text-xs font-mono text-[var(--color-muted)]">
          {appContainer.clock.toJalali(new Date(row.item.updatedAt))}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('admin.content.list.col.actions'),
      render: (row) => {
        const busy = isMutatingId === row.item.id;
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigateToHash(`/admin/content/edit/${row.item.id}`)}
              startIcon={<Edit3 className="w-3.5 h-3.5" />}
            >
              {t('admin.content.list.editAction')}
            </Button>

            {row.item.status === ContentStatus.Draft && (
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => void handlePublishRow(row)}
                startIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
              >
                {t('admin.content.list.publishAction')}
              </Button>
            )}

            {row.item.status !== ContentStatus.Archived ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setArchiveTarget(row)}
                startIcon={<Archive className="w-3.5 h-3.5" />}
              >
                {t('admin.content.list.archiveAction')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void handleRestoreRow(row)}
                startIcon={<RotateCcw className="w-3.5 h-3.5" />}
              >
                {t('admin.content.list.restoreAction')}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        <header className="pb-5 border-b border-[var(--color-border)] flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
              <FileText className="w-6 h-6 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <span>{t('admin.content.list.title')}</span>
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('admin.content.list.subtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigateToHash('/admin/content/smart-import')}
              startIcon={<Sparkles className="w-4 h-4" />}
            >
              {t('admin.content.list.smartImportAction')}
            </Button>

            <Button
              variant="primary"
              onClick={() => navigateToHash('/admin/content/new')}
              startIcon={<Plus className="w-4 h-4" />}
            >
              {t('admin.content.list.addNew')}
            </Button>
          </div>
        </header>

        {feedback && (
          <div className="space-y-2">
            <Alert
              variant={feedback.variant}
              title={feedback.title}
              message={feedback.message}
              onDismiss={() => setFeedback(null)}
            />
            {feedback.validationErrors && feedback.validationErrors.length > 0 && (
              <div className="rounded-[var(--radius-control)] border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-xs sm:text-sm text-[var(--color-error-text)] space-y-2">
                <ul className="list-disc pr-5 space-y-1">
                  {feedback.validationErrors.map((err) => (
                    <li key={`${err.field}-${err.code}`}>
                      {t(err.messageKey as ResourceKey)}
                    </li>
                  ))}
                </ul>
                {feedback.editTargetId && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigateToHash(`/admin/content/edit/${feedback.editTargetId}`)
                    }
                    startIcon={<Edit3 className="w-3.5 h-3.5" />}
                  >
                    {t('admin.content.list.editAction')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Filter Bar */}
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <FormField
              id="admin-content-search"
              label={t('admin.content.list.searchLabel')}
              type="search"
              value={search}
              onChange={(val) => {
                setSearch(val);
                setPage(1);
              }}
              placeholder={t('admin.content.list.searchPlaceholder')}
            />

            <FormField
              id="admin-content-status-filter"
              label={t('admin.content.list.statusFilterLabel')}
              kind="select"
              value={statusFilter}
              onChange={(val) => {
                setStatusFilter(val);
                setPage(1);
              }}
              options={statusOptions}
            />

            <FormField
              id="admin-content-format-filter"
              label={t('admin.content.list.formatFilterLabel')}
              kind="select"
              value={formatFilter}
              onChange={(val) => {
                setFormatFilter(val);
                setPage(1);
              }}
              options={formatOptions}
            />

            <FormField
              id="admin-content-topic-filter"
              label={t('admin.content.list.topicFilterLabel')}
              kind="select"
              value={topicFilter}
              onChange={(val) => {
                setTopicFilter(val);
                setPage(1);
              }}
              options={topicOptions}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--color-border)] text-xs text-[var(--color-muted)] tabular-nums-strict">
            <span>
              {t('admin.content.list.countLabel', {
                count: toPersianDigits(listResult.totalCount),
              })}
            </span>
          </div>
        </section>

        {/* Results Table */}
        {isLoading ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('admin.content.list.loading')}
          </div>
        ) : (
          <div className="space-y-4">
            <Table
              columns={columns}
              rows={listResult.items}
              getRowKey={(row) => String(row.item.id)}
              emptyText={t('admin.content.list.emptyText')}
            />

            <Pagination
              currentPage={listResult.page}
              totalPages={listResult.totalPages}
              onPageChange={(nextPage) => setPage(nextPage)}
            />
          </div>
        )}
      </div>

      {/* Safe Archive Confirmation Modal (No Hard-Delete) */}
      <Modal
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        title={t('admin.content.list.archiveConfirmTitle')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setArchiveTarget(null)}
              disabled={isMutatingId !== null}
            >
              {t('admin.content.common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleConfirmArchive()}
              disabled={isMutatingId !== null}
              startIcon={<Archive className="w-4 h-4" />}
            >
              {t('admin.content.list.archiveConfirmSubmit')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          {archiveTarget
            ? t('admin.content.list.archiveConfirmBody', { title: archiveTarget.item.title })
            : ''}
        </p>
      </Modal>
    </AdminLayout>
  );
}
