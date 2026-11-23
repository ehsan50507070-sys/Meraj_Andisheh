import { Calendar, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  formatJalaliDate,
  getJalaliMonthLength,
  getJalaliWeekdayIndex,
  getTodayJalali,
  parseJalaliInput,
  toPersianCalendarDigits,
  type JalaliDate,
} from '../../../core/services/jalaliCalendarService';
import type { ResourceKey } from '../../resources/fa';
import { t } from '../../resources/i18n';

export interface JalaliDatePickerProps {
  id: string;
  label?: string;
  value: string;
  onChange: (formattedJalaliValue: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  minYear?: number;
  maxYear?: number;
  className?: string;
}

const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const WEEKDAY_INDICES = [0, 1, 2, 3, 4, 5, 6] as const;

export function JalaliDatePicker({
  id,
  label,
  value,
  onChange,
  placeholder,
  error,
  disabled = false,
  required = false,
  allowClear = false,
  minYear,
  maxYear,
  className = '',
}: JalaliDatePickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);

  const today = useMemo<JalaliDate>(() => getTodayJalali(false), []);
  const parsedValue = useMemo<JalaliDate | null>(() => parseJalaliInput(value), [value]);

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [hasBlurredInvalid, setHasBlurredInvalid] = useState<boolean>(false);
  const [viewYear, setViewYear] = useState<number>(() => parsedValue?.jy ?? today.jy);
  const [viewMonth, setViewMonth] = useState<number>(() => parsedValue?.jm ?? today.jm);

  const effectiveMinYear = useMemo(() => {
    const baseMin = minYear ?? today.jy - 15;
    return Math.min(baseMin, viewYear, parsedValue?.jy ?? baseMin);
  }, [minYear, today.jy, viewYear, parsedValue?.jy]);

  const effectiveMaxYear = useMemo(() => {
    const baseMax = maxYear ?? today.jy + 5;
    return Math.max(baseMax, viewYear, parsedValue?.jy ?? baseMax);
  }, [maxYear, today.jy, viewYear, parsedValue?.jy]);

  const yearOptions = useMemo(() => {
    const list: number[] = [];
    for (let y = effectiveMinYear; y <= effectiveMaxYear; y += 1) {
      list.push(y);
    }
    return list;
  }, [effectiveMinYear, effectiveMaxYear]);

  // Keep calendar view synchronized when controlled value updates to a valid Jalali date
  useEffect(() => {
    if (parsedValue) {
      setViewYear(parsedValue.jy);
      setViewMonth(parsedValue.jm);
      setHasBlurredInvalid(false);
    }
  }, [parsedValue]);

