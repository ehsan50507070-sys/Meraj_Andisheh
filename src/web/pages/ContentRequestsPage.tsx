import { Inbox, LogIn, MessageSquarePlus, Send, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  MAX_OPEN_CONTENT_REQUESTS,
  REQUEST_DESCRIPTION_MAX_LENGTH,
  REQUEST_TITLE_MAX_LENGTH,
  type UserContentRequestView,
} from '../../core/services/contentRequestService';
import { useAuth } from '../auth/AuthContext';
import { UserRequestsList } from '../components/UserRequestsList';
import { Alert, Button, Tag } from '../components/ui';
import { MainLayout } from '../layouts/MainLayout';
import type { ResourceKey } from '../resources/fa';
import { toPersianDigits } from '../resources/formatters';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';
import { NotFoundPage } from './NotFoundPage';

export interface ContentRequestsPageProps {
  currentRoute: string;
}

export function ContentRequestsPage({ currentRoute }: ContentRequestsPageProps) {
  const { currentUser, isAuthReady, isContentRequestsEnabled } = useAuth();

  const [requests, setRequests] = useState<UserContentRequestView[]>([]);
  const [openCount, setOpenCount] = useState<number>(0);
  const [maxOpen, setMaxOpen] = useState<number>(MAX_OPEN_CONTENT_REQUESTS);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);

  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [link, setLink] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitSuccessMsg, setSubmitSuccessMsg] = useState<string | null>(null);
  const [submitErrorMsg, setSubmitErrorMsg] = useState<string | null>(null);

  const isActiveMember = Boolean(
    currentUser && currentUser.isActive && !currentUser.isDeleted,
  );

  const loadUserRequests = useCallback(async () => {
    if (!isAuthReady || !isContentRequestsEnabled || !currentUser || !isActiveMember) {
      setRequests([]);
      setOpenCount(0);
      return;
    }

    setIsLoadingList(true);
    try {
      await appContainer.ensureInitializedAtStartup();
      const res =
        await appContainer.contentRequestService.listUserContentRequestsAsync(
          currentUser,
          currentUser.id,
        );
      if (res.ok && res.items) {
        setRequests(res.items);
        setOpenCount(res.openCount ?? 0);
        setMaxOpen(res.maxOpen ?? MAX_OPEN_CONTENT_REQUESTS);
      } else {
        setRequests([]);
      }
    } finally {
      setIsLoadingList(false);
    }
  }, [currentUser, isActiveMember, isAuthReady, isContentRequestsEnabled]);

  useEffect(() => {
    void loadUserRequests();
  }, [loadUserRequests]);

  if (!isAuthReady) {
    return (
      <MainLayout currentRoute={currentRoute}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('requests.list.loading')}
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!isContentRequestsEnabled) {
    return <NotFoundPage currentRoute={currentRoute} />;
  }

  const isQuotaFull = openCount >= maxOpen;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentUser || isSubmitting || isQuotaFull) {
      return;
    }

    setSubmitSuccessMsg(null);
    setSubmitErrorMsg(null);
    setIsSubmitting(true);

    try {
      const res =
        await appContainer.contentRequestService.submitContentRequestAsync(
          currentUser,
          {
            title,
            description,
            link: link.trim() || null,
          },
        );

      if (!res.ok) {
        if (res.openCount !== undefined) {
          setOpenCount(res.openCount);
        }
        setSubmitErrorMsg(
          t(
            (res.messageKey ?? 'requests.error.titleInvalid') as ResourceKey,
          ),
        );
        return;
      }

      setTitle('');
      setDescription('');
      setLink('');
      setSubmitSuccessMsg(t('requests.form.submitSuccess'));
      await loadUserRequests();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Page Heading */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
              <MessageSquarePlus
                className="w-5 h-5 text-[var(--color-primary)]"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <h1 className="text-lg sm:text-2xl font-bold text-[var(--color-text)]">
                {t('requests.page.title')}
              </h1>
              <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed max-w-2xl">
                {t('requests.page.subtitle')}
              </p>
            </div>
          </div>

          {isActiveMember && (
            <Tag
              label={t('requests.page.quotaBadge', {
                open: toPersianDigits(openCount),
                max: toPersianDigits(maxOpen),
              })}
              variant={isQuotaFull ? 'warning' : 'primary'}
            />
          )}
        </section>

        {!isActiveMember ? (
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 sm:p-8 text-center space-y-4">
            <Inbox
              className="w-10 h-10 mx-auto text-[var(--color-primary)]"
              aria-hidden="true"
            />
            <div className="space-y-1.5 max-w-lg mx-auto">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                {t('requests.guest.title')}
              </h2>
              <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                {t('requests.guest.subtitle')}
              </p>
            </div>

            <div className="pt-1 flex flex-wrap items-center justify-center gap-3">
              <Button
                type="button"
                variant="primary"
                startIcon={<LogIn className="w-4 h-4" />}
                onClick={() =>
                  navigateToHash(
                    `/account/login?returnUrl=${encodeURIComponent('#/requests')}`,
                  )
                }
              >
                {t('requests.guest.loginButton')}
              </Button>
              <Button
                type="button"
                variant="outline"
                startIcon={<UserPlus className="w-4 h-4" />}
                onClick={() => navigateToHash('/account/register')}
              >
                {t('requests.guest.registerButton')}
              </Button>
            </div>
          </section>
        ) : (
          <>
            {/* Request Submission Form */}
            <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                {t('requests.form.sectionTitle')}
              </h2>

              {isQuotaFull && (
                <Alert
                  variant="warning"
                  title={t('requests.page.quotaReachedAlertTitle')}
                  message={t('requests.page.quotaReachedAlertBody')}
                />
              )}

              {submitErrorMsg && (
                <Alert
                  variant="error"
                  message={submitErrorMsg}
                  onDismiss={() => setSubmitErrorMsg(null)}
                />
              )}

              {submitSuccessMsg && (
                <Alert
                  variant="success"
                  message={submitSuccessMsg}
                  onDismiss={() => setSubmitSuccessMsg(null)}
                />
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="content-request-title"
                    className="block text-sm font-medium text-[var(--color-text)]"
                  >
                    <span>{t('requests.form.titleLabel')}</span>
                    <span className="text-[var(--color-error-text)] mr-1" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <input
                    id="content-request-title"
                    type="text"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setSubmitErrorMsg(null);
                    }}
                    placeholder={t('requests.form.titlePlaceholder')}
                    maxLength={REQUEST_TITLE_MAX_LENGTH}
                    disabled={isSubmitting || isQuotaFull}
                    required
                    className="w-full min-h-[42px] rounded-[var(--radius-control)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] border border-[var(--color-border-strong)] hover:border-[var(--color-muted)] transition-colors duration-150 px-3.5 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                  <p className="text-[11px] text-[var(--color-muted)] text-left tabular-nums-strict">
                    {t('requests.form.titleCounter', {
                      current: toPersianDigits(title.trim().length),
                    })}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="content-request-description"
                    className="block text-xs sm:text-sm font-medium text-[var(--color-text)]"
                  >
                    {t('requests.form.descriptionLabel')}{' '}
                    <span className="text-[var(--color-error-text)]">*</span>
                  </label>
                  <textarea
                    id="content-request-description"
                    rows={4}
                    maxLength={REQUEST_DESCRIPTION_MAX_LENGTH}
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      setSubmitErrorMsg(null);
                    }}
                    disabled={isSubmitting || isQuotaFull}
                    required
                    placeholder={t('requests.form.descriptionPlaceholder')}
                    className="w-full px-3.5 py-2.5 text-sm bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] border border-[var(--color-border)] rounded-[var(--radius-control)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
                  />
                  <p className="text-[11px] text-[var(--color-muted)] text-left tabular-nums-strict">
                    {t('requests.form.descriptionCounter', {
                      current: toPersianDigits(description.trim().length),
                    })}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="content-request-link"
                    className="block text-sm font-medium text-[var(--color-text)]"
                  >
                    {t('requests.form.linkLabel')}
                  </label>
                  <input
                    id="content-request-link"
                    type="text"
                    dir="ltr"
                    value={link}
                    onChange={(e) => {
                      setLink(e.target.value);
                      setSubmitErrorMsg(null);
                    }}
                    placeholder={t('requests.form.linkPlaceholder')}
                    disabled={isSubmitting || isQuotaFull}
                    className="w-full min-h-[42px] rounded-[var(--radius-control)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] border border-[var(--color-border-strong)] hover:border-[var(--color-muted)] transition-colors duration-150 px-3.5 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                  <p className="text-xs text-[var(--color-muted)]">
                    {t('requests.form.linkHint')}
                  </p>
                </div>

                <div className="pt-1 flex justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isSubmitting || isQuotaFull}
                    startIcon={<Send className="w-4 h-4" />}
                  >
                    {isSubmitting
                      ? t('requests.form.submittingButton')
                      : t('requests.form.submitButton')}
                  </Button>
                </div>
              </form>
            </section>

            {/* User Requests List */}
            <section className="space-y-3">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] tabular-nums-strict">
                {t('requests.list.sectionTitle', {
                  count: toPersianDigits(requests.length),
                })}
              </h2>

              <UserRequestsList items={requests} isLoading={isLoadingList} />
            </section>
          </>
        )}
      </div>
    </MainLayout>
  );
}
