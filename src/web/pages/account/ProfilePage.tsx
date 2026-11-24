import {
  AlertTriangle,
  Bookmark,
  BookOpen,
  Download,
  ExternalLink,
  KeyRound,
  MessageSquarePlus,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { DownloadKind } from '../../../core/domain/analytics';
import { DISPLAY_NAME_MAX_LENGTH } from '../../../core/services/authService';
import {
  MAX_OPEN_CONTENT_REQUESTS,
  type UserContentRequestView,
} from '../../../core/services/contentRequestService';
import type { BookmarkedContentEntry } from '../../../core/services/interactionService';
import type { PersonalizationStatus } from '../../../core/domain/personalization';
import type { DownloadHistoryEntry } from '../../../core/services/profileService';
import { resolveThemeKey } from '../../../core/services/themeService';
import { useAuth } from '../../auth/AuthContext';
import { UserRequestsList } from '../../components/UserRequestsList';
import { Alert, Button, ContentCard, FormField, Modal, Tag } from '../../components/ui';
import { useAge } from '../../context/AgeContext';
import { MainLayout } from '../../layouts/MainLayout';
import { formatAgeGroupWithRange } from '../../resources/ageGroupFormatters';
import {
  formatFileSizeParts,
  formatJalaliDatePersian,
  formatJalaliDateTimePersian,
  toPersianDigits,
} from '../../resources/formatters';
import type { ResourceKey } from '../../resources/fa';
import { t } from '../../resources/i18n';
import { navigateToHash } from '../../router/HashRouter';
import { appContainer } from '../../services/appContainer';
import { ThemeManager } from '../../theme/ThemeManager';

export interface ProfilePageProps {
  currentRoute: string;
}

type ProfileTabId =
  | 'info'
  | 'bookmarks'
  | 'downloads'
  | 'requests'
  | 'personalization'
  | 'danger';

const VALID_TABS: readonly ProfileTabId[] = [
  'info',
  'bookmarks',
  'downloads',
  'requests',
  'personalization',
  'danger',
];

function extractTabFromRoute(currentRoute: string): ProfileTabId {
  const qIndex = currentRoute.indexOf('?');
  if (qIndex === -1) {
    return 'info';
  }
  const params = new URLSearchParams(currentRoute.slice(qIndex + 1));
  const raw = params.get('tab');
  if (raw && (VALID_TABS as readonly string[]).includes(raw)) {
    return raw as ProfileTabId;
  }
  return 'info';
}

export function ProfilePage({ currentRoute }: ProfilePageProps) {
  const { currentUser, isAuthReady, isContentRequestsEnabled, refreshAuthState } =
    useAuth();
  const { activeAgeGroups, effectiveAgeGroup, refreshAgeGroups } = useAge();

  const rawActiveTab = useMemo(() => extractTabFromRoute(currentRoute), [currentRoute]);
  const activeTab: ProfileTabId =
    rawActiveTab === 'requests' && !isContentRequestsEnabled ? 'info' : rawActiveTab;

  // Tab 1: Edit profile state
  const [displayName, setDisplayName] = useState<string>('');
  const [selectedAgeGroupId, setSelectedAgeGroupId] = useState<string>('');
  const [isSavingProfile, setIsSavingProfile] = useState<boolean>(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState<string | null>(null);
  const [profileErrorMsg, setProfileErrorMsg] = useState<string | null>(null);

  // Tab 2: Bookmarks state
  const [bookmarks, setBookmarks] = useState<BookmarkedContentEntry[]>([]);
  const [bookmarkThumbs, setBookmarkThumbs] = useState<Record<number, string>>({});
  const [isLoadingBookmarks, setIsLoadingBookmarks] = useState<boolean>(false);
  const [removingBookmarkId, setRemovingBookmarkId] = useState<number | null>(null);

  // Tab 3: Download history state
  const [downloadHistory, setDownloadHistory] = useState<DownloadHistoryEntry[]>([]);
  const [isLoadingDownloads, setIsLoadingDownloads] = useState<boolean>(false);

  // Tab 4: User content requests state (Stage 17)
  const [userRequests, setUserRequests] = useState<UserContentRequestView[]>([]);
  const [openRequestsCount, setOpenRequestsCount] = useState<number>(0);
  const [maxOpenRequests, setMaxOpenRequests] = useState<number>(
    MAX_OPEN_CONTENT_REQUESTS,
  );
  const [isLoadingRequests, setIsLoadingRequests] = useState<boolean>(false);

  // Tab 5: Smart Personalization state (Stage 20)
  const [personalizationStatus, setPersonalizationStatus] =
    useState<PersonalizationStatus | null>(null);
  const [isLoadingPersonalization, setIsLoadingPersonalization] =
    useState<boolean>(false);
  const [isUpdatingPersonalization, setIsUpdatingPersonalization] =
    useState<boolean>(false);
  const [personalizationFeedback, setPersonalizationFeedback] = useState<{
    variant: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isClearPersonalizationModalOpen, setIsClearPersonalizationModalOpen] =
    useState<boolean>(false);
  const [isClearingPersonalization, setIsClearingPersonalization] =
    useState<boolean>(false);

  // Tab 6: Danger zone & account deletion modal state
  const [isLastSuperAdmin, setIsLastSuperAdmin] = useState<boolean>(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [deletePassword, setDeletePassword] = useState<string>('');
  const [deleteOtpCode, setDeleteOtpCode] = useState<string>('');
  const [otpCooldownSeconds, setOtpCooldownSeconds] = useState<number>(0);
  const [otpSentNotice, setOtpSentNotice] = useState<string | null>(null);
  const [isSendingOtp, setIsSendingOtp] = useState<boolean>(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState<boolean>(false);
  const [deleteErrorMsg, setDeleteErrorMsg] = useState<string | null>(null);

  // Route guard: redirect guests cleanly with exact returnUrl
  useEffect(() => {
    if (!isAuthReady) {
      return;
    }
    if (!currentUser || !currentUser.isActive || currentUser.isDeleted) {
      const targetReturnHash = currentRoute.startsWith('#')
        ? currentRoute
        : `#${currentRoute.startsWith('/') ? currentRoute : `/${currentRoute}`}`;
      navigateToHash(`/account/login?returnUrl=${encodeURIComponent(targetReturnHash)}`);
    }
  }, [isAuthReady, currentUser, currentRoute]);

  // Sync form inputs from authenticated user & age groups
  useEffect(() => {
    if (!currentUser) {
      return;
    }
    setDisplayName(currentUser.displayName);
    const preferredId =
      currentUser.ageGroupId ??
      effectiveAgeGroup?.id ??
      (activeAgeGroups[0]?.id ?? null);
    if (preferredId !== null) {
      setSelectedAgeGroupId(String(preferredId));
    }
  }, [currentUser, effectiveAgeGroup, activeAgeGroups]);

  // Check SuperAdmin last-admin rule lazily
  useEffect(() => {
    let active = true;
    if (!currentUser || currentUser.role !== 'SuperAdmin') {
      setIsLastSuperAdmin(false);
      return;
    }
    void (async () => {
      await appContainer.ensureInitializedAtStartup();
      const users = await appContainer.authRepository.getAllUsers();
      const activeCount = users.filter(
        (u) => u.role === 'SuperAdmin' && u.isActive && !u.isDeleted,
      ).length;
      if (active) {
        setIsLastSuperAdmin(activeCount <= 1);
      }
    })();
    return () => {
      active = false;
    };
  }, [currentUser]);

  // Load user bookmarks & resolve thumbnails
  useEffect(() => {
    if (!isAuthReady || !currentUser || !currentUser.isActive || currentUser.isDeleted) {
      setBookmarks([]);
      return;
    }

    let active = true;
    const createdUrls: string[] = [];

    const loadBookmarks = async () => {
      setIsLoadingBookmarks(true);
      try {
        await appContainer.ensureInitializedAtStartup();
        const res = await appContainer.interactionService.getUserBookmarksAsync(
          currentUser,
          currentUser.id,
          effectiveAgeGroup,
        );
        if (!active) {
          return;
        }
        if (!res.ok) {
          setBookmarks([]);
          return;
        }
        setBookmarks(res.items);

        const nextThumbs: Record<number, string> = {};
        await Promise.all(
          res.items.map(async (entry) => {
            if (!entry.item.thumbnailKey) {
              return;
            }
            const media = await appContainer.fileUploadService.openPublicMediaAsync(
              entry.item.thumbnailKey,
            );
            if (!active || !media.ok || !media.bytes || !media.metadata) {
              return;
            }
            const copy = new Uint8Array(media.bytes.byteLength);
            copy.set(media.bytes);
            const blob = new Blob([copy.buffer], { type: media.metadata.mimeType });
            const url = URL.createObjectURL(blob);
            createdUrls.push(url);
            nextThumbs[entry.item.id] = url;
          }),
        );
        if (active) {
          setBookmarkThumbs(nextThumbs);
        }
      } finally {
        if (active) {
          setIsLoadingBookmarks(false);
        }
      }
    };

    void loadBookmarks();

    return () => {
      active = false;
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [isAuthReady, currentUser, effectiveAgeGroup]);

  // Load user download history when downloads tab or user changes
  useEffect(() => {
    if (!isAuthReady || !currentUser || !currentUser.isActive || currentUser.isDeleted) {
      setDownloadHistory([]);
      return;
    }

    let active = true;
    const loadDownloads = async () => {
      setIsLoadingDownloads(true);
      try {
        await appContainer.ensureInitializedAtStartup();
        const res = await appContainer.profileService.getUserDownloadHistoryAsync(
          currentUser,
          currentUser.id,
        );
        if (active && res.ok) {
          setDownloadHistory(res.entries);
        }
      } finally {
        if (active) {
          setIsLoadingDownloads(false);
        }
      }
    };

    void loadDownloads();
    return () => {
      active = false;
    };
  }, [isAuthReady, currentUser, activeTab]);

  // Load user content requests when feature is enabled
  useEffect(() => {
    if (
      !isAuthReady ||
      !isContentRequestsEnabled ||
      !currentUser ||
      !currentUser.isActive ||
      currentUser.isDeleted
    ) {
      setUserRequests([]);
      setOpenRequestsCount(0);
      return;
    }

    let active = true;
    const loadRequests = async () => {
      setIsLoadingRequests(true);
      try {
        await appContainer.ensureInitializedAtStartup();
        const res =
          await appContainer.contentRequestService.listUserContentRequestsAsync(
            currentUser,
            currentUser.id,
          );
        if (active && res.ok && res.items) {
          setUserRequests(res.items);
          setOpenRequestsCount(res.openCount ?? 0);
          setMaxOpenRequests(res.maxOpen ?? MAX_OPEN_CONTENT_REQUESTS);
        }
      } finally {
        if (active) {
          setIsLoadingRequests(false);
        }
      }
    };

    void loadRequests();
    return () => {
      active = false;
    };
  }, [isAuthReady, isContentRequestsEnabled, currentUser, activeTab]);

  // Load user personalization status & top root topics (Stage 20)
  useEffect(() => {
    if (!isAuthReady || !currentUser || !currentUser.isActive || currentUser.isDeleted) {
      setPersonalizationStatus(null);
      return;
    }

    let active = true;
    const loadPersonalization = async () => {
      setIsLoadingPersonalization(true);
      try {
        await appContainer.ensureInitializedAtStartup();
        const status =
          await appContainer.personalizationService.getPersonalizationStatusAsync(
            currentUser,
          );
        if (active) {
          setPersonalizationStatus(status);
        }
      } finally {
        if (active) {
          setIsLoadingPersonalization(false);
        }
      }
    };

    void loadPersonalization();

    const handlePersonalizationChanged = () => {
      void loadPersonalization();
    };
    window.addEventListener(
      'meraj:personalization-changed',
      handlePersonalizationChanged,
    );
    return () => {
      active = false;
      window.removeEventListener(
        'meraj:personalization-changed',
        handlePersonalizationChanged,
      );
    };
  }, [isAuthReady, currentUser, activeTab]);

  // OTP countdown timer inside delete confirmation modal
  useEffect(() => {
    if (otpCooldownSeconds <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setOtpCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [otpCooldownSeconds]);

  const handleSelectTab = (tabId: ProfileTabId) => {
    navigateToHash(tabId === 'info' ? '/account/profile' : `/account/profile?tab=${tabId}`);
  };

  const handleSaveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentUser) {
      return;
    }
    setProfileSuccessMsg(null);
    setProfileErrorMsg(null);
    setIsSavingProfile(true);
    try {
      const parsedAgeId = Number(selectedAgeGroupId);
      const res = await appContainer.profileService.updateProfileAsync(currentUser, {
        displayName,
        ageGroupId: parsedAgeId,
      });
      if (!res.ok) {
        setProfileErrorMsg(t(`profile.info.error.${res.errorCode}` as ResourceKey));
        return;
      }

      appContainer.agePreferenceStorage.setAgeKey(res.ageGroup.key);
      ThemeManager.setTheme(resolveThemeKey(res.ageGroup.themeKey), false);
      await refreshAuthState();
      await refreshAgeGroups();

      setProfileSuccessMsg(
        t('profile.info.savedSuccess', { ageName: res.ageGroup.name }),
      );
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleRemoveBookmark = async (contentId: number) => {
    if (!currentUser || removingBookmarkId !== null) {
      return;
    }
    setRemovingBookmarkId(contentId);
    try {
      const res = await appContainer.interactionService.toggleBookmarkAsync(
        currentUser,
        contentId,
      );
      if (res.ok && !res.bookmarked) {
        setBookmarks((prev) => prev.filter((b) => b.item.id !== contentId));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('meraj:bookmarks-changed'));
        }
      }
    } finally {
      setRemovingBookmarkId(null);
    }
  };

  const openDeleteModal = () => {
    setDeletePassword('');
    setDeleteOtpCode('');
    setOtpSentNotice(null);
    setDeleteErrorMsg(null);
    setIsDeleteModalOpen(true);
  };

  const handleRequestDeleteOtp = async () => {
    if (!currentUser?.phoneNumber && !currentUser?.normalizedPhoneNumber) {
      return;
    }
    const targetPhone = currentUser.phoneNumber ?? currentUser.normalizedPhoneNumber ?? '';
    setDeleteErrorMsg(null);
    setOtpSentNotice(null);
    setIsSendingOtp(true);
    try {
      const res = await appContainer.otpService.requestOtp(targetPhone);
      if (!res.ok) {
        if (res.errorCode === 'OTP_COOLDOWN' && res.remainingSeconds) {
          setOtpCooldownSeconds(res.remainingSeconds);
          setDeleteErrorMsg(
            t('auth.otp.error.cooldown', {
              seconds: toPersianDigits(res.remainingSeconds),
            }),
          );
          return;
        }
        setDeleteErrorMsg(t((res.messageKey ?? 'auth.otp.error.invalidFormat') as ResourceKey));
        return;
      }
      setOtpCooldownSeconds(res.data?.cooldownSeconds ?? 60);
      setOtpSentNotice(t('profile.danger.otpSentSuccess'));
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleConfirmDeleteAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentUser || isDeletingAccount) {
      return;
    }
    setDeleteErrorMsg(null);
    setIsDeletingAccount(true);
    try {
      const hasPassword = Boolean(currentUser.passwordHash && currentUser.passwordSalt);
      const confirmation = hasPassword
        ? { password: deletePassword }
        : { otpCode: deleteOtpCode };

      const res = await appContainer.profileService.deleteAccountAsync(
        currentUser,
        confirmation,
      );

      if (!res.ok) {
        setDeleteErrorMsg(t(`profile.danger.error.${res.errorCode}` as ResourceKey));
        return;
      }

      setIsDeleteModalOpen(false);
      appContainer.guestAffinityStorage.clearGuestAffinities();
      await refreshAuthState();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('meraj:bookmarks-changed'));
        window.dispatchEvent(new CustomEvent('meraj:personalization-changed'));
      }
      navigateToHash('/?accountDeleted=1');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleToggleUserPersonalization = async () => {
    if (!currentUser || isUpdatingPersonalization) {
      return;
    }
    setPersonalizationFeedback(null);
    setIsUpdatingPersonalization(true);
    try {
      const nextEnabled = !(
        personalizationStatus?.userEnabled ?? currentUser.personalizationEnabled
      );
      const res =
        await appContainer.personalizationService.setUserPersonalizationEnabledAsync(
          currentUser,
          nextEnabled,
        );
      if (res.ok) {
        await refreshAuthState();
        const updatedStatus =
          await appContainer.personalizationService.getPersonalizationStatusAsync(
            res.user ?? currentUser,
          );
        setPersonalizationStatus(updatedStatus);
        setPersonalizationFeedback({
          variant: 'success',
          message: nextEnabled
            ? t('profile.personalization.toggleSuccessOn')
            : t('profile.personalization.toggleSuccessOff'),
        });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('meraj:personalization-changed'));
        }
      }
    } finally {
      setIsUpdatingPersonalization(false);
    }
  };

  const handleConfirmClearPersonalization = async () => {
    if (!currentUser || isClearingPersonalization) {
      return;
    }
    setPersonalizationFeedback(null);
    setIsClearingPersonalization(true);
    try {
      const res =
        await appContainer.personalizationService.clearPersonalizationHistoryAsync(
          currentUser,
        );
      if (res.ok) {
        setIsClearPersonalizationModalOpen(false);
        const updatedStatus =
          await appContainer.personalizationService.getPersonalizationStatusAsync(
            currentUser,
          );
        setPersonalizationStatus(updatedStatus);
        setPersonalizationFeedback({
          variant: 'success',
          message: t('profile.personalization.clearSuccess', {
            count: toPersianDigits(res.deletedTopicsCount),
          }),
        });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('meraj:personalization-changed'));
        }
      }
    } finally {
      setIsClearingPersonalization(false);
    }
  };

  if (!isAuthReady || !currentUser || !currentUser.isActive || currentUser.isDeleted) {
    return (
      <MainLayout currentRoute={currentRoute}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('profile.loading')}
          </div>
        </div>
      </MainLayout>
    );
  }

  const hasPasswordAuth = Boolean(currentUser.passwordHash && currentUser.passwordSalt);
  const roleLabel = t(`profile.role.${currentUser.role}` as ResourceKey);

  const tabItems: Array<{
    id: ProfileTabId;
    label: string;
    icon: typeof UserIcon;
    danger?: boolean;
  }> = [
    { id: 'info', label: t('profile.tab.info'), icon: UserIcon },
    {
      id: 'bookmarks',
      label:
        bookmarks.length > 0
          ? t('profile.tab.bookmarksCount', { count: toPersianDigits(bookmarks.length) })
          : t('profile.tab.bookmarks'),
      icon: Bookmark,
    },
    { id: 'downloads', label: t('profile.tab.downloads'), icon: Download },
    ...(isContentRequestsEnabled
      ? [{ id: 'requests' as ProfileTabId, label: t('profile.tab.requests'), icon: MessageSquarePlus }]
      : []),
    { id: 'personalization', label: t('profile.tab.personalization'), icon: SlidersHorizontal },
    { id: 'danger', label: t('profile.tab.danger'), icon: Trash2, danger: true },
  ];

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Profile Header */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
              <UserIcon className="w-6 h-6 text-[var(--color-primary)]" aria-hidden="true" />
            </div>
            <div className="min-w-0 space-y-1">
              <h1 className="text-lg sm:text-2xl font-bold text-[var(--color-text)] truncate">
                {t('profile.pageTitle')}
              </h1>
              <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                {t('profile.pageSubtitle')}
              </p>
            </div>
          </div>

          <Tag label={roleLabel} variant="neutral" />
        </section>

        {/* Responsive Tab Navigation */}
        <nav
          aria-label={t('profile.tabs.ariaLabel')}
          className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-2 flex flex-wrap gap-1.5"
        >
          {tabItems.map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectTab(tab.id)}
                aria-current={isSelected ? 'page' : undefined}
                className={`inline-flex items-center gap-2 min-h-[40px] px-3 py-2 text-xs sm:text-sm font-medium rounded-[var(--radius-control)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] ${
                  isSelected
                    ? tab.danger
                      ? 'bg-[var(--color-error-bg)] text-[var(--color-error-text)] border border-[var(--color-error-border)] font-semibold'
                      : 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] font-semibold'
                    : tab.danger
                      ? 'text-[var(--color-error-text)] hover:bg-[var(--color-error-bg)]'
                      : 'text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Tab 1: Info & Edit */}
        {activeTab === 'info' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <section className="lg:col-span-5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                {t('profile.info.accountDetailsTitle')}
              </h2>

              <dl className="divide-y divide-[var(--color-border)] text-xs sm:text-sm">
                <div className="py-3 flex items-center justify-between gap-3">
                  <dt className="text-[var(--color-muted)]">{t('profile.info.emailLabel')}</dt>
                  <dd
                    dir={currentUser.email ? 'ltr' : 'rtl'}
                    className="font-medium text-[var(--color-text)] break-all text-left"
                  >
                    {currentUser.email ?? t('profile.info.notRegistered')}
                  </dd>
                </div>

                <div className="py-3 flex items-center justify-between gap-3">
                  <dt className="text-[var(--color-muted)]">{t('profile.info.phoneLabel')}</dt>
                  <dd
                    dir={currentUser.phoneNumber ? 'ltr' : 'rtl'}
                    className="font-medium text-[var(--color-text)] tabular-nums-strict text-left"
                  >
                    {currentUser.phoneNumber
                      ? toPersianDigits(currentUser.phoneNumber)
                      : t('profile.info.notRegistered')}
                  </dd>
                </div>

                <div className="py-3 flex items-center justify-between gap-3">
                  <dt className="text-[var(--color-muted)]">{t('profile.info.roleLabel')}</dt>
                  <dd className="font-semibold text-[var(--color-text)]">{roleLabel}</dd>
                </div>

                <div className="py-3 flex items-center justify-between gap-3">
                  <dt className="text-[var(--color-muted)]">{t('profile.info.joinedAtLabel')}</dt>
                  <dd className="font-medium text-[var(--color-text)] tabular-nums-strict">
                    {formatJalaliDatePersian(currentUser.createdAt)}
                  </dd>
                </div>
              </dl>

              {hasPasswordAuth && (
                <div className="pt-2 border-t border-[var(--color-border)]">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigateToHash('/account/change-password')}
                    startIcon={<KeyRound className="w-4 h-4" />}
                    className="w-full"
                  >
                    {t('profile.info.changePasswordButton')}
                  </Button>
                </div>
              )}
            </section>

            <section className="lg:col-span-7 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-5">
              <div className="space-y-1">
                <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                  {t('profile.info.editTitle')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                  {t('profile.info.editSubtitle')}
                </p>
              </div>

              {profileSuccessMsg && (
                <Alert
                  variant="success"
                  message={profileSuccessMsg}
                  onDismiss={() => setProfileSuccessMsg(null)}
                />
              )}

              {profileErrorMsg && (
                <Alert
                  variant="error"
                  message={profileErrorMsg}
                  onDismiss={() => setProfileErrorMsg(null)}
                />
              )}

              <form onSubmit={handleSaveProfile} className="space-y-4">
                <FormField
                  id="profile-display-name"
                  label={t('profile.info.displayNameLabel')}
                  value={displayName}
                  onChange={(value) => {
                    setDisplayName(value);
                    setProfileErrorMsg(null);
                  }}
                  placeholder={t('profile.info.displayNamePlaceholder')}
                  hint={t('profile.info.displayNameCounter', {
                    count: toPersianDigits(displayName.trim().length),
                  })}
                  error={
                    displayName.trim().length > DISPLAY_NAME_MAX_LENGTH
                      ? t('profile.info.error.INVALID_DISPLAY_NAME')
                      : undefined
                  }
                  required
                />

                <FormField
                  id="profile-age-group"
                  label={t('profile.info.ageGroupLabel')}
                  kind="select"
                  value={selectedAgeGroupId}
                  onChange={(value) => {
                    setSelectedAgeGroupId(value);
                    setProfileErrorMsg(null);
                  }}
                  options={activeAgeGroups.map((group) => ({
                    value: String(group.id),
                    label: formatAgeGroupWithRange(group),
                  }))}
                  required
                />

                <div className="pt-2 flex flex-wrap items-center justify-end gap-3">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isSavingProfile || displayName.trim().length > DISPLAY_NAME_MAX_LENGTH}
                  >
                    {isSavingProfile
                      ? t('profile.info.savingButton')
                      : t('profile.info.saveButton')}
                  </Button>
                </div>
              </form>
            </section>
          </div>
        )}

        {/* Tab 2: Bookmarks */}
        {activeTab === 'bookmarks' && (
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-5">
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] tabular-nums-strict">
                {t('profile.bookmarks.title', { count: toPersianDigits(bookmarks.length) })}
              </h2>
              <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                {t('profile.bookmarks.subtitle')}
              </p>
            </div>

            {effectiveAgeGroup?.key === 'child' && (
              <Alert variant="info" message={t('profile.bookmarks.childFilterNote')} />
            )}

            {isLoadingBookmarks ? (
              <div className="py-8 text-center text-sm text-[var(--color-muted)]">
                {t('profile.loading')}
              </div>
            ) : bookmarks.length === 0 ? (
              <div className="py-10 px-4 text-center space-y-3 border border-dashed border-[var(--color-border)] rounded-[var(--radius-control)]">
                <BookOpen className="w-8 h-8 mx-auto text-[var(--color-muted)]" aria-hidden="true" />
                <h3 className="text-base font-bold text-[var(--color-text)]">
                  {t('profile.bookmarks.emptyTitle')}
                </h3>
                <p className="text-xs sm:text-sm text-[var(--color-muted)] max-w-md mx-auto leading-relaxed">
                  {t('profile.bookmarks.emptyBody')}
                </p>
                <div className="pt-1">
                  <Button variant="primary" onClick={() => navigateToHash('/content')}>
                    {t('profile.bookmarks.browseBankButton')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
                {bookmarks.map((entry) => {
                  const formatKey = `content.format.${entry.item.format}` as ResourceKey;
                  const targetPath = `/content/${encodeURIComponent(entry.item.slug)}`;
                  return (
                    <div key={entry.item.id} className="flex flex-col gap-2">
                      <div className="flex-1">
                        <ContentCard
                          title={entry.item.title}
                          formatLabel={t(formatKey)}
                          durationMinutes={entry.item.readWatchMinutes ?? 0}
                          topicLabel={entry.primaryTopicName ?? t('homePreview.generalTopic')}
                          summary={entry.item.summary}
                          thumbnailUrl={bookmarkThumbs[entry.item.id]}
                          thumbnailAlt={entry.item.title}
                          onSelect={() => navigateToHash(targetPath)}
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                        <span className="text-xs text-[var(--color-muted)] tabular-nums-strict">
                          {t('profile.bookmarks.savedAtLabel', {
                            date: formatJalaliDatePersian(entry.bookmark.createdAt),
                          })}
                        </span>

                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => navigateToHash(targetPath)}
                            startIcon={<ExternalLink className="w-3.5 h-3.5" />}
                          >
                            {t('profile.bookmarks.openContentButton')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            disabled={removingBookmarkId === entry.item.id}
                            onClick={() => void handleRemoveBookmark(entry.item.id)}
                            startIcon={<Trash2 className="w-3.5 h-3.5" />}
                          >
                            {removingBookmarkId === entry.item.id
                              ? t('profile.bookmarks.removingButton')
                              : t('profile.bookmarks.removeButton')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Tab 3: Download History */}
        {activeTab === 'downloads' && (
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-5">
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] tabular-nums-strict">
                {t('profile.downloads.title', { count: toPersianDigits(downloadHistory.length) })}
              </h2>
              <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                {t('profile.downloads.subtitle')}
              </p>
            </div>

            {isLoadingDownloads ? (
              <div className="py-8 text-center text-sm text-[var(--color-muted)]">
                {t('profile.loading')}
              </div>
            ) : downloadHistory.length === 0 ? (
              <div className="py-10 px-4 text-center space-y-2 border border-dashed border-[var(--color-border)] rounded-[var(--radius-control)]">
                <Download className="w-8 h-8 mx-auto text-[var(--color-muted)]" aria-hidden="true" />
                <h3 className="text-base font-bold text-[var(--color-text)]">
                  {t('profile.downloads.emptyTitle')}
                </h3>
                <p className="text-xs sm:text-sm text-[var(--color-muted)] max-w-md mx-auto leading-relaxed">
                  {t('profile.downloads.emptyBody')}
                </p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto border border-[var(--color-border)] rounded-[var(--radius-control)]">
                  <table className="w-full text-right text-sm border-collapse">
                    <thead className="bg-[var(--color-surface-alt)] border-b border-[var(--color-border)] text-xs text-[var(--color-muted)]">
                      <tr>
                        <th className="py-3 px-4 font-semibold">{t('profile.downloads.col.content')}</th>
                        <th className="py-3 px-4 font-semibold">{t('profile.downloads.col.file')}</th>
                        <th className="py-3 px-4 font-semibold">{t('profile.downloads.col.kind')}</th>
                        <th className="py-3 px-4 font-semibold">{t('profile.downloads.col.occurredAt')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {downloadHistory.map((row) => {
                        const sizeParts = formatFileSizeParts(row.fileSizeBytes);
                        const kindLabel =
                          row.event.kind === DownloadKind.Story
                            ? t('profile.downloads.kind.story')
                            : t('profile.downloads.kind.file');

                        return (
                          <tr key={row.event.id} className="hover:bg-[var(--color-surface-alt)]">
                            <td className="py-3 px-4 font-medium text-[var(--color-text)]">
                              {row.isPubliclyAccessible && row.contentSlug ? (
                                <a
                                  href={`#/content/${encodeURIComponent(row.contentSlug)}`}
                                  className="text-[var(--color-primary)] hover:underline underline-offset-4"
                                >
                                  {row.contentTitle || t('profile.downloads.unavailableContent')}
                                </a>
                              ) : (
                                <span className="text-[var(--color-muted)]">
                                  {row.contentTitle || t('profile.downloads.unavailableContent')}
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4">
                              <div className="space-y-0.5">
                                <p dir="ltr" className="font-mono text-xs text-[var(--color-text)] break-all text-right">
                                  {row.fileName ??
                                    (row.event.kind === DownloadKind.Story
                                      ? t('profile.downloads.storyFileLabel')
                                      : t('profile.downloads.unknownFile'))}
                                </p>
                                {sizeParts && (
                                  <p className="text-xs text-[var(--color-muted)] tabular-nums-strict">
                                    {t(`contentDetail.sizeUnit.${sizeParts.unit}` as ResourceKey, {
                                      value: sizeParts.value,
                                    })}
                                  </p>
                                )}
                              </div>
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap">
                              <Tag label={kindLabel} variant="neutral" />
                            </td>

                            <td className="py-3 px-4 text-xs text-[var(--color-text)] tabular-nums-strict whitespace-nowrap">
                              {formatJalaliDateTimePersian(row.event.occurredAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards (360px friendly) */}
                <div className="md:hidden space-y-3">
                  {downloadHistory.map((row) => {
                    const sizeParts = formatFileSizeParts(row.fileSizeBytes);
                    const kindLabel =
                      row.event.kind === DownloadKind.Story
                        ? t('profile.downloads.kind.story')
                        : t('profile.downloads.kind.file');

                    return (
                      <article
                        key={row.event.id}
                        className="p-4 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold text-sm text-[var(--color-text)]">
                            {row.isPubliclyAccessible && row.contentSlug ? (
                              <a
                                href={`#/content/${encodeURIComponent(row.contentSlug)}`}
                                className="text-[var(--color-primary)] hover:underline underline-offset-4"
                              >
                                {row.contentTitle || t('profile.downloads.unavailableContent')}
                              </a>
                            ) : (
                              <span className="text-[var(--color-muted)]">
                                {row.contentTitle || t('profile.downloads.unavailableContent')}
                              </span>
                            )}
                          </div>
                          <Tag label={kindLabel} variant="neutral" />
                        </div>

                        <div className="text-xs text-[var(--color-muted)] space-y-1">
                          <p dir="ltr" className="font-mono text-[var(--color-text)] break-all text-right">
                            {row.fileName ??
                              (row.event.kind === DownloadKind.Story
                                ? t('profile.downloads.storyFileLabel')
                                : t('profile.downloads.unknownFile'))}
                          </p>
                          <div className="flex flex-wrap items-center justify-between gap-2 tabular-nums-strict pt-1">
                            <span>
                              {sizeParts
                                ? t(`contentDetail.sizeUnit.${sizeParts.unit}` as ResourceKey, {
                                    value: sizeParts.value,
                                  })
                                : '—'}
                            </span>
                            <span>{formatJalaliDateTimePersian(row.event.occurredAt)}</span>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        )}

        {/* Tab 4: My Requests (Stage 17) */}
        {activeTab === 'requests' && isContentRequestsEnabled && (
          <section className="space-y-5">
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <MessageSquarePlus
                    className="w-5 h-5 text-[var(--color-primary)] shrink-0"
                    aria-hidden="true"
                  />
                  <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                    {t('profile.requests.title')}
                  </h2>
                  <Tag
                    label={t('profile.requests.openQuotaBadge', {
                      open: toPersianDigits(openRequestsCount),
                      max: toPersianDigits(maxOpenRequests),
                    })}
                    variant={
                      openRequestsCount >= maxOpenRequests ? 'warning' : 'primary'
                    }
                  />
                </div>
                <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed max-w-2xl">
                  {t('profile.requests.subtitle')}
                </p>
              </div>

              <Button
                type="button"
                variant="primary"
                size="sm"
                startIcon={<MessageSquarePlus className="w-4 h-4" />}
                onClick={() => navigateToHash('/requests')}
              >
                {t('profile.requests.newRequestButton')}
              </Button>
            </div>

            <UserRequestsList items={userRequests} isLoading={isLoadingRequests} />
          </section>
        )}

        {/* Tab 5: Smart Personalization Settings (Stage 20) */}
        {activeTab === 'personalization' && (
          <section className="space-y-5">
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-7 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <SlidersHorizontal className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                  <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                    {t('profile.personalization.title')}
                  </h2>
                </div>
                <Tag
                  label={
                    personalizationStatus && !personalizationStatus.globalEnabled
                      ? t('profile.personalization.statusGlobalOff')
                      : (personalizationStatus?.effectiveEnabled ??
                            currentUser.personalizationEnabled)
                        ? t('profile.personalization.statusActive')
                        : t('profile.personalization.statusInactive')
                  }
                  variant={
                    personalizationStatus && !personalizationStatus.globalEnabled
                      ? 'warning'
                      : (personalizationStatus?.effectiveEnabled ??
                            currentUser.personalizationEnabled)
                        ? 'success'
                        : 'neutral'
                  }
                />
              </div>

              <p className="text-sm text-[var(--color-muted)] leading-relaxed max-w-2xl">
                {t('profile.personalization.desc')}
              </p>

              {personalizationFeedback && (
                <Alert
                  variant={personalizationFeedback.variant}
                  message={personalizationFeedback.message}
                  onDismiss={() => setPersonalizationFeedback(null)}
                />
              )}

              {personalizationStatus && !personalizationStatus.globalEnabled && (
                <Alert
                  variant="warning"
                  message={t('profile.personalization.globalDisabledNotice')}
                />
              )}

              <div className="p-4 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1 min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--color-text)]">
                    {t('profile.personalization.toggleLabel')}
                  </p>
                  <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                    {(personalizationStatus?.userEnabled ??
                      currentUser.personalizationEnabled)
                      ? t('profile.personalization.toggleOnHint')
                      : t('profile.personalization.toggleOffHint')}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={
                    personalizationStatus?.userEnabled ??
                    currentUser.personalizationEnabled
                  }
                  aria-label={t('profile.personalization.toggleSwitchAria')}
                  disabled={
                    isUpdatingPersonalization ||
                    (personalizationStatus !== null &&
                      !personalizationStatus.globalEnabled)
                  }
                  onClick={() => void handleToggleUserPersonalization()}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${
                    personalizationStatus !== null &&
                    !personalizationStatus.globalEnabled
                      ? 'bg-[var(--color-surface)] border-[var(--color-border)] opacity-60 cursor-not-allowed'
                      : (personalizationStatus?.userEnabled ??
                            currentUser.personalizationEnabled)
                        ? 'bg-[var(--color-primary-button)] border-transparent'
                        : 'bg-[var(--color-surface)] border-[var(--color-border-strong)]'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      (personalizationStatus?.userEnabled ??
                        currentUser.personalizationEnabled)
                        ? '-translate-x-6'
                        : '-translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <p className="text-xs text-[var(--color-muted)] tabular-nums-strict">
                {t('profile.personalization.thresholdHint', {
                  min: toPersianDigits(
                    personalizationStatus?.minViewsThreshold ?? 3,
                  ),
                })}
              </p>
            </div>

            {/* Top Root Topics Affinity List */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-7 space-y-4">
              <h3 className="text-sm sm:text-base font-bold text-[var(--color-text)]">
                {t('profile.personalization.topTopicsTitle')}
              </h3>

              {isLoadingPersonalization ? (
                <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('profile.loading')}
                </p>
              ) : !personalizationStatus ||
                personalizationStatus.topTopics.length === 0 ? (
                <div className="p-5 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] text-center space-y-1.5">
                  <p className="text-sm font-semibold text-[var(--color-text)]">
                    {t('profile.personalization.topTopicsEmptyTitle')}
                  </p>
                  <p className="text-xs text-[var(--color-muted)] max-w-md mx-auto leading-relaxed">
                    {t('profile.personalization.topTopicsEmptyBody')}
                  </p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {personalizationStatus.topTopics.map((topicScore) => {
                    const threshold = Math.max(
                      1,
                      personalizationStatus.minViewsThreshold,
                    );
                    const pct = Math.min(
                      100,
                      Math.round((topicScore.viewCount / threshold) * 100),
                    );
                    const qualified = topicScore.viewCount >= threshold;
                    return (
                      <li
                        key={topicScore.rootTopicId}
                        className="p-3.5 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-[var(--color-text)]">
                              {topicScore.rootTopicName}
                            </span>
                            {qualified && (
                              <Tag
                                label={t('profile.personalization.topicQualifiedBadge')}
                                variant="success"
                              />
                            )}
                          </div>
                          <span className="text-xs font-medium text-[var(--color-muted)] tabular-nums-strict">
                            {qualified
                              ? t('profile.personalization.topicScoreLabel', {
                                  count: toPersianDigits(topicScore.viewCount),
                                })
                              : t('profile.personalization.topicProgressLabel', {
                                  count: toPersianDigits(topicScore.viewCount),
                                  min: toPersianDigits(threshold),
                                })}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              qualified
                                ? 'bg-[var(--color-primary)]'
                                : 'bg-[var(--color-accent)]'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Clear Personalization History Section */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-7 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 min-w-0 flex-1">
                <h3 className="text-sm sm:text-base font-bold text-[var(--color-text)]">
                  {t('profile.personalization.clearTitle')}
                </h3>
                <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                  {t('profile.personalization.clearDesc')}
                </p>
              </div>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={
                  isClearingPersonalization ||
                  !personalizationStatus ||
                  personalizationStatus.topTopics.length === 0
                }
                onClick={() => setIsClearPersonalizationModalOpen(true)}
                startIcon={<Trash2 className="w-4 h-4" />}
              >
                {isClearingPersonalization
                  ? t('profile.personalization.clearingButton')
                  : t('profile.personalization.clearButton')}
              </Button>
            </div>
          </section>
        )}

        {/* Tab 6: Danger Zone / Account Deletion (Rule 6.7) */}
        {activeTab === 'danger' && (
          <section className="bg-[var(--color-surface)] border border-[var(--color-error-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-7 space-y-5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-6 h-6 text-[var(--color-error-text)] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                <h2 className="text-base sm:text-lg font-bold text-[var(--color-error-text)]">
                  {t('profile.danger.title')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-text)] leading-relaxed">
                  {t('profile.danger.subtitle')}
                </p>
              </div>
            </div>

            <ul className="space-y-2.5 text-xs sm:text-sm text-[var(--color-text)] bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded-[var(--radius-control)] p-4 sm:p-5 list-disc pr-8 leading-relaxed">
              <li>{t('profile.danger.consequence1')}</li>
              <li>{t('profile.danger.consequence2')}</li>
              <li>{t('profile.danger.consequence3')}</li>
              <li>{t('profile.danger.consequence4')}</li>
            </ul>

            {isLastSuperAdmin && (
              <Alert
                variant="warning"
                message={t('profile.danger.lastSuperAdminWarning')}
              />
            )}

            <div className="pt-1 flex justify-end">
              <Button
                type="button"
                variant="danger"
                disabled={isLastSuperAdmin}
                onClick={openDeleteModal}
                startIcon={<Trash2 className="w-4 h-4" />}
              >
                {t('profile.danger.requestDeleteButton')}
              </Button>
            </div>
          </section>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        open={isDeleteModalOpen}
        onClose={() => {
          if (!isDeletingAccount) {
            setIsDeleteModalOpen(false);
          }
        }}
        title={t('profile.danger.modalTitle')}
        closeOnBackdrop={!isDeletingAccount}
      >
        <form onSubmit={handleConfirmDeleteAccount} className="space-y-4">
          <div className="flex items-start gap-2.5 p-3 rounded-[var(--radius-control)] bg-[var(--color-error-bg)] border border-[var(--color-error-border)] text-xs sm:text-sm text-[var(--color-error-text)]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="leading-relaxed">{t('profile.danger.modalWarning')}</p>
          </div>

          {deleteErrorMsg && (
            <Alert
              variant="error"
              message={deleteErrorMsg}
              onDismiss={() => setDeleteErrorMsg(null)}
            />
          )}

          {otpSentNotice && (
            <Alert
              variant="info"
              message={otpSentNotice}
              onDismiss={() => setOtpSentNotice(null)}
            />
          )}

          {hasPasswordAuth ? (
            <FormField
              id="delete-account-password"
              label={t('profile.danger.passwordLabel')}
              type="password"
              value={deletePassword}
              onChange={(value) => {
                setDeletePassword(value);
                setDeleteErrorMsg(null);
              }}
              placeholder={t('profile.danger.passwordPlaceholder')}
              required
            />
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] space-y-2.5">
                <p className="text-xs font-semibold text-[var(--color-text)]">
                  {t('profile.danger.otpSectionTitle')}
                </p>
                {currentUser.phoneNumber && (
                  <p className="text-xs text-[var(--color-muted)] tabular-nums-strict">
                    {t('profile.danger.otpPhoneLabel', {
                      phone: toPersianDigits(currentUser.phoneNumber),
                    })}
                  </p>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isSendingOtp || otpCooldownSeconds > 0}
                  onClick={() => void handleRequestDeleteOtp()}
                >
                  {otpCooldownSeconds > 0
                    ? t('profile.danger.sendOtpCooldown', {
                        seconds: toPersianDigits(otpCooldownSeconds),
                      })
                    : t('profile.danger.sendOtpButton')}
                </Button>
              </div>

              <FormField
                id="delete-account-otp"
                label={t('profile.danger.otpCodeLabel')}
                value={deleteOtpCode}
                onChange={(value) => {
                  setDeleteOtpCode(value);
                  setDeleteErrorMsg(null);
                }}
                placeholder={t('profile.danger.otpCodePlaceholder')}
                required
              />
            </div>
          )}

          <div className="pt-2 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)]">
            <Button
              type="button"
              variant="outline"
              disabled={isDeletingAccount}
              onClick={() => setIsDeleteModalOpen(false)}
            >
              {t('profile.danger.cancelButton')}
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={
                isDeletingAccount ||
                (hasPasswordAuth
                  ? deletePassword.trim().length === 0
                  : deleteOtpCode.trim().length < 6)
              }
            >
              {isDeletingAccount
                ? t('profile.danger.deletingButton')
                : t('profile.danger.confirmDeleteButton')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Clear Personalization History Confirmation Modal */}
      <Modal
        open={isClearPersonalizationModalOpen}
        onClose={() => {
          if (!isClearingPersonalization) {
            setIsClearPersonalizationModalOpen(false);
          }
        }}
        title={t('profile.personalization.clearModalTitle')}
        closeOnBackdrop={!isClearingPersonalization}
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text)] leading-relaxed">
            {t('profile.personalization.clearModalBody')}
          </p>

          <div className="pt-2 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)]">
            <Button
              type="button"
              variant="outline"
              disabled={isClearingPersonalization}
              onClick={() => setIsClearPersonalizationModalOpen(false)}
            >
              {t('profile.personalization.clearModalCancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={isClearingPersonalization}
              onClick={() => void handleConfirmClearPersonalization()}
            >
              {isClearingPersonalization
                ? t('profile.personalization.clearingButton')
                : t('profile.personalization.clearModalConfirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </MainLayout>
  );
}