  // Outside click and Escape key handling
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleOutsidePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (
        containerRef.current &&
        target instanceof Node &&
        !containerRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerButtonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleOutsidePointerDown);
    document.addEventListener('touchstart', handleOutsidePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsidePointerDown);
      document.removeEventListener('touchstart', handleOutsidePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleToggleOpen = () => {
    if (disabled) {
      return;
    }
    if (!isOpen) {
      if (parsedValue) {
        setViewYear(parsedValue.jy);
        setViewMonth(parsedValue.jm);
      } else {
        setViewYear(today.jy);
        setViewMonth(today.jm);
      }
    }
    setIsOpen((prev) => !prev);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextRaw = event.target.value;
    onChange(nextRaw);
    const parsed = parseJalaliInput(nextRaw);
    if (parsed) {
      setHasBlurredInvalid(false);
      setViewYear(parsed.jy);
      setViewMonth(parsed.jm);
    }
  };

  const handleInputBlur = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setHasBlurredInvalid(false);
      return;
    }
    const parsed = parseJalaliInput(trimmed);
    if (parsed) {
      setHasBlurredInvalid(false);
      const formatted = formatJalaliDate(parsed.jy, parsed.jm, parsed.jd, true);
      if (formatted !== value) {
        onChange(formatted);
      }
    } else {
      setHasBlurredInvalid(true);
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && !isOpen && !disabled) {
      event.preventDefault();
      handleToggleOpen();
    }
  };

  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (day: number) => {
    const formatted = formatJalaliDate(viewYear, viewMonth, day, true);
    setHasBlurredInvalid(false);
    onChange(formatted);
    setIsOpen(false);
  };

  const handleSelectToday = () => {
    const formatted = formatJalaliDate(today.jy, today.jm, today.jd, true);
    setHasBlurredInvalid(false);
    setViewYear(today.jy);
    setViewMonth(today.jm);
    onChange(formatted);
    setIsOpen(false);
  };

  const handleClear = () => {
    setHasBlurredInvalid(false);
    onChange('');
    setIsOpen(false);
  };

  const daysInMonth = useMemo(
    () => getJalaliMonthLength(viewYear, viewMonth),
    [viewYear, viewMonth],
  );
  const firstWeekdayOffset = useMemo(
    () => getJalaliWeekdayIndex(viewYear, viewMonth, 1),
    [viewYear, viewMonth],
  );

  const monthLabel = t(`jalali.month.${viewMonth}` as ResourceKey);
  const effectiveError =
    error ??
    (hasBlurredInvalid && value.trim().length > 0 && !parsedValue
      ? t('jalali.picker.invalidHint')
      : undefined);
  const errorId = effectiveError ? `${id}-error` : undefined;

  return (
    <div ref={containerRef} className={`relative w-full min-w-0 ${className}`}>
      {label ? (
        <label
          htmlFor={id}
          className="block text-xs sm:text-sm font-medium text-[var(--color-text)] mb-1.5"
        >
          <span>{label}</span>
          {required ? (
            <span className="text-[var(--color-error-text)] ms-1" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}

      <div
        className={`flex items-center gap-1.5 w-full min-w-0 min-h-[42px] px-2.5 rounded-[var(--radius-control)] bg-[var(--color-surface)] border transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-[var(--color-primary)] ${
          disabled ? 'opacity-55 cursor-not-allowed' : ''
        } ${
          effectiveError
            ? 'border-[var(--color-error-text)]'
            : 'border-[var(--color-border-strong)] hover:border-[var(--color-muted)]'
        }`}
      >
        <input
          id={id}
          type="text"
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          disabled={disabled}
          required={required}
          placeholder={placeholder ?? t('jalali.picker.placeholder')}
          aria-invalid={Boolean(effectiveError)}
          aria-describedby={errorId}
          aria-expanded={isOpen}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none py-2 text-right text-xs sm:text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] tabular-nums-strict disabled:cursor-not-allowed"
        />

        <button
          ref={triggerButtonRef}
          type="button"
          onClick={handleToggleOpen}
          disabled={disabled}
          aria-label={t('jalali.picker.openCalendarAria')}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-control)] text-[var(--color-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-alt)] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] disabled:opacity-45 disabled:cursor-not-allowed"
        >
          <Calendar className="w-4 h-4 shrink-0" aria-hidden="true" />
        </button>
      </div>

      {effectiveError ? (
        <p id={errorId} role="alert" className="mt-1 text-xs font-medium text-[var(--color-error-text)]">
          {effectiveError}
        </p>
      ) : null}

      {isOpen ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={t('jalali.picker.calendarDialogAria')}
          className="absolute top-full start-0 mt-1.5 z-50 w-[min(20.5rem,calc(100vw-2rem))] sm:w-[320px] max-w-[calc(100vw-2rem)] bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-[var(--radius-card)] shadow-[var(--shadow-modal)] p-3 space-y-3"
        >
          {/* Calendar Header: Prev/Next Month + Month/Year Selectors */}
          <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-[var(--color-border)]">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label={t('jalali.picker.prevMonthAria')}
              className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] transition-colors shrink-0"
            >
              <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />
            </button>

            <div className="flex items-center gap-1.5 min-w-0 flex-1 justify-center">
              <div className="relative min-w-0">
                <select
                  aria-label={t('jalali.picker.monthSelectAria')}
                  value={viewMonth}
                  onChange={(e) => setViewMonth(Number(e.target.value))}
                  className="appearance-none h-8 ps-2.5 pe-6 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] min-w-0 cursor-pointer"
                >
                  {MONTH_NUMBERS.map((m) => (
                    <option key={m} value={m}>
                      {t(`jalali.month.${m}` as ResourceKey)}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="w-3.5 h-3.5 text-[var(--color-muted)] pointer-events-none absolute end-1.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
              </div>

              <div className="relative min-w-0">
                <select
                  aria-label={t('jalali.picker.yearSelectAria')}
                  value={viewYear}
                  onChange={(e) => setViewYear(Number(e.target.value))}
                  className="appearance-none h-8 ps-2.5 pe-6 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text)] tabular-nums-strict focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] min-w-0 cursor-pointer"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {toPersianCalendarDigits(y)}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="w-3.5 h-3.5 text-[var(--color-muted)] pointer-events-none absolute end-1.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              aria-label={t('jalali.picker.nextMonthAria')}
              className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] transition-colors shrink-0"
            >
              <ChevronLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
            </button>
          </div>

          {/* 7-Column Weekday Header (Saturday -> Friday) */}
          <div className="grid grid-cols-7 gap-1 text-center" role="row">
            {WEEKDAY_INDICES.map((weekdayIndex) => (
              <div
                key={weekdayIndex}
                title={t(`jalali.weekday.full.${weekdayIndex}` as ResourceKey)}
                className="py-1 text-[11px] font-semibold text-[var(--color-muted)] select-none"
              >
                {t(`jalali.weekday.short.${weekdayIndex}` as ResourceKey)}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {Array.from({ length: firstWeekdayOffset }).map((_, emptyIndex) => (
              <span key={`empty-${emptyIndex}`} aria-hidden="true" className="h-9" />
            ))}

            {Array.from({ length: daysInMonth }, (_, idx) => idx + 1).map((day) => {
              const isSelected =
                parsedValue !== null &&
                parsedValue.jy === viewYear &&
                parsedValue.jm === viewMonth &&
                parsedValue.jd === day;
              const isToday =
                today.jy === viewYear && today.jm === viewMonth && today.jd === day;

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => handleSelectDay(day)}
                  aria-pressed={isSelected}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={t('jalali.picker.dayAria', {
                    day: toPersianCalendarDigits(day),
                    month: monthLabel,
                    year: toPersianCalendarDigits(viewYear),
                  })}
                  className={`h-9 w-full rounded-[var(--radius-control)] text-xs tabular-nums-strict transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] ${
                    isSelected
                      ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] font-bold'
                      : isToday
                        ? 'border border-[var(--color-primary)] bg-[var(--color-surface-alt)] text-[var(--color-primary)] font-bold hover:bg-[var(--color-primary)] hover:text-[var(--color-on-primary)]'
                        : 'text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] font-medium'
                  }`}
                >
                  {toPersianCalendarDigits(day)}
                </button>
              );
            })}
          </div>

          {/* Quick Action Footer */}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={handleSelectToday}
              className="px-3 py-1.5 rounded-[var(--radius-control)] text-xs font-semibold bg-[var(--color-surface-alt)] text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors whitespace-nowrap"
            >
              {t('jalali.picker.todayButton')}
            </button>

            {allowClear && value.trim().length > 0 ? (
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-control)] text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-error-text)] hover:bg-[var(--color-surface-alt)] transition-colors whitespace-nowrap"
              >
                <X className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{t('jalali.picker.clearButton')}</span>
              </button>
            ) : (
              <span className="text-[11px] font-medium text-[var(--color-muted)] tabular-nums-strict">
                {monthLabel} {toPersianCalendarDigits(viewYear)}
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
