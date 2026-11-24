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
  FILM_AGE_RATING_NOTE_MAX_LENGTH,
  FILM_KINDS,
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
  const { currentUser, isFilmsEnabled } = useAuth();

  const [activeTab, setActiveTab] = useState<PortalsTabKey>('films');
  const [searchQuery, setSearchQuery] = useState('');
  const [films, setFilms] = useState<AdminFilmListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyWeeklyPickId, setBusyWeeklyPickId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);

  // Quick edit modal state
  const [editingRow, setEditingRow] = useState<AdminFilmListItem | null>(null);
  const [modalKind, setModalKind] = useState<FilmKind>('Film');
  const [modalYear, setModalYear] = useState('');
  const [modalRuntime, setModalRuntime] = useState('');
  const [modalAgeNote, setModalAgeNote] = useState('');
  const [modalWeeklyPick, setModalWeeklyPick] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSavingModal, setIsSavingModal] = useState(false);

  const loadFilms = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await appContainer.filmPortalService.listAdminFilmsAsync(
        currentUser,
        searchQuery,
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
      setIsLoading(false);
    }
  }, [currentUser, searchQuery]);

  useEffect(() => {
    void loadFilms();
  }, [loadFilms]);

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

  const openQuickEditModal = (row: AdminFilmListItem) => {
    setEditingRow(row);
    setModalKind(row.filmInfo.kind);
    setModalYear(row.filmInfo.releaseYear !== null ? String(row.filmInfo.releaseYear) : '');
    setModalRuntime(
      row.filmInfo.runtimeMinutes !== null ? String(row.filmInfo.runtimeMinutes) : '',
    );
    setModalAgeNote(row.filmInfo.ageRatingNote ?? '');
    setModalWeeklyPick(row.filmInfo.isWeeklyPick);
    setModalError(null);
  };

  const handleSaveQuickEdit = async () => {
    if (!editingRow) return;
    setIsSavingModal(true);
    setModalError(null);
    try {
      const res = await appContainer.filmPortalService.upsertFilmInfoAsync(
        currentUser,
        {
          contentId: editingRow.item.id,
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
        setModalError(
          res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.portals.film.error.invalidReleaseYear'),
        );
        return;
      }
      const savedTitle = editingRow.item.title;
      setEditingRow(null);
      await loadFilms();
      setFeedback({
        variant: 'success',
        message: t('admin.portals.films.feedback.filmInfoSaved', {
          title: savedTitle,
        }),
      });
    } finally {
      setIsSavingModal(false);
    }
  };

  const columns: TableColumn<AdminFilmListItem>[] = [
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
            onClick={() => openQuickEditModal(row)}
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
            onClick={() => setActiveTab('films')}
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
            onClick={() => setActiveTab('books')}
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

        {activeTab === 'films' ? (
          <div className="space-y-5">
            {feedback && (
              <Alert
                variant={feedback.variant}
                message={feedback.message}
                onDismiss={() => setFeedback(null)}
              />
            )}

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
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('admin.portals.films.searchPlaceholder')}
                  className="w-full min-h-[42px] pr-9 pl-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] focus:outline-2 focus:outline-[var(--color-primary)]"
                />
              </div>
            </div>

            {/* Films Table */}
            {isLoading ? (
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
                columns={columns}
                rows={films}
                getRowKey={(row) => String(row.item.id)}
              />
            )}
          </div>
        ) : (
          <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center space-y-3">
            <BookOpen className="w-10 h-10 text-[var(--color-muted)] mx-auto" aria-hidden="true" />
            <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
              {t('admin.portals.books.placeholderTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] max-w-lg mx-auto leading-relaxed">
              {t('admin.portals.books.placeholderBody')}
            </p>
          </section>
        )}
      </div>

      {/* Quick Edit FilmInfo Modal */}
      <Modal
        open={Boolean(editingRow)}
        onClose={() => {
          if (!isSavingModal) setEditingRow(null);
        }}
        title={
          editingRow
            ? t('admin.portals.films.modal.title', { title: editingRow.item.title })
            : ''
        }
        footer={
          <>
            <Button
              variant="ghost"
              disabled={isSavingModal}
              onClick={() => setEditingRow(null)}
            >
              {t('admin.portals.films.modal.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={isSavingModal}
              onClick={() => void handleSaveQuickEdit()}
            >
              {isSavingModal
                ? t('admin.portals.films.modal.saving')
                : t('admin.portals.films.modal.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && <Alert variant="error" message={modalError} />}

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
    </AdminLayout>
  );
}
