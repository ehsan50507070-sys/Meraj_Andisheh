import {
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Link2,
  MessageSquareQuote,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ContentRequestStatus } from '../../../core/domain/requests';
import {
  REQUEST_ADMIN_NOTE_MAX_LENGTH,
  validateOptionalRequestLink,
  type AdminContentRequestRow,
  type ContentRequestStatusCounts,
  type LinkedContentSummary,
} from '../../../core/services/contentRequestService';
import { useAuth } from '../../auth/AuthContext';
import {
  getContentRequestStatusLabelKey,
  getContentRequestStatusVariant,
} from '../../components/UserRequestsList';
import {
  Alert,
  Button,
  FormField,
  Modal,
  Tag,
  type SelectOption,
} from '../../components/ui';
import type { ResourceKey } from '../../resources/fa';
import { formatJalaliDateTimePersian, toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';
import { appContainer } from '../../services/appContainer';
import { AdminLayout } from '../AdminLayout';

interface AdminRequestsPageProps {
  currentRoute: string;
}

const EMPTY_COUNTS: ContentRequestStatusCounts = {
  total: 0,
  submitted: 0,
  inProgress: 0,
  done: 0,
  rejected: 0,
};

export function AdminRequestsPage({ currentRoute }: AdminRequestsPageProps) {
  const { currentUser } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [rows, setRows] = useState<AdminContentRequestRow[]>([]);
  const [counts, setCounts] = useState<ContentRequestStatusCounts>(EMPTY_COUNTS);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error';
    message: string;
  } | null>(null);

  // Review / Update modal state
  const [editingRow, setEditingRow] = useState<AdminContentRequestRow | null>(null);
  const [modalStatus, setModalStatus] = useState<string>(
    String(ContentRequestStatus.Submitted),
  );
  const [modalAdminNote, setModalAdminNote] = useState<string>('');
  const [modalLinkedContent, setModalLinkedContent] =
    useState<LinkedContentSummary | null>(null);
  const [contentPickerSearch, setContentPickerSearch] = useState<string>('');
  const [publishedCandidates, setPublishedCandidates] = useState<
    LinkedContentSummary[]
  >([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      const parsedStatus: ContentRequestStatus | 'all' =
        statusFilter === '1'
          ? ContentRequestStatus.Submitted
          : statusFilter === '2'
            ? ContentRequestStatus.InProgress
            : statusFilter === '3'
              ? ContentRequestStatus.Done
              : statusFilter === '4'
                ? ContentRequestStatus.Rejected
                : 'all';

      const res =
        await appContainer.contentRequestService.listAdminContentRequestsAsync(
          currentUser,
          {
            status: parsedStatus,
            search: searchQuery,
          },
        );
      if (res.ok && res.items) {
        setRows(res.items);
        setCounts(res.counts ?? EMPTY_COUNTS);
      } else {
        setRows([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, searchQuery, statusFilter]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (!editingRow) {
      return;
    }
    let active = true;
    const loadCandidates = async () => {
      setIsLoadingCandidates(true);
      try {
        const res =
          await appContainer.contentRequestService.listPublishedContentsForLinkingAsync(
            currentUser,
            contentPickerSearch,
          );
        if (active && res.ok && res.items) {
          setPublishedCandidates(res.items);
        }
      } finally {
        if (active) {
          setIsLoadingCandidates(false);
        }
      }
    };
    void loadCandidates();
    return () => {
      active = false;
    };
  }, [contentPickerSearch, currentUser, editingRow]);

  const openReviewModal = (row: AdminContentRequestRow) => {
    setEditingRow(row);
    setModalStatus(String(row.request.status));
    setModalAdminNote(row.request.adminNote ?? '');
    setModalLinkedContent(row.linkedContent);
    setContentPickerSearch('');
    setModalError(null);
  };

  const closeReviewModal = () => {
    if (isSaving) {
      return;
    }
    setEditingRow(null);
    setModalError(null);
  };

  const handleSaveUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingRow || isSaving) {
      return;
    }

    setModalError(null);
    setIsSaving(true);
    try {
      const nextStatus = Number.parseInt(
        modalStatus,
        10,
      ) as ContentRequestStatus;
      const res =
        await appContainer.contentRequestService.updateContentRequestByAdminAsync(
          currentUser,
          editingRow.request.id,
          {
            status: nextStatus,
            adminNote: modalAdminNote,
            linkedContentId: modalLinkedContent?.id ?? null,
          },
        );

      if (!res.ok) {
        setModalError(
          res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.forbidden.title'),
        );
        return;
      }

      setEditingRow(null);
      setFeedback({
        variant: 'success',
        message: t('requests.admin.feedback.updated'),
      });
      await loadRequests();
    } finally {
      setIsSaving(false);
    }
  };

  const statusFilterOptions: SelectOption[] = [
    { value: 'all', label: t('requests.admin.filter.statusAll') },
    { value: String(ContentRequestStatus.Submitted), label: t('requests.status.1') },
    { value: String(ContentRequestStatus.InProgress), label: t('requests.status.2') },
    { value: String(ContentRequestStatus.Done), label: t('requests.status.3') },
    { value: String(ContentRequestStatus.Rejected), label: t('requests.status.4') },
  ];

  const modalStatusOptions: SelectOption[] = [
    { value: String(ContentRequestStatus.Submitted), label: t('requests.status.1') },
    { value: String(ContentRequestStatus.InProgress), label: t('requests.status.2') },
    { value: String(ContentRequestStatus.Done), label: t('requests.status.3') },
    { value: String(ContentRequestStatus.Rejected), label: t('requests.status.4') },
  ];

  const summaryCards: Array<{
    status: ContentRequestStatus;
    labelKey: ResourceKey;
    count: number;
  }> = [
    {
      status: ContentRequestStatus.Submitted,
      labelKey: 'requests.admin.summary.submitted',
      count: counts.submitted,
    },
    {
      status: ContentRequestStatus.InProgress,
      labelKey: 'requests.admin.summary.inProgress',
      count: counts.inProgress,
    },
    {
      status: ContentRequestStatus.Done,
      labelKey: 'requests.admin.summary.done',
      count: counts.done,
    },
    {
      status: ContentRequestStatus.Rejected,
      labelKey: 'requests.admin.summary.rejected',
      count: counts.rejected,
    },
  ];

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        {/* Heading */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <ClipboardList
                className="w-5 h-5 text-[var(--color-primary)] shrink-0"
                aria-hidden="true"
              />
              <h1 className="text-lg sm:text-xl font-bold text-[var(--color-text)]">
                {t('requests.admin.title')}
              </h1>
            </div>
            <Tag
              label={toPersianDigits(counts.total)}
              variant="primary"
            />
          </div>
          <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
            {t('requests.admin.subtitle')}
          </p>
        </section>

        {/* Status Summary KPI Cards */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {summaryCards.map((card) => {
            const isActiveFilter = statusFilter === String(card.status);
            return (
              <button
                key={card.status}
                type="button"
                onClick={() =>
                  setStatusFilter(
                    isActiveFilter ? 'all' : String(card.status),
                  )
                }
                className={`text-right bg-[var(--color-surface)] border rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${
                  isActiveFilter
                    ? 'border-[var(--color-primary)] bg-[var(--color-surface-alt)]'
                    : 'border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs sm:text-sm font-medium text-[var(--color-muted)]">
                    {t(card.labelKey)}
                  </span>
                  <Tag
                    label={t(getContentRequestStatusLabelKey(card.status))}
                    variant={getContentRequestStatusVariant(card.status)}
                  />
                </div>
                <p className="mt-2.5 text-2xl font-bold text-[var(--color-text)] tabular-nums-strict">
                  {toPersianDigits(card.count)}
                </p>
              </button>
            );
          })}
        </section>

        {feedback && (
          <Alert
            variant={feedback.variant}
            message={feedback.message}
            onDismiss={() => setFeedback(null)}
          />
        )}

        {/* Filter Bar */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-8">
            <FormField
              id="admin-requests-search"
              label={t('requests.admin.filter.searchLabel')}
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('requests.admin.filter.searchPlaceholder')}
            />
          </div>
          <div className="md:col-span-4">
            <FormField
              id="admin-requests-status-filter"
              label={t('requests.admin.filter.statusLabel')}
              kind="select"
              value={statusFilter}
              onChange={setStatusFilter}
              options={statusFilterOptions}
            />
          </div>
        </section>

        {/* Requests List */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((idx) => (
              <div
                key={idx}
                className="h-28 rounded-[var(--radius-card)] bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center space-y-1.5">
            <p className="text-sm font-bold text-[var(--color-text)]">
              {t('requests.admin.emptyTitle')}
            </p>
            <p className="text-xs sm:text-sm text-[var(--color-muted)]">
              {t('requests.admin.emptyBody')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const safeLink = validateOptionalRequestLink(row.request.link);
              const safeHref = safeLink.ok ? safeLink.normalized : null;

              return (
                <article
                  key={row.request.id}
                  className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-xs sm:text-sm font-bold ${
                            row.isRequesterDeleted
                              ? 'text-[var(--color-muted)]'
                              : 'text-[var(--color-text)]'
                          }`}
                        >
                          {row.requesterDisplayName}
                        </span>
                        <Tag
                          label={t(
                            getContentRequestStatusLabelKey(row.request.status),
                          )}
                          variant={getContentRequestStatusVariant(
                            row.request.status,
                          )}
                        />
                        {row.request.adminNote && (
                          <Tag
                            label={t('requests.admin.hasAdminNoteBadge')}
                            variant="neutral"
                          />
                        )}
                      </div>

                      <h2 className="text-sm sm:text-base font-bold text-[var(--color-text)] break-words">
                        {row.request.title}
                      </h2>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      startIcon={<SlidersHorizontal className="w-3.5 h-3.5" />}
                      onClick={() => openReviewModal(row)}
                    >
                      {t('requests.admin.reviewButton')}
                    </Button>
                  </div>

                  <p className="text-xs sm:text-sm text-[var(--color-text)] leading-relaxed whitespace-pre-wrap break-words">
                    {row.request.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                    {safeHref && (
                      <a
                        href={safeHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[var(--color-primary)] font-medium hover:underline underline-offset-4 break-all"
                      >
                        <Link2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{t('requests.admin.openReferenceLink')}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                      </a>
                    )}

                    {row.linkedContent ? (
                      <a
                        href={`#/content/${encodeURIComponent(row.linkedContent.slug)}`}
                        className="inline-flex items-center gap-1.5 text-[var(--color-success-text)] font-medium hover:underline underline-offset-4"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate max-w-[260px]">
                          {row.linkedContent.title}
                        </span>
                        <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="text-[var(--color-muted)]">
                        {t('requests.admin.noLinkedContent')}
                      </span>
                    )}
                  </div>

                  {row.request.adminNote && (
                    <div className="p-3 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)]">
                        <MessageSquareQuote
                          className="w-3.5 h-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span>{t('requests.list.adminNoteTitle')}</span>
                      </div>
                      <p className="text-xs text-[var(--color-text)] leading-relaxed whitespace-pre-wrap break-words">
                        {row.request.adminNote}
                      </p>
                    </div>
                  )}

                  <div className="pt-2 border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2 text-[11px] sm:text-xs text-[var(--color-muted)] tabular-nums-strict">
                    <span>
                      {t('requests.list.createdAtLabel', {
                        date: formatJalaliDateTimePersian(row.request.createdAt),
                      })}
                    </span>
                    <span>
                      {t('requests.list.updatedAtLabel', {
                        date: formatJalaliDateTimePersian(row.request.updatedAt),
                      })}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Review & Update Modal */}
      <Modal
        open={editingRow !== null}
        onClose={closeReviewModal}
        title={t('requests.admin.modal.title')}
        closeOnBackdrop={!isSaving}
      >
        {editingRow && (
          <form onSubmit={handleSaveUpdate} className="space-y-4">
            <div className="p-3 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] space-y-1.5">
              <p className="text-xs text-[var(--color-muted)]">
                {t('requests.admin.modal.requesterLabel', {
                  name: editingRow.requesterDisplayName,
                })}
              </p>
              <p className="text-sm font-bold text-[var(--color-text)] break-words">
                {editingRow.request.title}
              </p>
              <p className="text-xs text-[var(--color-text)] leading-relaxed whitespace-pre-wrap break-words">
                {editingRow.request.description}
              </p>
            </div>

            {modalError && (
              <Alert
                variant="error"
                message={modalError}
                onDismiss={() => setModalError(null)}
              />
            )}

            <FormField
              id="admin-request-modal-status"
              label={t('requests.admin.modal.statusLabel')}
              kind="select"
              value={modalStatus}
              onChange={setModalStatus}
              options={modalStatusOptions}
              disabled={isSaving}
            />

            <div className="space-y-1.5">
              <label
                htmlFor="admin-request-modal-note"
                className="block text-xs sm:text-sm font-medium text-[var(--color-text)]"
              >
                {t('requests.admin.modal.adminNoteLabel')}
              </label>
              <textarea
                id="admin-request-modal-note"
                rows={3}
                maxLength={REQUEST_ADMIN_NOTE_MAX_LENGTH}
                value={modalAdminNote}
                onChange={(e) => {
                  setModalAdminNote(e.target.value);
                  setModalError(null);
                }}
                disabled={isSaving}
                placeholder={t('requests.admin.modal.adminNotePlaceholder')}
                className="w-full px-3.5 py-2.5 text-sm bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] border border-[var(--color-border)] rounded-[var(--radius-control)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
              <p className="text-[11px] text-[var(--color-muted)] text-left tabular-nums-strict">
                {t('requests.admin.modal.adminNoteCounter', {
                  current: toPersianDigits(modalAdminNote.trim().length),
                })}
              </p>
            </div>

            {/* Linked Published Content Picker */}
            <div className="pt-2 border-t border-[var(--color-border)] space-y-3">
              <p className="text-xs sm:text-sm font-semibold text-[var(--color-text)]">
                {t('requests.admin.modal.linkedContentTitle')}
              </p>

              {modalLinkedContent && (
                <div className="p-3 rounded-[var(--radius-control)] bg-[var(--color-success-bg)] border border-[var(--color-success-border)] flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[11px] font-medium text-[var(--color-success-text)]">
                      {t('requests.admin.modal.selectedContentLabel')}
                    </p>
                    <p className="text-xs sm:text-sm font-bold text-[var(--color-text)] truncate">
                      {modalLinkedContent.title}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <a
                      href={`#/content/${encodeURIComponent(modalLinkedContent.slug)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline underline-offset-4"
                    >
                      <span>{t('requests.admin.modal.previewContentButton')}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                    </a>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSaving}
                      startIcon={<X className="w-3.5 h-3.5" />}
                      onClick={() => setModalLinkedContent(null)}
                    >
                      {t('requests.admin.modal.clearLinkButton')}
                    </Button>
                  </div>
                </div>
              )}

              <div className="relative">
                <FormField
                  id="admin-request-linked-search"
                  label={t('requests.admin.modal.linkedContentSearchLabel')}
                  value={contentPickerSearch}
                  onChange={setContentPickerSearch}
                  placeholder={t(
                    'requests.admin.modal.linkedContentSearchPlaceholder',
                  )}
                  disabled={isSaving}
                />
              </div>

              <div className="max-h-44 overflow-y-auto border border-[var(--color-border)] rounded-[var(--radius-control)] divide-y divide-[var(--color-border)] bg-[var(--color-surface)]">
                {isLoadingCandidates ? (
                  <div className="p-3 text-xs text-[var(--color-muted)] text-center">
                    {t('requests.list.loading')}
                  </div>
                ) : publishedCandidates.length === 0 ? (
                  <div className="p-3 text-xs text-[var(--color-muted)] text-center flex items-center justify-center gap-1.5">
                    <Search className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{t('requests.admin.modal.noPublishedMatches')}</span>
                  </div>
                ) : (
                  publishedCandidates.map((item) => {
                    const isSelected = modalLinkedContent?.id === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`p-2.5 flex items-center justify-between gap-2 text-xs ${
                          isSelected ? 'bg-[var(--color-surface-alt)]' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-[var(--color-text)] truncate">
                            {item.title}
                          </p>
                          <p
                            dir="ltr"
                            className="font-mono text-[11px] text-[var(--color-muted)] truncate text-right"
                          >
                            /{item.slug}
                          </p>
                        </div>

                        {isSelected ? (
                          <Tag
                            label={t('requests.admin.modal.selectedItemBadge')}
                            variant="success"
                          />
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isSaving}
                            onClick={() => setModalLinkedContent(item)}
                          >
                            {t('requests.admin.modal.selectItemButton')}
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--color-border)] flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={closeReviewModal}
              >
                {t('requests.admin.modal.cancelButton')}
              </Button>
              <Button type="submit" variant="primary" disabled={isSaving}>
                {isSaving
                  ? t('requests.admin.modal.savingButton')
                  : t('requests.admin.modal.saveButton')}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </AdminLayout>
  );
}
