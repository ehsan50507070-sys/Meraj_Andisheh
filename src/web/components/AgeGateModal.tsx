import { CheckCircle2, Sparkles, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { resolveThemeKey, type ThemeKey } from '../../core/services/themeService';
import { useAge } from '../context/AgeContext';
import { formatAgeGroupRange } from '../resources/ageGroupFormatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { Button } from './ui';

function getThemeNameKey(theme: ThemeKey): ResourceKey {
  switch (theme) {
    case 'playful':
      return 'theme.playful.name';
    case 'modern':
      return 'theme.modern.name';
    case 'editorial':
    default:
      return 'theme.editorial.name';
  }
}

export function AgeGateModal() {
  const {
    activeAgeGroups,
    effectiveAgeGroup,
    isAgeReady,
    isAgeModalOpen,
    isFirstVisitGate,
    closeAgeSelector,
    selectAgeGroup,
  } = useAge();

  const [selectingId, setSelectingId] = useState<number | null>(null);
  const titleId = useId();
  const descId = useId();

  const canDismiss = !isFirstVisitGate;

  useEffect(() => {
    if (!isAgeModalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && canDismiss) {
        closeAgeSelector();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAgeModalOpen, canDismiss, closeAgeSelector]);

  if (!isAgeModalOpen) {
    return null;
  }

  const handleSelectCard = async (ageGroupId: number) => {
    if (selectingId !== null) {
      return;
    }
    setSelectingId(ageGroupId);
    try {
      await selectAgeGroup(ageGroupId);
    } finally {
      setSelectingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div
        className="fixed inset-0 bg-slate-950/65 backdrop-blur-[2px]"
        onClick={canDismiss ? closeAgeSelector : undefined}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-modal)] overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-[var(--color-border)]">
          <div className="space-y-1 min-w-0">
            <h2
              id={titleId}
              className="text-base sm:text-lg font-bold text-[var(--color-text)] flex items-center gap-2"
            >
              <Sparkles className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <span>
                {isFirstVisitGate
                  ? t('ageGate.modalFirstVisitTitle')
                  : t('ageGate.modalSwitchTitle')}
              </span>
            </h2>
            <p id={descId} className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {isFirstVisitGate ? t('ageGate.modalFirstVisitDesc') : t('ageGate.modalSwitchDesc')}
            </p>
          </div>

          {canDismiss && (
            <button
              type="button"
              onClick={closeAgeSelector}
              aria-label={t('ui.modal.closeAria')}
              className="inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-[var(--radius-control)] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
          {!isAgeReady ? (
            <p className="text-sm text-[var(--color-muted)] py-8 text-center">
              {t('ageGate.loadingGroups')}
            </p>
          ) : activeAgeGroups.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] py-8 text-center">
              {t('ageGate.emptyGroups')}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {activeAgeGroups.map((group) => {
                const isSelected = effectiveAgeGroup?.id === group.id;
                const isBusy = selectingId === group.id;
                const themeKey = resolveThemeKey(group.themeKey);

                return (
                  <button
                    key={group.id}
                    type="button"
                    disabled={selectingId !== null}
                    onClick={() => void handleSelectCard(group.id)}
                    aria-pressed={isSelected}
                    className={`w-full min-h-[104px] text-right p-4 rounded-[var(--radius-card)] border transition-colors flex flex-col justify-between gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${
                      isSelected
                        ? 'bg-[var(--color-surface-alt)] border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]'
                        : 'bg-[var(--color-surface)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-alt)]'
                    } ${isBusy ? 'opacity-75' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-base font-bold text-[var(--color-text)]">
                        {group.name}
                      </span>
                      {isSelected && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] shrink-0">
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          <span>{t('ageGate.activeBadge')}</span>
                        </span>
                      )}
                    </div>

                    <div className="space-y-1 text-xs text-[var(--color-muted)]">
                      <p className="tabular-nums-strict">
                        {t('ageGate.rangePrefix', {
                          range: formatAgeGroupRange(group),
                        })}
                      </p>
                      <p>
                        {t('ageGate.themePrefix', {
                          theme: t(getThemeNameKey(themeKey)),
                        })}
                      </p>
                    </div>

                    <span className="text-xs font-semibold text-[var(--color-primary)] pt-1">
                      {t('ageGate.selectCardAction')}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {canDismiss && (
          <div className="px-4 sm:px-6 py-3 bg-[var(--color-surface-alt)] border-t border-[var(--color-border)] flex items-center justify-end">
            <Button variant="outline" size="sm" onClick={closeAgeSelector}>
              {t('ageGate.closeButton')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
