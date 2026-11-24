import {
  BookOpen,
  Edit3,
  ExternalLink,
  Film as FilmIcon,
  Plus,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ContentStatus } from '../../../core/domain/content';
import {
  BOOK_AUTHOR_MAX_LENGTH,
  BOOK_KEY_EXCERPTS_MAX_LENGTH,
  BOOK_STUDIO_NOTE_MAX_LENGTH,
  FILM_AGE_RATING_NOTE_MAX_LENGTH,
  FILM_KINDS,
  type AdminBookListItem,
  type AdminFilmListItem,
  type FilmKind,
} from '../../../core/domain/portals';
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
import { toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';
import { navigateToHash } from '../../router/HashRouter';
import { appContainer } from '../../services/appContainer';
import { AdminLayout } from '../AdminLayout';

interface AdminPortalsPageProps {
  currentRoute: string;
}

type PortalsTabKey = 'films' | 'books';

function getStatusVariant(status: ContentStatus): 'success' | 'warning' | 'neutral' {
  switch (status) {
    case ContentStatus.Published:
      return 'success';
    case ContentStatus.Archived:
      return 'warning';
    case ContentStatus.Draft:
    default:
      return 'neutral';
  }
}

function getKindLabelKey(kind: FilmKind): ResourceKey {
  switch (kind) {
    case 'Documentary':
      return 'films.kind.Documentary';
    case 'Animation':
      return 'films.kind.Animation';
    case 'Film':
    default:
      return 'films.kind.Film';
  }
}

export function AdminPortalsPage({ currentRoute }: AdminPortalsPageProps) {
  const { currentUser, isFilmsEnabled, isBooksEnabled } = useAuth();

  const [activeTab, setActiveTab] = useState<PortalsTabKey>('films');
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);

  // Films Tab State
  const [filmSearchQuery, setFilmSearchQuery] = useState('');
  const [films, setFilms] = useState<AdminFilmListItem[]>([]);
  const [isLoadingFilms, setIsLoadingFilms] = useState(true);
  const [busyWeeklyPickId, setBusyWeeklyPickId] = useState<number | null>(null);

  // Quick edit Film modal state
  const [editingFilmRow, setEditingFilmRow] = useState<AdminFilmListItem | null>(null);
  const [modalKind, setModalKind] = useState<FilmKind>('Film');
  const [modalYear, setModalYear] = useState('');
  const [modalRuntime, setModalRuntime] = useState('');
  const [modalAgeNote, setModalAgeNote] = useState('');
  const [modalWeeklyPick, setModalWeeklyPick] = useState(false);
  const [filmModalError, setFilmModalError] = useState<string | null>(null);
  const [isSavingFilmModal, setIsSavingFilmModal] = useState(false);

  // Books Tab State
  const [bookSearchQuery, setBookSearchQuery] = useState('');
  const [books, setBooks] = useState<AdminBookListItem[]>([]);
  const [isLoadingBooks, setIsLoadingBooks] = useState(true);

  // Quick edit Book modal state
  const [editingBookRow, setEditingBookRow] = useState<AdminBookListItem | null>(null);
  const [modalBookAuthor, setModalBookAuthor] = useState('');
  const [modalBookPublisher, setModalBookPublisher] = useState('');
  const [modalBookPublishYear, setModalBookPublishYear] = useState('');
  const [modalBookPages, setModalBookPages] = useState('');
  const [modalBookKeyExcerpts, setModalBookKeyExcerpts] = useState('');
  const [modalBookStudioNote, setModalBookStudioNote] = useState('');
  const [bookModalError, setBookModalError] = useState<string | null>(null);
  const [isSavingBookModal, setIsSavingBookModal] = useState(false);

  const loadFilms = useCallback(async () => {
    setIsLoadingFilms(true);
    try {
      const res = await appContainer.filmPortalService.listAdminFilmsAsync(
        currentUser,
        filmSearchQuery,
      );
      if (res.ok && res.data) {
        setFilms(res.data);
      } else {
        setFilms([]);
        if (res.messageKey) {
          setFeedback({
            variant: 'error',
            message: t(res.messageKey as ResourceKey),
          });
        }
      }
    } finally {
      setIsLoadingFilms(false);
    }
  }, [currentUser, filmSearchQuery]);

  const loadBooks = useCallback(async () => {
    setIsLoadingBooks(true);
    try {
      const res = await appContainer.bookPortalService.listAdminBooksAsync(
        currentUser,
        bookSearchQuery,
      );
      if (res.ok && res.data) {
        setBooks(res.data);
      } else {
        setBooks([]);
        if (res.messageKey) {
          setFeedback({
            variant: 'error',
            message: t(res.messageKey as ResourceKey),
          });
        }
      }
    } finally {
      setIsLoadingBooks(false);
    }
  }, [currentUser, bookSearchQuery]);

  useEffect(() => {
    void loadFilms();
  }, [loadFilms]);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  const currentWeeklyPick = useMemo(
    () => films.find((row) => row.filmInfo.isWeeklyPick) ?? null,
    [films],
  );

  const filmKindOptions: SelectOption[] = useMemo(
    () =>
      FILM_KINDS.map((kind) => ({
        value: kind,
        label: t(getKindLabelKey(kind)),
      })),
    [],
  );

  const handleSetWeeklyPick = async (row: AdminFilmListItem) => {
    setBusyWeeklyPickId(row.item.id);
    setFeedback(null);
    try {
      const res = await appContainer.filmPortalService.setWeeklyPickAsync(
        currentUser,
        row.item.id,
      );
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.portals.film.error.contentNotFound'),
        });
        return;
      }
      await loadFilms();
      setFeedback({
        variant: 'success',
        message: t('admin.portals.films.feedback.weeklyPickSet', {
          title: row.item.title,
        }),
      });
    } finally {
      setBusyWeeklyPickId(null);
    }
  };

  const openQuickEditFilmModal = (row: AdminFilmListItem) => {
    setEditingFilmRow(row);
    setModalKind(row.filmInfo.kind);
    setModalYear(row.filmInfo.releaseYear !== null ? String(row.filmInfo.releaseYear) : '');
    setModalRuntime(
      row.filmInfo.runtimeMinutes !== null ? String(row.filmInfo.runtimeMinutes) : '',
    );
    setModalAgeNote(row.filmInfo.ageRatingNote ?? '');
    setModalWeeklyPick(row.filmInfo.isWeeklyPick);
    setFilmModalError(null);
  };

  const handleSaveFilmQuickEdit = async () => {
    if (!editingFilmRow) return;
    setIsSavingFilmModal(true);
    setFilmModalError(null);
    try {
      const res = await appContainer.filmPortalService.upsertFilmInfoAsync(
        currentUser,
        {
          contentId: editingFilmRow.item.id,
          kind: modalKind,
          releaseYear: modalYear,
          runtimeMinutes: modalRuntime,
          ageRatingNote: modalAgeNote,
          isWeeklyPick: modalWeeklyPick,
        },
        {
          sourceContext: 'portals',
          routePath: currentRoute,
        },
      );
      if (!res.ok) {
        setFilmModalError(
          res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.portals.film.error.invalidReleaseYear'),
        );
        return;
      }
      const savedTitle = editingFilmRow.item.title;
      setEditingFilmRow(null);
      await loadFilms();
      setFeedback({
        variant: 'success',
        message: t('admin.portals.films.feedback.filmInfoSaved', {
          title: savedTitle,
        }),
      });
    } finally {
      setIsSavingFilmModal(false);
    }
  };

  const openQuickEditBookModal = (row: AdminBookListItem) => {
    setEditingBookRow(row);
    setModalBookAuthor(row.bookInfo.author);
    setModalBookPublisher(row.bookInfo.publisher ?? '');
    setModalBookPublishYear(
      row.bookInfo.publishYear !== null ? String(row.bookInfo.publishYear) : '',
    );
    setModalBookPages(
      row.bookInfo.pages !== null ? String(row.bookInfo.pages) : '',
    );
    setModalBookKeyExcerpts(row.bookInfo.keyExcerpts ?? '');
    setModalBookStudioNote(row.bookInfo.studioNote ?? '');
    setBookModalError(null);
  };

  const handleSaveBookQuickEdit = async () => {
    if (!editingBookRow) return;
    setIsSavingBookModal(true);
    setBookModalError(null);
    try {
      const res = await appContainer.bookPortalService.upsertBookInfoAsync(
        currentUser,
        {
          contentId: editingBookRow.item.id,
          author: modalBookAuthor,
          publisher: modalBookPublisher,
          publishYear: modalBookPublishYear,
          pages: modalBookPages,
          keyExcerpts: modalBookKeyExcerpts,
          studioNote: modalBookStudioNote,
        },
        {
          sourceContext: 'portals',
          routePath: currentRoute,
        },
      );
      if (!res.ok) {
        setBookModalError(
          res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.portals.book.error.authorRequired'),
        );
        return;
      }
      const savedTitle = editingBookRow.item.title;
      setEditingBookRow(null);
      await loadBooks();
      setFeedback({
        variant: 'success',
        message: t('admin.portals.books.feedback.bookInfoSaved', {
          title: savedTitle,
        }),
      });
    } finally {
      setIsSavingBookModal(false);
    }
  };

  const filmColumns: TableColumn<AdminFilmListItem>[] = [
    {
      key: 'title',
      header: t('admin.portals.films.col.title'),
      render: (row) => (
        <div className="space-y-1 min-w-[200px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[var(--color-text)]">{row.item.title}</span>
            {row.filmInfo.isWeeklyPick && (
              <Tag label={t('admin.portals.films.weeklyPickActiveBadge')} variant="primary" />
            )}
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            {row.primaryTopicName ?? t('catalog.generalTopic')}
          </p>
        </div>
      ),
    },
    {
      key: 'kind',
      header: t('admin.portals.films.col.kind'),
      render: (row) => (
        <div className="space-y-1 text-xs sm:text-sm tabular-nums-strict">
          <p className="font-semibold text-[var(--color-text)]">
            {t(getKindLabelKey(row.filmInfo.kind))}
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            {row.filmInfo.releaseYear !== null
              ? t('admin.portals.films.yearLabel', {
                  year: toPersianDigits(row.filmInfo.releaseYear),
                })
              : t('admin.portals.films.unsetValue')}
          </p>
        </div>
      ),
    },
    {
      key: 'runtimeAndAge',
      header: t('admin.portals.films.col.runtimeAndAge'),
      render: (row) => {
        const runtime = row.filmInfo.runtimeMinutes ?? row.item.readWatchMinutes;
        return (
          <div className="space-y-1 text-xs max-w-xs">
            <p className="font-medium text-[var(--color-text)] tabular-nums-strict">
              {typeof runtime === 'number' && runtime > 0
                ? t('admin.portals.films.runtimeLabel', {
                    minutes: toPersianDigits(runtime),
                  })
                : t('admin.portals.films.unsetValue')}
            </p>
            <p className="text-[var(--color-muted)] line-clamp-2">
              {row.filmInfo.ageRatingNote ?? t('admin.portals.films.unsetValue')}
            </p>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: t('admin.portals.films.col.status'),
      render: (row) => (
        <Tag
          label={t(`content.status.${row.item.status}` as ResourceKey)}
          variant={getStatusVariant(row.item.status)}
        />
      ),
    },
    {
      key: 'actions',
      header: t('admin.portals.films.col.actions'),
      render: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          {!row.filmInfo.isWeeklyPick && (
            <Button
              size="sm"
              variant="primary"
              disabled={busyWeeklyPickId === row.item.id}
              onClick={() => void handleSetWeeklyPick(row)}
              startIcon={<Sparkles className="w-3.5 h-3.5" />}
            >
              {busyWeeklyPickId === row.item.id
                ? t('admin.portals.films.settingWeeklyPick')
                : t('admin.portals.films.setWeeklyPickAction')}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openQuickEditFilmModal(row)}
            startIcon={<Edit3 className="w-3.5 h-3.5" />}
          >
            {t('admin.portals.films.quickEditAction')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigateToHash(`/admin/content/edit/${row.item.id}`)}
          >
            {t('admin.portals.films.editFullContentAction')}
          </Button>
          {row.item.status === ContentStatus.Published && isFilmsEnabled && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                navigateToHash(`/films/${encodeURIComponent(row.item.slug)}`)
              }
              startIcon={<ExternalLink className="w-3.5 h-3.5" />}
            >
              {t('admin.portals.films.previewFilmAction')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const bookColumns: TableColumn<AdminBookListItem>[] = [
    {
      key: 'title',
      header: t('admin.portals.books.col.title'),
      render: (row) => (
        <div className="space-y-1 min-w-[200px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[var(--color-text)]">{row.item.title}</span>
            {row.item.isFeatured && (
              <Tag label={t('admin.portals.books.featuredBadge')} variant="primary" />
            )}
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            {row.primaryTopicName ?? t('catalog.generalTopic')}
          </p>
        </div>
      ),
    },
    {
      key: 'authorAndPublisher',
      header: t('admin.portals.books.col.authorAndPublisher'),
      render: (row) => (
        <div className="space-y-1 text-xs sm:text-sm max-w-xs">
          <p className="font-semibold text-[var(--color-text)]">
            {row.bookInfo.author.trim().length > 0
              ? row.bookInfo.author
              : t('admin.portals.books.unsetValue')}
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            {row.bookInfo.publisher ?? t('admin.portals.books.unsetValue')}
          </p>
        </div>
      ),
    },
    {
      key: 'yearAndPages',
      header: t('admin.portals.books.col.yearAndPages'),
      render: (row) => (
        <div className="space-y-1 text-xs tabular-nums-strict">
          <p className="font-medium text-[var(--color-text)]">
            {row.bookInfo.publishYear !== null
              ? t('admin.portals.books.yearLabel', {
                  year: toPersianDigits(row.bookInfo.publishYear),
                })
              : t('admin.portals.books.unsetValue')}
          </p>
          <p className="text-[var(--color-muted)]">
            {row.bookInfo.pages !== null
              ? t('admin.portals.books.pagesLabel', {
                  pages: toPersianDigits(row.bookInfo.pages),
                })
              : t('admin.portals.books.unsetValue')}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('admin.portals.books.col.status'),
      render: (row) => (
        <Tag
          label={t(`content.status.${row.item.status}` as ResourceKey)}
          variant={getStatusVariant(row.item.status)}
        />
      ),
    },
    {
      key: 'actions',
      header: t('admin.portals.books.col.actions'),
      render: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openQuickEditBookModal(row)}
            startIcon={<Edit3 className="w-3.5 h-3.5" />}
          >
            {t('admin.portals.books.quickEditAction')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigateToHash(`/admin/content/edit/${row.item.id}`)}
          >
            {t('admin.portals.books.editFullContentAction')}
          </Button>
          {row.item.status === ContentStatus.Published && isBooksEnabled && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                navigateToHash(`/books/${encodeURIComponent(row.item.slug)}`)
              }
              startIcon={<ExternalLink className="w-3.5 h-3.5" />}
            >
              {t('admin.portals.books.previewBookAction')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        <header className="pb-5 border-b border-[var(--color-border)] flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)]">
              {t('admin.portals.title')}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('admin.portals.subtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeTab === 'films' ? (
              <>
                {isFilmsEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateToHash('/films')}
                    startIcon={<ExternalLink className="w-4 h-4" />}
                  >
                    {t('admin.portals.films.openShowcase')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigateToHash('/admin/content/new')}
                  startIcon={<Plus className="w-4 h-4" />}
                >
                  {t('admin.portals.films.addNewContentFilm')}
                </Button>
              </>
            ) : (
              <>
                {isBooksEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateToHash('/books')}
                    startIcon={<ExternalLink className="w-4 h-4" />}
                  >
                    {t('admin.portals.books.openShowcase')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigateToHash('/admin/content/new')}
                  startIcon={<Plus className="w-4 h-4" />}
                >
                  {t('admin.portals.books.addNewContentBook')}
                </Button>
              </>
            )}
          </div>
        </header>

        {/* Portals Tabs */}
        <div
          role="tablist"
          aria-label={t('admin.portals.tabs.ariaLabel')}
          className="flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-3"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'films'}
            onClick={() => {
              setActiveTab('films');
              setFeedback(null);
            }}
            className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] border transition-colors whitespace-nowrap ${
              activeTab === 'films'
                ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                : 'bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'
            }`}
          >
            <FilmIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t('admin.portals.tab.films')}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'books'}
            onClick={() => {
              setActiveTab('books');
              setFeedback(null);
            }}
            className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] border transition-colors whitespace-nowrap ${
              activeTab === 'books'
                ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                : 'bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'
            }`}
          >
            <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t('admin.portals.tab.books')}</span>
          </button>
        </div>

        {feedback && (
          <Alert
            variant={feedback.variant}
            message={feedback.message}
            onDismiss={() => setFeedback(null)}
          />
        )}

        {activeTab === 'films' ? (
          <div className="space-y-5">
            {/* Feature Flag Status + Current Weekly Pick Spotlight */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs sm:text-sm font-semibold text-[var(--color-muted)]">
                    {t('admin.portals.films.flagLabel')}
                  </span>
                  <Tag
                    label={
                      isFilmsEnabled
                        ? t('admin.portals.films.flagEnabled')
                        : t('admin.portals.films.flagDisabled')
                    }
                    variant={isFilmsEnabled ? 'success' : 'warning'}
                  />
                </div>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                  {t('admin.portals.films.exclusivityNote')}
                </p>
                <div className="pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateToHash('/admin/settings')}
                    startIcon={<Settings className="w-3.5 h-3.5" />}
                  >
                    {t('admin.portals.films.openSettings')}
                  </Button>
                </div>
              </section>

              <section className="rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] p-5 space-y-2.5">
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-primary)]">
                  <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{t('admin.portals.films.weeklyPickBannerTitle')}</span>
                </div>
                {currentWeeklyPick ? (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-bold text-[var(--color-text)]">
                        {currentWeeklyPick.item.title}
                      </p>
                      <Tag
                        label={t(getKindLabelKey(currentWeeklyPick.filmInfo.kind))}
                        variant="primary"
                      />
                    </div>
                    {currentWeeklyPick.item.status !== ContentStatus.Published && (
                      <p className="text-xs text-[var(--color-warning-text)] font-medium">
                        {t('admin.portals.films.weeklyPickNotPublishedWarn')}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                    {t('admin.portals.films.weeklyPickNone')}
                  </p>
                )}
              </section>
            </div>

            {/* Search Input */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <label htmlFor="admin-portals-films-search" className="sr-only">
                {t('admin.portals.films.searchLabel')}
              </label>
              <div className="relative max-w-md">
                <Search
                  className="w-4 h-4 text-[var(--color-muted)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="admin-portals-films-search"
                  type="search"
                  value={filmSearchQuery}
                  onChange={(e) => setFilmSearchQuery(e.target.value)}
                  placeholder={t('admin.portals.films.searchPlaceholder')}
                  className="w-full min-h-[42px] pr-9 pl-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] focus:outline-2 focus:outline-[var(--color-primary)]"
                />
              </div>
            </div>

            {/* Films Table */}
            {isLoadingFilms ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
                {t('admin.portals.films.loading')}
              </div>
            ) : films.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center space-y-3">
                <FilmIcon className="w-10 h-10 text-[var(--color-muted)] mx-auto" aria-hidden="true" />
                <h2 className="text-base font-bold text-[var(--color-text)]">
                  {t('admin.portals.films.emptyTitle')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)] max-w-md mx-auto">
                  {t('admin.portals.films.emptyBody')}
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigateToHash('/admin/content/new')}
                  startIcon={<Plus className="w-4 h-4" />}
                >
                  {t('admin.portals.films.addNewContentFilm')}
                </Button>
              </div>
            ) : (
              <Table
                columns={filmColumns}
                rows={films}
                getRowKey={(row) => String(row.item.id)}
              />
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {/* Book Feature Flag Card */}
            <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-semibold text-[var(--color-muted)]">
                  {t('admin.portals.books.flagLabel')}
                </span>
                <Tag
                  label={
                    isBooksEnabled
                      ? t('admin.portals.books.flagEnabled')
                      : t('admin.portals.books.flagDisabled')
                  }
                  variant={isBooksEnabled ? 'success' : 'warning'}
                />
              </div>
              <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                {t('admin.portals.books.infoNote')}
              </p>
              <div className="pt-1 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateToHash('/admin/settings')}
                  startIcon={<Settings className="w-3.5 h-3.5" />}
                >
                  {t('admin.portals.books.openSettings')}
                </Button>
              </div>
            </section>

            {/* Book Search Input */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <label htmlFor="admin-portals-books-search" className="sr-only">
                {t('admin.portals.books.searchLabel')}
              </label>
              <div className="relative max-w-md">
                <Search
                  className="w-4 h-4 text-[var(--color-muted)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="admin-portals-books-search"
                  type="search"
                  value={bookSearchQuery}
                  onChange={(e) => setBookSearchQuery(e.target.value)}
                  placeholder={t('admin.portals.books.searchPlaceholder')}
                  className="w-full min-h-[42px] pr-9 pl-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] focus:outline-2 focus:outline-[var(--color-primary)]"
                />
              </div>
            </div>

            {/* Books Table */}
            {isLoadingBooks ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
                {t('admin.portals.books.loading')}
              </div>
            ) : books.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center space-y-3">
                <BookOpen className="w-10 h-10 text-[var(--color-muted)] mx-auto" aria-hidden="true" />
                <h2 className="text-base font-bold text-[var(--color-text)]">
                  {t('admin.portals.books.emptyTitle')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)] max-w-md mx-auto">
                  {t('admin.portals.books.emptyBody')}
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigateToHash('/admin/content/new')}
                  startIcon={<Plus className="w-4 h-4" />}
                >
                  {t('admin.portals.books.addNewContentBook')}
                </Button>
              </div>
            ) : (
              <Table
                columns={bookColumns}
                rows={books}
                getRowKey={(row) => String(row.item.id)}
              />
            )}
          </div>
        )}
      </div>

      {/* Quick Edit FilmInfo Modal */}
      <Modal
        open={Boolean(editingFilmRow)}
        onClose={() => {
          if (!isSavingFilmModal) setEditingFilmRow(null);
        }}
        title={
          editingFilmRow
            ? t('admin.portals.films.modal.title', { title: editingFilmRow.item.title })
            : ''
        }
        footer={
          <>
            <Button
              variant="ghost"
              disabled={isSavingFilmModal}
              onClick={() => setEditingFilmRow(null)}
            >
              {t('admin.portals.films.modal.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={isSavingFilmModal}
              onClick={() => void handleSaveFilmQuickEdit()}
            >
              {isSavingFilmModal
                ? t('admin.portals.films.modal.saving')
                : t('admin.portals.films.modal.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {filmModalError && <Alert variant="error" message={filmModalError} />}

          <FormField
            id="modal-film-kind"
            label={t('admin.content.film.kindLabel')}
            kind="select"
            value={modalKind}
            onChange={(val) => setModalKind(val as FilmKind)}
            options={filmKindOptions}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              id="modal-film-year"
              label={t('admin.content.film.releaseYearLabel')}
              value={modalYear}
              onChange={setModalYear}
              placeholder={t('admin.content.film.releaseYearPlaceholder')}
            />
            <FormField
              id="modal-film-runtime"
              label={t('admin.content.film.runtimeMinutesLabel')}
              value={modalRuntime}
              onChange={setModalRuntime}
              placeholder={t('admin.content.film.runtimeMinutesPlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <FormField
              id="modal-film-age-note"
              label={t('admin.content.film.ageRatingNoteLabel')}
              kind="textarea"
              rows={2}
              value={modalAgeNote}
              onChange={setModalAgeNote}
              placeholder={t('admin.content.film.ageRatingNotePlaceholder')}
            />
            <p
              className={`text-xs tabular-nums-strict ${
                modalAgeNote.trim().length > FILM_AGE_RATING_NOTE_MAX_LENGTH
                  ? 'text-[var(--color-error-text)] font-semibold'
                  : 'text-[var(--color-muted)]'
              }`}
            >
              {t('admin.content.film.ageRatingNoteCounter', {
                count: toPersianDigits(modalAgeNote.trim().length),
              })}
            </p>
          </div>

          <label className="inline-flex items-center gap-2.5 text-sm font-medium text-[var(--color-text)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={modalWeeklyPick}
              onChange={(e) => setModalWeeklyPick(e.target.checked)}
              className="w-4 h-4 accent-[var(--color-primary)]"
            />
            <span>{t('admin.content.film.weeklyPickLabel')}</span>
          </label>
        </div>
      </Modal>

      {/* Quick Edit BookInfo Modal */}
      <Modal
        open={Boolean(editingBookRow)}
        onClose={() => {
          if (!isSavingBookModal) setEditingBookRow(null);
        }}
        title={
          editingBookRow
            ? t('admin.portals.books.modal.title', { title: editingBookRow.item.title })
            : ''
        }
        footer={
          <>
            <Button
              variant="ghost"
              disabled={isSavingBookModal}
              onClick={() => setEditingBookRow(null)}
            >
              {t('admin.portals.books.modal.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={isSavingBookModal}
              onClick={() => void handleSaveBookQuickEdit()}
            >
              {isSavingBookModal
                ? t('admin.portals.books.modal.saving')
                : t('admin.portals.books.modal.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {bookModalError && <Alert variant="error" message={bookModalError} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <FormField
                id="modal-book-author"
                label={t('admin.content.book.authorLabel')}
                value={modalBookAuthor}
                onChange={setModalBookAuthor}
                placeholder={t('admin.content.book.authorPlaceholder')}
                required
              />
              <p
                className={`text-xs tabular-nums-strict ${
                  modalBookAuthor.trim().length > BOOK_AUTHOR_MAX_LENGTH
                    ? 'text-[var(--color-error-text)] font-semibold'
                    : 'text-[var(--color-muted)]'
                }`}
              >
                {t('admin.content.book.authorCounter', {
                  count: toPersianDigits(modalBookAuthor.trim().length),
                })}
              </p>
            </div>

            <FormField
              id="modal-book-publisher"
              label={t('admin.content.book.publisherLabel')}
              value={modalBookPublisher}
              onChange={setModalBookPublisher}
              placeholder={t('admin.content.book.publisherPlaceholder')}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              id="modal-book-year"
              label={t('admin.content.book.publishYearLabel')}
              value={modalBookPublishYear}
              onChange={setModalBookPublishYear}
              placeholder={t('admin.content.book.publishYearPlaceholder')}
            />
            <FormField
              id="modal-book-pages"
              label={t('admin.content.book.pagesLabel')}
              value={modalBookPages}
              onChange={setModalBookPages}
              placeholder={t('admin.content.book.pagesPlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <FormField
              id="modal-book-excerpts"
              label={t('admin.content.book.keyExcerptsLabel')}
              kind="textarea"
              rows={3}
              value={modalBookKeyExcerpts}
              onChange={setModalBookKeyExcerpts}
              placeholder={t('admin.content.book.keyExcerptsPlaceholder')}
            />
            <p
              className={`text-xs tabular-nums-strict ${
                modalBookKeyExcerpts.trim().length > BOOK_KEY_EXCERPTS_MAX_LENGTH
                  ? 'text-[var(--color-error-text)] font-semibold'
                  : 'text-[var(--color-muted)]'
              }`}
            >
              {t('admin.content.book.keyExcerptsCounter', {
                count: toPersianDigits(modalBookKeyExcerpts.trim().length),
              })}
            </p>
          </div>

          <div className="space-y-1">
            <FormField
              id="modal-book-studio-note"
              label={t('admin.content.book.studioNoteLabel')}
              kind="textarea"
              rows={2}
              value={modalBookStudioNote}
              onChange={setModalBookStudioNote}
              placeholder={t('admin.content.book.studioNotePlaceholder')}
            />
            <p
              className={`text-xs tabular-nums-strict ${
                modalBookStudioNote.trim().length > BOOK_STUDIO_NOTE_MAX_LENGTH
                  ? 'text-[var(--color-error-text)] font-semibold'
                  : 'text-[var(--color-muted)]'
              }`}
            >
              {t('admin.content.book.studioNoteCounter', {
                count: toPersianDigits(modalBookStudioNote.trim().length),
              })}
            </p>
          </div>
        </div>
      </Modal>
    </AdminLayout>
  );
}
