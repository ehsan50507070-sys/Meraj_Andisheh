import {
  CheckCircle2,
  ExternalLink,
  EyeOff,
  Flag,
  MessageSquare,
  Plus,
  ShieldBan,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { BlockedWord } from '../../../core/domain/comments';
import { CommentStatus } from '../../../core/domain/comments';
import type {
  AdminCommentRow,
  AdminReportRow,
} from '../../../core/services/commentService';
import { useAuth } from '../../auth/AuthContext';
import {
  Alert,
  Button,
  FormField,
  Modal,
  Table,
  Tag,
  type SelectOption,
  type TableColumn,
} from '../../components/ui';
import type { ResourceKey } from '../../resources/fa';
import { formatJalaliDateTimePersian, toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';
import { appContainer } from '../../services/appContainer';
import { AdminLayout } from '../AdminLayout';

interface AdminCommentsPageProps {
  currentRoute: string;
}

type CommentsAdminTab = 'pending' | 'all' | 'reports' | 'blockedWords';

function getCommentStatusVariant(status: CommentStatus): 'warning' | 'success' | 'neutral' {
  switch (status) {
    case CommentStatus.Pending:
      return 'warning';
    case CommentStatus.Published:
      return 'success';
    case CommentStatus.Hidden:
    default:
      return 'neutral';
  }
}

export function AdminCommentsPage({ currentRoute }: AdminCommentsPageProps) {
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === 'SuperAdmin';

  const [activeTab, setActiveTab] = useState<CommentsAdminTab>('pending');
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error';
    message: string;
  } | null>(null);

  const [pendingRows, setPendingRows] = useState<AdminCommentRow[]>([]);
  const [allRows, setAllRows] = useState<AdminCommentRow[]>([]);
  const [reports, setReports] = useState<AdminReportRow[]>([]);
  const [blockedWords, setBlockedWords] = useState<BlockedWord[]>([]);

  const [allStatusFilter, setAllStatusFilter] = useState<string>('all');
  const [allSearch, setAllSearch] = useState('');

  const [newWordInput, setNewWordInput] = useState('');
  const [isAddingWord, setIsAddingWord] = useState(false);

  const [hardDeleteTarget, setHardDeleteTarget] = useState<AdminCommentRow | null>(null);
  const [isBusyAction, setIsBusyAction] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const parsedStatus: CommentStatus | 'all' =
        allStatusFilter === '1'
          ? CommentStatus.Pending
          : allStatusFilter === '2'
            ? CommentStatus.Published
            : allStatusFilter === '3'
              ? CommentStatus.Hidden
              : 'all';

      const [pendingRes, allRes, reportsRes, wordsRes] = await Promise.all([
        appContainer.commentService.listAdminCommentsAsync(currentUser, {
          status: CommentStatus.Pending,
        }),
        appContainer.commentService.listAdminCommentsAsync(currentUser, {
          status: parsedStatus,
          search: allSearch,
        }),
        appContainer.commentService.listCommentReportsAsync(currentUser),
        appContainer.commentService.listBlockedWordsAsync(currentUser),
      ]);

      if (pendingRes.ok && pendingRes.items) {
        setPendingRows(pendingRes.items);
      }
      if (allRes.ok && allRes.items) {
        setAllRows(allRes.items);
      }
      if (reportsRes.ok && reportsRes.items) {
        setReports(reportsRes.items);
      }
      if (wordsRes.ok && wordsRes.items) {
        setBlockedWords(wordsRes.items);
      }
    } finally {
      setIsLoading(false);
    }
  }, [allSearch, allStatusFilter, currentUser]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleApprove = async (commentId: number) => {
    setIsBusyAction(true);
    try {
      const res = await appContainer.commentService.approveCommentAsync(
        currentUser,
        commentId,
      );
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: res.messageKey ? t(res.messageKey as ResourceKey) : t('admin.forbidden.title'),
        });
        return;
      }
      setFeedback({ variant: 'success', message: t('admin.comments.feedback.approved') });
      await loadData();
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleHide = async (commentId: number) => {
    setIsBusyAction(true);
    try {
      const res = await appContainer.commentService.hideCommentAsync(
        currentUser,
        commentId,
      );
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: res.messageKey ? t(res.messageKey as ResourceKey) : t('admin.forbidden.title'),
        });
        return;
      }
      setFeedback({ variant: 'success', message: t('admin.comments.feedback.hidden') });
      await loadData();
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleConfirmHardDelete = async () => {
    if (!hardDeleteTarget) {
      return;
    }
    setIsBusyAction(true);
    try {
      const res = await appContainer.commentService.hardDeleteCommentAsync(
        currentUser,
        hardDeleteTarget.comment.id,
      );
      setHardDeleteTarget(null);
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: res.messageKey ? t(res.messageKey as ResourceKey) : t('admin.forbidden.title'),
        });
        return;
      }
      setFeedback({ variant: 'success', message: t('admin.comments.feedback.hardDeleted') });
      await loadData();
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleDismissReport = async (reportId: number) => {
    setIsBusyAction(true);
    try {
      const res = await appContainer.commentService.dismissReportAsync(
        currentUser,
        reportId,
      );
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: res.messageKey ? t(res.messageKey as ResourceKey) : t('admin.forbidden.title'),
        });
        return;
      }
      setFeedback({
        variant: 'success',
        message: t('admin.comments.feedback.reportDismissed'),
      });
      await loadData();
    } finally {
      setIsBusyAction(false);
    }
  };

  const handleAddBlockedWord = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    setIsAddingWord(true);
    try {
      const res = await appContainer.commentService.addBlockedWordAsync(
        currentUser,
        newWordInput,
      );
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.comments.blockedWords.error.invalid'),
        });
        return;
      }
      setNewWordInput('');
      setFeedback({
        variant: 'success',
        message: t('admin.comments.feedback.wordAdded'),
      });
      await loadData();
    } finally {
      setIsAddingWord(false);
    }
  };

  const handleDeleteBlockedWord = async (wordId: number) => {
    setIsBusyAction(true);
    try {
      const res = await appContainer.commentService.deleteBlockedWordAsync(
        currentUser,
        wordId,
      );
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: res.messageKey ? t(res.messageKey as ResourceKey) : t('admin.forbidden.title'),
        });
        return;
      }
      setFeedback({
        variant: 'success',
        message: t('admin.comments.feedback.wordDeleted'),
      });
      await loadData();
    } finally {
      setIsBusyAction(false);
    }
  };

  const statusOptions: SelectOption[] = [
    { value: 'all', label: t('admin.comments.filter.statusAll') },
    { value: String(CommentStatus.Pending), label: t('admin.comments.status.1') },
    { value: String(CommentStatus.Published), label: t('admin.comments.status.2') },
    { value: String(CommentStatus.Hidden), label: t('admin.comments.status.3') },
  ];

  const renderCommentModerationCards = (
    rows: AdminCommentRow[],
    emptyTitle: string,
    emptyBody: string,
  ) => {
    if (isLoading) {
      return (
        <div className="space-y-3">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-24 rounded-[var(--radius-card)] bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse"
            />
          ))}
        </div>
      );
    }

    if (rows.length === 0) {
      return (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center space-y-1.5">
          <p className="text-sm font-bold text-[var(--color-text)]">{emptyTitle}</p>
          <p className="text-xs sm:text-sm text-[var(--color-muted)]">{emptyBody}</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {rows.map((row) => {
          const statusKey = `admin.comments.status.${row.comment.status}` as ResourceKey;
          const reasonKey =
            row.comment.moderationReason === 'child_author'
              ? 'admin.comments.reason.childAuthor'
              : row.comment.moderationReason === 'blocked_word'
                ? 'admin.comments.reason.blockedWord'
                : null;

          return (
            <article
              key={row.comment.id}
              className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 sm:p-5 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-sm font-bold ${
                        row.isAuthorDeleted
                          ? 'text-[var(--color-muted)]'
                          : 'text-[var(--color-text)]'
                      }`}
                    >
                      {row.authorDisplayName}
                    </span>

                    <Tag
                      label={t(statusKey)}
                      variant={getCommentStatusVariant(row.comment.status)}
                    />

                    {reasonKey && <Tag label={t(reasonKey)} variant="accent" />}

                    {row.authorAgeGroupName && (
                      <Tag
                        label={t('admin.comments.ageSnapshotBadge', {
                          age: row.authorAgeGroupName,
                        })}
                        variant="neutral"
                      />
                    )}

                    {row.reportCount > 0 && (
                      <Tag
                        label={t('admin.comments.reportCountBadge', {
                          count: toPersianDigits(row.reportCount),
                        })}
                        variant="warning"
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)]">
                    <span className="tabular-nums-strict">
                      {formatJalaliDateTimePersian(row.comment.createdAt)}
                    </span>

                    {row.contentTitle && row.contentSlug && (
                      <a
                        href={`#/content/${encodeURIComponent(row.contentSlug)}`}
                        className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)] hover:underline underline-offset-4"
                      >
                        <span className="truncate max-w-[260px]">{row.contentTitle}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                      </a>
                    )}

                    {row.moderatedByDisplayName && (
                      <span>
                        {t('admin.comments.moderatedByHint', {
                          name: row.moderatedByDisplayName,
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {row.comment.status !== CommentStatus.Published && (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={isBusyAction}
                      onClick={() => void handleApprove(row.comment.id)}
                      startIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                    >
                      {t('admin.comments.action.approve')}
                    </Button>
                  )}

                  {row.comment.status !== CommentStatus.Hidden && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isBusyAction}
                      onClick={() => void handleHide(row.comment.id)}
                      startIcon={<EyeOff className="w-3.5 h-3.5" />}
                    >
                      {t('admin.comments.action.hide')}
                    </Button>
                  )}

                  {isSuperAdmin && (
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={isBusyAction}
                      onClick={() => setHardDeleteTarget(row)}
                      startIcon={<Trash2 className="w-3.5 h-3.5" />}
                    >
                      {t('admin.comments.action.hardDelete')}
                    </Button>
                  )}
                </div>
              </div>

              <p className="text-sm text-[var(--color-text)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--radius-control)] p-3 leading-relaxed whitespace-pre-wrap break-words">
                {row.comment.body}
              </p>
            </article>
          );
        })}
      </div>
    );
  };

  const blockedWordColumns: TableColumn<BlockedWord>[] = [
    {
      key: 'word',
      header: t('admin.comments.blockedWords.col.word'),
      render: (row) => (
        <span className="font-semibold text-[var(--color-text)]">{row.word}</span>
      ),
    },
    {
      key: 'createdAt',
      header: t('admin.comments.blockedWords.col.createdAt'),
      numeric: true,
      render: (row) => (
        <span className="text-xs text-[var(--color-muted)] tabular-nums-strict">
          {formatJalaliDateTimePersian(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('admin.comments.blockedWords.col.actions'),
      render: (row) => (
        <Button
          variant="danger"
          size="sm"
          disabled={isBusyAction}
          onClick={() => void handleDeleteBlockedWord(row.id)}
          startIcon={<Trash2 className="w-3.5 h-3.5" />}
        >
          {t('admin.comments.blockedWords.deleteButton')}
        </Button>
      ),
    },
  ];

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        {/* Header Card */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
              <MessageSquare
                className="w-6 h-6 text-[var(--color-primary)] shrink-0"
                aria-hidden="true"
              />
              <span>{t('admin.comments.title')}</span>
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('admin.comments.subtitle')}
            </p>
          </div>

          {/* 4-Tab Bar */}
          <div
            role="tablist"
            aria-label={t('admin.comments.tabs.ariaLabel')}
            className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--color-border)]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'pending'}
              onClick={() => setActiveTab('pending')}
              className={`min-h-[38px] px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] border transition-colors tabular-nums-strict ${
                activeTab === 'pending'
                  ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                  : 'bg-[var(--color-surface-alt)] text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-primary)]'
              }`}
            >
              {t('admin.comments.tab.pendingWithCount', {
                count: toPersianDigits(pendingRows.length),
              })}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'all'}
              onClick={() => setActiveTab('all')}
              className={`min-h-[38px] px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] border transition-colors ${
                activeTab === 'all'
                  ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                  : 'bg-[var(--color-surface-alt)] text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-primary)]'
              }`}
            >
              {t('admin.comments.tab.all')}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'reports'}
              onClick={() => setActiveTab('reports')}
              className={`min-h-[38px] px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] border transition-colors tabular-nums-strict ${
                activeTab === 'reports'
                  ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                  : 'bg-[var(--color-surface-alt)] text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-primary)]'
              }`}
            >
              {t('admin.comments.tab.reportsWithCount', {
                count: toPersianDigits(reports.length),
              })}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'blockedWords'}
              onClick={() => setActiveTab('blockedWords')}
              className={`min-h-[38px] px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] border transition-colors ${
                activeTab === 'blockedWords'
                  ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                  : 'bg-[var(--color-surface-alt)] text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-primary)]'
              }`}
            >
              {t('admin.comments.tab.blockedWords')}
            </button>
          </div>
        </section>

        {feedback && (
          <Alert
            variant={feedback.variant}
            message={feedback.message}
            onDismiss={() => setFeedback(null)}
          />
        )}

        {/* Tab 1: Pending Queue */}
        {activeTab === 'pending' &&
          renderCommentModerationCards(
            pendingRows,
            t('admin.comments.emptyPendingTitle'),
            t('admin.comments.emptyPendingBody'),
          )}

        {/* Tab 2: All Comments */}
        {activeTab === 'all' && (
          <div className="space-y-4">
            <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                id="admin-comments-search"
                label={t('admin.comments.filter.searchLabel')}
                type="search"
                value={allSearch}
                onChange={setAllSearch}
                placeholder={t('admin.comments.filter.searchPlaceholder')}
              />
              <FormField
                id="admin-comments-status"
                label={t('admin.comments.filter.statusLabel')}
                kind="select"
                value={allStatusFilter}
                onChange={setAllStatusFilter}
                options={statusOptions}
              />
            </section>

            {renderCommentModerationCards(
              allRows,
              t('admin.comments.emptyAllTitle'),
              t('admin.comments.emptyAllBody'),
            )}
          </div>
        )}

        {/* Tab 3: Reports */}
        {activeTab === 'reports' && (
          <div className="space-y-3">
            {reports.length === 0 ? (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center space-y-1.5">
                <p className="text-sm font-bold text-[var(--color-text)]">
                  {t('admin.comments.reports.emptyTitle')}
                </p>
                <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('admin.comments.reports.emptyBody')}
                </p>
              </div>
            ) : (
              reports.map((row) => (
                <article
                  key={row.report.id}
                  className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 sm:p-5 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Flag
                          className="w-4 h-4 text-[var(--color-error-text)] shrink-0"
                          aria-hidden="true"
                        />
                        <span className="text-sm font-bold text-[var(--color-text)]">
                          {row.reporterDisplayName}
                        </span>
                        <span className="text-xs text-[var(--color-muted)] tabular-nums-strict">
                          {formatJalaliDateTimePersian(row.report.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--color-error-text)] font-medium break-words">
                        {row.report.reason}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {row.comment &&
                        row.comment.status !== CommentStatus.Hidden && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isBusyAction}
                            onClick={() => void handleHide(row.comment!.id)}
                            startIcon={<EyeOff className="w-3.5 h-3.5" />}
                          >
                            {t('admin.comments.reports.action.hideComment')}
                          </Button>
                        )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isBusyAction}
                        onClick={() => void handleDismissReport(row.report.id)}
                        startIcon={<X className="w-3.5 h-3.5" />}
                      >
                        {t('admin.comments.reports.action.dismiss')}
                      </Button>
                    </div>
                  </div>

                  {row.comment && (
                    <div className="bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--radius-control)] p-3 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
                        <span className="font-semibold text-[var(--color-text)]">
                          {row.commentAuthorDisplayName}
                        </span>
                        {row.contentTitle && row.contentSlug && (
                          <a
                            href={`#/content/${encodeURIComponent(row.contentSlug)}`}
                            className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline"
                          >
                            <span>{row.contentTitle}</span>
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </a>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">
                        {row.comment.body}
                      </p>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        )}

        {/* Tab 4: Blocked Words */}
        {activeTab === 'blockedWords' && (
          <div className="space-y-5">
            <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-5 sm:p-6 space-y-4">
              <div className="space-y-1">
                <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                  <ShieldBan
                    className="w-5 h-5 text-[var(--color-primary)] shrink-0"
                    aria-hidden="true"
                  />
                  <span>{t('admin.comments.blockedWords.title')}</span>
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                  {t('admin.comments.blockedWords.subtitle')}
                </p>
              </div>

              <form
                onSubmit={(e) => void handleAddBlockedWord(e)}
                className="flex flex-col sm:flex-row sm:items-end gap-3"
              >
                <div className="flex-1">
                  <FormField
                    id="blocked-word-input"
                    label={t('admin.comments.blockedWords.inputLabel')}
                    value={newWordInput}
                    onChange={setNewWordInput}
                    placeholder={t('admin.comments.blockedWords.inputPlaceholder')}
                  />
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isAddingWord || newWordInput.trim().length < 2}
                  startIcon={<Plus className="w-4 h-4" />}
                >
                  {isAddingWord
                    ? t('admin.comments.blockedWords.addingButton')
                    : t('admin.comments.blockedWords.addButton')}
                </Button>
              </form>
            </section>

            <Table
              columns={blockedWordColumns}
              rows={isLoading ? [] : blockedWords}
              getRowKey={(row) => String(row.id)}
              emptyText={t('admin.comments.blockedWords.empty')}
            />
          </div>
        )}
      </div>

      {/* SuperAdmin-only Hard Delete Confirmation Modal */}
      <Modal
        open={hardDeleteTarget !== null}
        onClose={() => {
          if (!isBusyAction) {
            setHardDeleteTarget(null);
          }
        }}
        title={t('admin.comments.confirmDelete.title')}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={isBusyAction}
              onClick={() => setHardDeleteTarget(null)}
            >
              {t('admin.comments.confirmDelete.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={isBusyAction}
              onClick={() => void handleConfirmHardDelete()}
            >
              {t('admin.comments.confirmDelete.submit')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          {t('admin.comments.confirmDelete.body', {
            author: hardDeleteTarget?.authorDisplayName ?? '',
          })}
        </p>
      </Modal>
    </AdminLayout>
  );
}
