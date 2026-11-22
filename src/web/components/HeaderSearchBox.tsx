import { BookOpen, FolderTree, Search, User } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  MIN_LIVE_SUGGESTION_CHARS,
  type LiveSuggestionItem,
  type LiveSuggestionKind,
} from '../../core/services/searchSuggestionService';
import { useAge } from '../context/AgeContext';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';

export interface HeaderSearchBoxProps {
  currentRoute: string;
  inputId: string;
  onNavigate?: () => void;
  className?: string;
}

const DEBOUNCE_MS = 250;

function getKindLabelKey(kind: LiveSuggestionKind): ResourceKey {
  switch (kind) {
    case 'topic':
      return 'liveSearch.kind.topic';
    case 'person':
      return 'liveSearch.kind.person';
    case 'content':
    default:
      return 'liveSearch.kind.content';
  }
}

function SuggestionIcon({ kind }: { kind: LiveSuggestionKind }) {
  switch (kind) {
    case 'topic':
      return <FolderTree className="w-3.5 h-3.5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />;
    case 'person':
      return <User className="w-3.5 h-3.5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />;
    case 'content':
    default:
      return <BookOpen className="w-3.5 h-3.5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />;
  }
}

function readQueryParamFromHash(rawHash: string): string {
  const qIndex = rawHash.indexOf('?');
  if (qIndex === -1) {
    return '';
  }
  const params = new URLSearchParams(rawHash.slice(qIndex + 1));
  return params.get('q') ?? '';
}

export function HeaderSearchBox({
  currentRoute,
  inputId,
  onNavigate,
  className = '',
}: HeaderSearchBoxProps) {
  const { effectiveAgeGroup } = useAge();
  const [query, setQuery] = useState<string>(() => readQueryParamFromHash(currentRoute));
  const [suggestions, setSuggestions] = useState<LiveSuggestionItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  useEffect(() => {
    const normalizedPath = currentRoute.split('?')[0].replace(/^#/, '').toLowerCase() || '/';
    if (normalizedPath === '/search' || normalizedPath === '/content') {
      const paramQ = readQueryParamFromHash(currentRoute);
      setQuery(paramQ);
    }
    setDropdownOpen(false);
  }, [currentRoute]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_LIVE_SUGGESTION_CHARS) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await appContainer.ensureInitializedAtStartup();
          const items = await appContainer.searchSuggestionService.getLiveSuggestionsAsync(
            trimmed,
            effectiveAgeGroup,
          );
          if (!cancelled) {
            setSuggestions(items);
          }
        } finally {
          if (!cancelled) {
            setIsSearching(false);
          }
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, effectiveAgeGroup]);

  const trimmedQuery = query.trim();
  const shouldShowDropdown =
    dropdownOpen && trimmedQuery.length >= MIN_LIVE_SUGGESTION_CHARS;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setDropdownOpen(false);
    onNavigate?.();
    if (trimmedQuery) {
      navigateToHash(`/search?q=${encodeURIComponent(trimmedQuery)}`);
    } else {
      navigateToHash('/search');
    }
  };

  const handlePickSuggestion = (targetHash: string) => {
    setDropdownOpen(false);
    onNavigate?.();
    navigateToHash(targetHash);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <form onSubmit={handleSubmit} className="relative flex items-center w-full">
        <label htmlFor={inputId} className="sr-only">
          {t('layout.header.searchAriaLabel')}
        </label>
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={shouldShowDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={query}
          onFocus={() => {
            if (query.trim().length >= MIN_LIVE_SUGGESTION_CHARS) {
              setDropdownOpen(true);
            }
          }}
          onChange={(event) => {
            const val = event.target.value;
            setQuery(val);
            setDropdownOpen(val.trim().length >= MIN_LIVE_SUGGESTION_CHARS);
          }}
          placeholder={t('liveSearch.placeholder')}
          className="w-full min-h-[40px] pr-9 pl-3 py-1.5 text-sm bg-[var(--color-surface-alt)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] border border-[var(--color-border)] rounded-[var(--radius-control)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
        />
        <button
          type="submit"
          aria-label={t('liveSearch.button')}
          className="absolute right-2.5 text-[var(--color-muted)] hover:text-[var(--color-text)] p-1"
        >
          <Search className="w-4 h-4" aria-hidden="true" />
        </button>
      </form>

      {shouldShowDropdown && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t('layout.header.searchAriaLabel')}
          className="absolute right-0 left-0 top-full mt-1.5 z-50 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-modal)] overflow-hidden"
        >
          {isSearching ? (
            <div className="px-4 py-3 text-xs text-[var(--color-muted)]">
              {t('liveSearch.loading')}
            </div>
          ) : suggestions.length === 0 ? (
            <div className="px-4 py-3 text-xs text-[var(--color-muted)]">
              {t('liveSearch.empty')}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)] max-h-[60vh] overflow-y-auto">
              {suggestions.map((suggestion) => (
                <li key={suggestion.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => handlePickSuggestion(suggestion.targetHash)}
                    className="w-full text-right px-3.5 py-2.5 flex items-center justify-between gap-2.5 hover:bg-[var(--color-surface-alt)] transition-colors focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--color-primary)]"
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <SuggestionIcon kind={suggestion.kind} />
                      <span className="text-xs sm:text-sm font-medium text-[var(--color-text)] truncate">
                        {suggestion.title}
                      </span>
                    </span>
                    <span className="text-[11px] font-medium text-[var(--color-muted)] whitespace-nowrap shrink-0">
                      {t(getKindLabelKey(suggestion.kind))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => handlePickSuggestion(`/search?q=${encodeURIComponent(trimmedQuery)}`)}
            className="w-full text-right px-3.5 py-2.5 text-xs font-semibold text-[var(--color-primary)] bg-[var(--color-surface-alt)] border-t border-[var(--color-border)] hover:underline underline-offset-4 truncate"
          >
            {t('liveSearch.viewAllResults', { query: trimmedQuery })}
          </button>
        </div>
      )}
    </div>
  );
}
