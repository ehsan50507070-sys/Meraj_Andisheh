import { CheckCircle2, Eye, Layers, Palette, RotateCcw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import astronomyThumb from '../../assets/images/sample_story_astronomy_1795322522140.jpg';
import scienceThumb from '../../assets/images/sample_science_lab_1795322522554.jpg';
import libraryThumb from '../../assets/images/sample_manuscript_library_1795322522315.jpg';
import {
  evaluateThemeContrast,
  getThemeDefinition,
  THEME_KEYS,
  type ThemeKey,
} from '../../core/services/themeService';
import {
  Alert,
  Breadcrumb,
  Button,
  ContentCard,
  FormField,
  Modal,
  Pagination,
  Table,
  Tag,
  type TableColumn,
} from '../components/ui';
import { MainLayout } from '../layouts/MainLayout';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { useTheme } from '../theme/ThemeManager';

interface ComponentsLabPageProps {
  currentRoute: string;
}

interface SampleContentRow {
  id: string;
  titleKey: ResourceKey;
  formatKey: ResourceKey;
  audienceKey: ResourceKey;
  durationMinutes: number;
}

const SAMPLE_TABLE_ROWS: readonly SampleContentRow[] = [
  {
    id: 'row-1',
    titleKey: 'dev.sample.card1.title',
    formatKey: 'dev.sample.card1.format',
    audienceKey: 'dev.sample.table.row1Audience',
    durationMinutes: 12,
  },
  {
    id: 'row-2',
    titleKey: 'dev.sample.card2.title',
    formatKey: 'dev.sample.card2.format',
    audienceKey: 'dev.sample.table.row2Audience',
    durationMinutes: 18,
  },
  {
    id: 'row-3',
    titleKey: 'dev.sample.card3.title',
    formatKey: 'dev.sample.card3.format',
    audienceKey: 'dev.sample.table.row3Audience',
    durationMinutes: 25,
  },
];

function getThemeNameKey(key: ThemeKey): ResourceKey {
  switch (key) {
    case 'playful':
      return 'theme.playful.name';
    case 'modern':
      return 'theme.modern.name';
    case 'editorial':
    default:
      return 'theme.editorial.name';
  }
}

function getThemeDescKey(key: ThemeKey): ResourceKey {
  switch (key) {
    case 'playful':
      return 'theme.playful.desc';
    case 'modern':
      return 'theme.modern.desc';
    case 'editorial':
    default:
      return 'theme.editorial.desc';
  }
}

export function ComponentsLabPage({ currentRoute }: ComponentsLabPageProps) {
  const { theme, setTheme } = useTheme();
  const activeDef = getThemeDefinition(theme);
  const contrastReport = evaluateThemeContrast(theme);

  // Interactive demo states for all 9 components
  const [lastButtonClicked, setLastButtonClicked] = useState<string | null>(null);
  const [selectedCardTitle, setSelectedCardTitle] = useState<string | null>(null);
  const [sampleTitle, setSampleTitle] = useState('');
  const [sampleTopic, setSampleTopic] = useState('science');
  const [sampleNotes, setSampleNotes] = useState('');
  const [showFormError, setShowFormError] = useState(false);

  const initialRemovableTags: readonly ResourceKey[] = [
    'dev.sample.tag.removable1',
    'dev.sample.tag.removable2',
    'dev.sample.tag.removable3',
  ];
  const [removableTags, setRemovableTags] = useState<readonly ResourceKey[]>(initialRemovableTags);

  const [dismissedInfoAlert, setDismissedInfoAlert] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activePage, setActivePage] = useState(2);

  const tableColumns: readonly TableColumn<SampleContentRow>[] = [
    {
      key: 'title',
      header: t('dev.sample.table.colTitle'),
      render: (row) => <span className="font-medium">{t(row.titleKey)}</span>,
    },
    {
      key: 'format',
      header: t('dev.sample.table.colFormat'),
      render: (row) => <span>{t(row.formatKey)}</span>,
    },
    {
      key: 'audience',
      header: t('dev.sample.table.colAudience'),
      render: (row) => <span className="text-[var(--color-muted)]">{t(row.audienceKey)}</span>,
    },
    {
      key: 'duration',
      header: t('dev.sample.table.colDuration'),
      numeric: true,
      render: (row) =>
        t('ui.contentCard.durationMinutes', {
          minutes: toPersianDigits(row.durationMinutes),
        }),
    },
  ];

  return (
    <MainLayout currentRoute={currentRoute} syncThemeToHash>
      {/* Theme Switcher Toolbar for Dev Preview (sticky on md+ viewports) */}
      <div className="md:sticky md:top-16 z-30 bg-[var(--color-surface-alt)] border-b border-[var(--color-border)]">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)] whitespace-nowrap">
              <Palette className="w-4 h-4 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <span>{t('dev.toolbar.label')}</span>
            </span>

            <div
              role="group"
              aria-label={t('theme.label')}
              className="flex flex-wrap items-center gap-1.5"
            >
              {THEME_KEYS.map((key) => {
                const isSelected = theme === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setTheme(key, true)}
                    className={`min-h-[36px] px-3 py-1 text-xs font-medium rounded-[var(--radius-control)] border transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] ${
                      isSelected
                        ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                        : 'bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
                    }`}
                  >
                    {t(getThemeNameKey(key))}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted)] tabular-nums-strict">
            <span>
              {t('dev.toolbar.scaleBadge', {
                scale: toPersianDigits(activeDef.fontScale),
              })}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {t('dev.toolbar.radiusBadge', {
                radius: toPersianDigits(activeDef.radiusCardPx),
              })}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
        {/* Page Header */}
        <section className="space-y-2 pb-6 border-b border-[var(--color-border)]">
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] text-balance">
            {t('dev.pageTitle')}
          </h1>
          <p className="text-sm sm:text-base text-[var(--color-muted)] max-w-3xl leading-relaxed">
            {t('dev.pageSubtitle')}
          </p>
          <p className="text-xs text-[var(--color-muted)] pt-1">
            {t(getThemeNameKey(theme))} — {t(getThemeDescKey(theme))}
          </p>
        </section>

        {/* 1. Breadcrumb */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-3">
          <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
            {t('dev.section.breadcrumb.title')}
          </h2>
          <Breadcrumb
            ariaLabel={t('dev.section.breadcrumb.title')}
            items={[
              { label: t('dev.section.breadcrumb.item1'), href: '#/' },
              { label: t('dev.section.breadcrumb.item2'), href: '#/health' },
              { label: t('dev.section.breadcrumb.item3') },
            ]}
          />
        </section>

        {/* 2. Button */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
              {t('dev.section.buttons.title')}
            </h2>
            <p className="text-xs sm:text-sm text-[var(--color-muted)]">
              {t('dev.section.buttons.desc')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              onClick={() => setLastButtonClicked(t('dev.section.buttons.primary'))}
            >
              {t('dev.section.buttons.primary')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setLastButtonClicked(t('dev.section.buttons.secondary'))}
            >
              {t('dev.section.buttons.secondary')}
            </Button>
            <Button
              variant="outline"
              onClick={() => setLastButtonClicked(t('dev.section.buttons.outline'))}
            >
              {t('dev.section.buttons.outline')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setLastButtonClicked(t('dev.section.buttons.ghost'))}
            >
              {t('dev.section.buttons.ghost')}
            </Button>
            <Button
              variant="danger"
              onClick={() => setLastButtonClicked(t('dev.section.buttons.danger'))}
            >
              {t('dev.section.buttons.danger')}
            </Button>
            <Button variant="primary" disabled>
              {t('dev.section.buttons.disabled')}
            </Button>
          </div>

          <div className="pt-3 border-t border-[var(--color-border)] flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setLastButtonClicked(t('dev.section.buttons.sizeSm'))}
            >
              {t('dev.section.buttons.sizeSm')}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => setLastButtonClicked(t('dev.section.buttons.sizeMd'))}
            >
              {t('dev.section.buttons.sizeMd')}
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => setLastButtonClicked(t('dev.section.buttons.sizeLg'))}
            >
              {t('dev.section.buttons.sizeLg')}
            </Button>
          </div>

          {lastButtonClicked && (
            <p className="text-xs font-medium text-[var(--color-muted)]">
              {t('dev.section.buttons.clickFeedback', { label: lastButtonClicked })}
            </p>
          )}
        </section>

        {/* 3. ContentCard */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
              {t('dev.section.cards.title')}
            </h2>
            <p className="text-xs sm:text-sm text-[var(--color-muted)]">
              {t('dev.section.cards.desc')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            <ContentCard
              title={t('dev.sample.card1.title')}
              formatLabel={t('dev.sample.card1.format')}
              topicLabel={t('dev.sample.card1.topic')}
              summary={t('dev.sample.card1.summary')}
              durationMinutes={12}
              thumbnailUrl={astronomyThumb}
              onSelect={() => setSelectedCardTitle(t('dev.sample.card1.title'))}
            />
            <ContentCard
              title={t('dev.sample.card2.title')}
              formatLabel={t('dev.sample.card2.format')}
              topicLabel={t('dev.sample.card2.topic')}
              summary={t('dev.sample.card2.summary')}
              durationMinutes={18}
              thumbnailUrl={scienceThumb}
              onSelect={() => setSelectedCardTitle(t('dev.sample.card2.title'))}
            />
            <ContentCard
              title={t('dev.sample.card3.title')}
              formatLabel={t('dev.sample.card3.format')}
              topicLabel={t('dev.sample.card3.topic')}
              summary={t('dev.sample.card3.summary')}
              durationMinutes={25}
              thumbnailUrl={libraryThumb}
              onSelect={() => setSelectedCardTitle(t('dev.sample.card3.title'))}
            />
          </div>

          {selectedCardTitle && (
            <Alert
              variant="success"
              message={t('dev.sample.cardSelected', { title: selectedCardTitle })}
              onDismiss={() => setSelectedCardTitle(null)}
            />
          )}
        </section>

        {/* 4. FormField & 5. Tag (2-column grid on desktop) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                  {t('dev.section.forms.title')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('dev.section.forms.desc')}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFormError((prev) => !prev)}
              >
                {t('dev.sample.form.toggleError')}
              </Button>
            </div>

            <div className="space-y-4">
              <FormField
                id="lab-title-input"
                kind="input"
                label={t('dev.sample.form.nameLabel')}
                value={sampleTitle}
                onChange={setSampleTitle}
                placeholder={t('dev.sample.form.namePlaceholder')}
                hint={t('dev.sample.form.nameHint')}
                error={showFormError ? t('dev.sample.form.nameError') : undefined}
                required
              />

              <FormField
                id="lab-topic-select"
                kind="select"
                label={t('dev.sample.form.topicLabel')}
                value={sampleTopic}
                onChange={setSampleTopic}
                options={[
                  { value: 'science', label: t('dev.sample.form.topicOption1') },
                  { value: 'literature', label: t('dev.sample.form.topicOption2') },
                  { value: 'research', label: t('dev.sample.form.topicOption3') },
                ]}
              />

              <FormField
                id="lab-notes-textarea"
                kind="textarea"
                label={t('dev.sample.form.notesLabel')}
                value={sampleNotes}
                onChange={setSampleNotes}
                placeholder={t('dev.sample.form.notesPlaceholder')}
                hint={t('dev.sample.form.notesHint')}
              />
            </div>
          </section>

          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 flex flex-col justify-between gap-6">
            {/* 5. Tag */}
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                  {t('dev.section.tags.title')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('dev.section.tags.desc')}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Tag label={t('dev.sample.tag.neutral')} variant="neutral" />
                <Tag label={t('dev.sample.tag.primary')} variant="primary" />
                <Tag label={t('dev.sample.tag.accent')} variant="accent" />
                <Tag label={t('dev.sample.tag.success')} variant="success" />
                <Tag label={t('dev.sample.tag.warning')} variant="warning" />
              </div>

              <div className="pt-3 border-t border-[var(--color-border)] space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {removableTags.map((tagKey) => (
                    <Tag
                      key={tagKey}
                      label={t(tagKey)}
                      variant="neutral"
                      removable
                      onRemove={() =>
                        setRemovableTags((prev) => prev.filter((item) => item !== tagKey))
                      }
                    />
                  ))}
                </div>

                {removableTags.length < initialRemovableTags.length && (
                  <Button
                    variant="ghost"
                    size="sm"
                    startIcon={<RotateCcw className="w-3.5 h-3.5" />}
                    onClick={() => setRemovableTags(initialRemovableTags)}
                  >
                    {t('dev.sample.tag.reset')}
                  </Button>
                )}
              </div>
            </div>

            {/* 7. Modal Trigger & 8. Pagination */}
            <div className="pt-5 border-t border-[var(--color-border)] space-y-5">
              <div className="space-y-2">
                <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                  {t('dev.section.modal.title')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('dev.section.modal.desc')}
                </p>
                <div className="pt-1">
                  <Button
                    variant="primary"
                    startIcon={<Eye className="w-4 h-4" />}
                    onClick={() => setIsModalOpen(true)}
                  >
                    {t('dev.section.modal.openButton')}
                  </Button>
                </div>
              </div>

              <div className="pt-4 border-t border-[var(--color-border)] space-y-3">
                <div className="space-y-1">
                  <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                    {t('dev.section.pagination.title')}
                  </h2>
                  <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                    {t('dev.section.pagination.desc')}
                  </p>
                </div>
                <Pagination
                  currentPage={activePage}
                  totalPages={5}
                  onPageChange={setActivePage}
                />
                <p className="text-xs font-medium text-[var(--color-muted)] tabular-nums-strict">
                  {t('dev.section.pagination.activePageLabel', {
                    page: toPersianDigits(activePage),
                  })}
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* 6. Alerts */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
              {t('dev.section.alerts.title')}
            </h2>
            <p className="text-xs sm:text-sm text-[var(--color-muted)]">
              {t('dev.section.alerts.desc')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {!dismissedInfoAlert && (
              <Alert
                variant="info"
                title={t('dev.sample.alert.infoTitle')}
                message={t('dev.sample.alert.infoBody')}
                onDismiss={() => setDismissedInfoAlert(true)}
              />
            )}
            <Alert
              variant="success"
              title={t('dev.sample.alert.successTitle')}
              message={t('dev.sample.alert.successBody')}
            />
            <Alert
              variant="warning"
              title={t('dev.sample.alert.warningTitle')}
              message={t('dev.sample.alert.warningBody')}
            />
            <Alert
              variant="error"
              title={t('dev.sample.alert.errorTitle')}
              message={t('dev.sample.alert.errorBody')}
            />
          </div>
        </section>

        {/* 9. Table */}
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
              {t('dev.section.table.title')}
            </h2>
            <p className="text-xs sm:text-sm text-[var(--color-muted)]">
              {t('dev.section.table.desc')}
            </p>
          </div>

          <Table
            columns={tableColumns}
            rows={SAMPLE_TABLE_ROWS}
            getRowKey={(row) => row.id}
          />
        </section>

        {/* WCAG Contrast Audit Card */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[var(--color-border)]">
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                <span>{t('dev.contrast.title')}</span>
              </h2>
              <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                {t('dev.contrast.subtitle')}
              </p>
            </div>

            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-success-text)] bg-[var(--color-success-bg)] border border-[var(--color-success-border)] px-3 py-1.5 rounded-[var(--radius-tag)] tabular-nums-strict">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {contrastReport.allPassed
                  ? t('dev.contrast.allPassed', {
                      count: toPersianDigits(contrastReport.checks.length),
                    })
                  : t('dev.contrast.someFailed')}
              </span>
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[540px] text-right border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs font-semibold text-[var(--color-muted)]">
                  <th className="py-2.5 px-3">{t('dev.contrast.colPair')}</th>
                  <th className="py-2.5 px-3">{t('dev.contrast.colColors')}</th>
                  <th className="py-2.5 px-3 tabular-nums-strict">{t('dev.contrast.colRatio')}</th>
                  <th className="py-2.5 px-3">{t('dev.contrast.colStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)] text-xs sm:text-sm">
                {contrastReport.checks.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2.5 px-3 font-medium text-[var(--color-text)]">
                      {t(item.labelKey as ResourceKey)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div dir="ltr" className="inline-flex items-center gap-2 font-mono text-xs text-[var(--color-muted)]">
                        <span
                          className="inline-block w-3.5 h-3.5 rounded-sm border border-[var(--color-border-strong)]"
                          style={{ backgroundColor: item.foreground }}
                          aria-hidden="true"
                        />
                        <span>{item.foreground}</span>
                        <span>/</span>
                        <span
                          className="inline-block w-3.5 h-3.5 rounded-sm border border-[var(--color-border-strong)]"
                          style={{ backgroundColor: item.background }}
                          aria-hidden="true"
                        />
                        <span>{item.background}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-[var(--color-text)] tabular-nums-strict">
                      <span dir="ltr">{item.ratio.toFixed(2)} : 1</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`text-xs font-semibold ${
                          item.passesAA
                            ? 'text-[var(--color-success-text)]'
                            : 'text-[var(--color-error-text)]'
                        }`}
                      >
                        {item.passesAA
                          ? t('dev.contrast.statusPass')
                          : t('dev.contrast.statusFail')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Interactive Modal */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={t('dev.section.modal.dialogTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>
              {t('dev.section.modal.cancelButton')}
            </Button>
            <Button variant="primary" onClick={() => setIsModalOpen(false)}>
              {t('dev.section.modal.confirmButton')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p>{t('dev.section.modal.dialogBody')}</p>
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
            <Layers className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t(getThemeNameKey(theme))}</span>
          </div>
        </div>
      </Modal>
    </MainLayout>
  );
}
