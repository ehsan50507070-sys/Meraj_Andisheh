import {
  Clock,
  Flag,
  LogIn,
  MessageSquare,
  Send,
  ShieldAlert,
  UserPlus,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CommentStatus } from '../../core/domain/comments';
import {
  COMMENT_REPORT_MAX_LENGTH,
  DEFAULT_COMMENT_MAX_LENGTH,
  type PublicCommentView,
} from '../../core/services/commentService';
import { useAuth } from '../auth/AuthContext';
import { useAge } from '../context/AgeContext';
import { Alert, Button, FormField, Modal, Tag } from './ui';
import type { ResourceKey } from '../resources/fa';
import { formatJalaliDateTimePersian, toPersianDigits } from '../resources/formatters';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';

export interface ContentCommentsSectionProps {
  contentId: number;
  contentSlug: string;
}

export function ContentCommentsSection({
  contentId,
  contentSlug,
}: ContentCommentsSectionProps) {
  const { currentUser, isAuthReady, isCommentsEnabled } = useAuth();
  const { activeAgeGroups } = useAge();

  const [isLoading, setIsLoading] = useState(true);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [maxLength, setMaxLength] = useState(DEFAULT_COMMENT_MAX_LENGTH);
  const [comments, setComments] = useState<PublicCommentView[]>([]);

  const [body, setBody] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState<{
    variant: 'success' | 'error';
    message: string;
  } | null>(null);

  const [reportTarget, setReportTarget] = useState<PublicCommentView | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [isReporting, setIsReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<number>>(new Set());

  const isActiveMember = Boolean(
    currentUser && currentUser.isActive && !currentUser.isDeleted,
  );
  const profileAgeGroup = currentUser?.ageGroupId
    ? activeAgeGroups.find((g) => g.id === currentUser.ageGroupId) ?? null
    : null;
  const isChildAuthor = profileAgeGroup?.key === 'child';

  const loadComments = useCallback(async () => {
    if (!isAuthReady) {
      return;
    }
    setIsLoading(true);
    try {
      const result = await appContainer.commentService.listPublicCommentsForContentAsync(
        contentId,
        currentUser,
      );
      setFeatureEnabled(result.enabled);
      setMaxLength(result.maxLength);
      setComments(result.comments);
    } finally {
      setIsLoading(false);
    }
  }, [contentId, currentUser, isAuthReady]);

  useEffect(() => {
    void loadComments();
  }, [loadComments, isCommentsEnabled]);

  if (!isCommentsEnabled || (!isLoading && !featureEnabled)) {
    return null;
  }

  const returnUrl = `/content/${encodeURIComponent(contentSlug)}`;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitFeedback(null);
    setIsSubmitting(true);

    try {
      const res = await appContainer.commentService.submitCommentAsync(
        currentUser,
        contentId,
        body,
      );

      if (!res.ok) {
        const msgKey = (res.messageKey ?? 'comments.error.empty') as ResourceKey;
        setSubmitFeedback({
          variant: 'error',
          message: t(msgKey, { max: toPersianDigits(res.maxLength ?? maxLength) }),
        });
        return;
      }

      setBody('');
      const isPending = res.comment?.status === CommentStatus.Pending;
      setSubmitFeedback({
        variant: 'success',
        message: isPending
          ? t('comments.form.pendingSuccess')
          : t('comments.form.publishedSuccess'),
      });
      await loadComments();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenReport = (comment: PublicCommentView) => {
    if (!isActiveMember) {
      navigateToHash(`/account/login?returnUrl=${encodeURIComponent(returnUrl)}`);
      return;
    }
    setReportTarget(comment);
    setReportReason('');
    setReportError(null);
  };

  const handleSubmitReport = async (event: FormEvent) => {
    event.preventDefault();
    if (!reportTarget) {
      return;
    }
    setReportError(null);
    setIsReporting(true);

    try {
      const res = await appContainer.commentService.reportCommentAsync(
        currentUser,
        reportTarget.id,
        reportReason,
      );

      if (!res.ok) {
        const msgKey = (res.messageKey ?? 'comments.report.error.empty') as ResourceKey;
        setReportError(t(msgKey));
        if (res.errorCode === 'ALREADY_REPORTED') {
          setReportedIds((prev) => new Set(prev).add(reportTarget.id));
        }
        return;
      }

      setReportedIds((prev) => new Set(prev).add(reportTarget.id));
      setReportTarget(null);
      setReportReason('');
      setReportNotice(t('comments.report.successMessage'));
    } finally {
      setIsReporting(false);
    }
  };

  return (
    <section
      aria-labelledby="content-comments-heading"
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-8 space-y-6"
    >
      {/* Section Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[var(--color-border)]">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
            <MessageSquare
              className="w-5 h-5 text-[var(--color-primary)]"
              aria-hidden="true"
            />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="content-comments-heading"
                className="text-base sm:text-lg font-bold text-[var(--color-text)]"
              >
                {t('comments.section.title')}
              </h2>
              <Tag
                label={t('comments.section.countBadge', {
                  count: toPersianDigits(comments.length),
                })}
                variant="neutral"
              />
            </div>
            <p className="text-xs sm:text-sm text-[var(--color-muted)]">
              {t('comments.section.subtitle')}
            </p>
          </div>
        </div>
      </div>

      {/* Submission Box: Guest CTA vs Authenticated Form */}
      {!isActiveMember ? (
        <div className="rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-bold text-[var(--color-text)]">
              {t('comments.guest.title')}
            </p>
            <p className="text-xs sm:text-sm text-[var(--color-muted)]">
              {t('comments.guest.subtitle')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                navigateToHash(
                  `/account/login?returnUrl=${encodeURIComponent(returnUrl)}`,
                )
              }
              startIcon={<LogIn className="w-4 h-4" />}
            >
              {t('comments.guest.loginButton')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigateToHash('/account/register')}
              startIcon={<UserPlus className="w-4 h-4" />}
            >
              {t('comments.guest.registerButton')}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {isChildAuthor && (
            <Alert
              variant="info"
              message={t('comments.form.childSafetyNotice')}
            />
          )}

          {submitFeedback && (
            <Alert
              variant={submitFeedback.variant}
              message={submitFeedback.message}
              onDismiss={() => setSubmitFeedback(null)}
            />
          )}

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="comment-body-input"
                className="text-sm font-semibold text-[var(--color-text)]"
              >
                {t('comments.form.label')}
              </label>
              <span
                className={`text-xs tabular-nums-strict font-medium ${
                  body.trim().length > maxLength
                    ? 'text-[var(--color-error-text)]'
                    : 'text-[var(--color-muted)]'
                }`}
              >
                {t('comments.form.charCounter', {
                  current: toPersianDigits(body.length),
                  max: toPersianDigits(maxLength),
                })}
              </span>
            </div>

            <textarea
              id="comment-body-input"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('comments.form.placeholder')}
              disabled={isSubmitting}
              className="w-full px-3.5 py-2.5 text-sm leading-relaxed rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border-strong)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)] transition-colors"
            />
            <p className="text-xs text-[var(--color-muted)]">
              {t('comments.form.noLinksHint')}
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting || body.trim().length === 0}
              startIcon={<Send className="w-4 h-4" />}
            >
              {isSubmitting
                ? t('comments.form.submittingButton')
                : t('comments.form.submitButton')}
            </Button>
          </div>
        </form>
      )}

      {reportNotice && (
        <Alert
          variant="success"
          message={reportNotice}
          onDismiss={() => setReportNotice(null)}
        />
      )}

      {/* Comments List */}
      {comments.length === 0 ? (
        <div className="py-8 px-4 text-center rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] space-y-1.5">
          <p className="text-sm font-bold text-[var(--color-text)]">
            {t('comments.section.emptyTitle')}
          </p>
          <p className="text-xs sm:text-sm text-[var(--color-muted)]">
            {t('comments.section.emptyBody')}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {comments.map((comment) => {
            const isReportedInSession = reportedIds.has(comment.id);
            return (
              <li key={comment.id} className="py-4 first:pt-2 last:pb-1 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-sm font-bold ${
                        comment.isAuthorDeleted
                          ? 'text-[var(--color-muted)]'
                          : 'text-[var(--color-text)]'
                      }`}
                    >
                      {comment.authorDisplayName}
                    </span>

                    {comment.isOwnPending && (
                      <Tag
                        label={t('comments.item.ownPendingBadge')}
                        variant="warning"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)] tabular-nums-strict">
                      <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>{formatJalaliDateTimePersian(comment.createdAt)}</span>
                    </span>

                    {comment.status === CommentStatus.Published && (
                      isReportedInSession ? (
                        <Tag
                          label={t('comments.item.reportedBadge')}
                          variant="neutral"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleOpenReport(comment)}
                          className="inline-flex items-center gap-1 min-h-[32px] px-2.5 py-1 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-error-text)] hover:bg-[var(--color-surface-alt)] rounded-[var(--radius-control)] transition-colors"
                        >
                          <Flag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>{t('comments.item.reportButton')}</span>
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Always rendered strictly as plain text without HTML injection */}
                <p className="text-sm text-[var(--color-text)] leading-relaxed whitespace-pre-wrap break-words">
                  {comment.body}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* Report Modal */}
      <Modal
        open={reportTarget !== null}
        onClose={() => {
          if (!isReporting) {
            setReportTarget(null);
            setReportError(null);
          }
        }}
        title={t('comments.report.modalTitle')}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={isReporting}
              onClick={() => {
                setReportTarget(null);
                setReportError(null);
              }}
            >
              {t('comments.report.cancelButton')}
            </Button>
            <Button
              type="submit"
              form="comment-report-form"
              variant="danger"
              disabled={isReporting || reportReason.trim().length === 0}
              startIcon={<ShieldAlert className="w-4 h-4" />}
            >
              {isReporting
                ? t('comments.report.submittingButton')
                : t('comments.report.submitButton')}
            </Button>
          </>
        }
      >
        <form
          id="comment-report-form"
          onSubmit={(e) => void handleSubmitReport(e)}
          className="space-y-4"
        >
          <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
            {t('comments.report.modalSubtitle')}
          </p>

          {reportError && <Alert variant="error" message={reportError} />}

          <div className="space-y-1.5">
            <FormField
              id="comment-report-reason"
              label={t('comments.report.reasonLabel')}
              kind="textarea"
              rows={3}
              value={reportReason}
              onChange={setReportReason}
              placeholder={t('comments.report.reasonPlaceholder')}
              required
            />
            <div className="flex justify-end">
              <span
                className={`text-xs tabular-nums-strict ${
                  reportReason.trim().length > COMMENT_REPORT_MAX_LENGTH
                    ? 'text-[var(--color-error-text)]'
                    : 'text-[var(--color-muted)]'
                }`}
              >
                {t('comments.report.charCounter', {
                  current: toPersianDigits(reportReason.length),
                })}
              </span>
            </div>
          </div>
        </form>
      </Modal>
    </section>
  );
}
