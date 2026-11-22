import { ChevronDown, ChevronLeft } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Topic } from '../../core/domain/taxonomy';
import { buildTopicTree, type TopicTreeNode } from '../../core/services/taxonomyService';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';

function filterActiveTopicsTree(topics: readonly Topic[]): TopicTreeNode[] {
  const activeOnly = topics.filter((topic) => topic.isActive);
  return buildTopicTree(activeOnly, new Map<number, number>());
}

export function TopicMegaMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    const loadTopics = async () => {
      await appContainer.ensureInitializedAtStartup();
      const all = await appContainer.taxonomyRepository.getAllTopics();
      if (active) {
        setTopics(all);
        setIsLoaded(true);
      }
    };
    void loadTopics();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const tree = useMemo(() => filterActiveTopicsTree(topics), [topics]);

  const handleSelectTopic = (topicId: number) => {
    setIsOpen(false);
    navigateToHash(`/content?topics=${topicId}`);
  };

  return (
    <div
      className="relative"
      ref={containerRef}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="true"
        onClick={() => setIsOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
      >
        <span>{t('megaMenu.title')}</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          role="region"
          aria-label={t('megaMenu.title')}
          className="absolute right-0 top-full pt-1.5 z-40 w-[min(92vw,760px)]"
        >
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-modal)] p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
              <span className="text-sm font-bold text-[var(--color-text)]">
                {t('megaMenu.title')}
              </span>
              <a
                href="#/content"
                onClick={() => setIsOpen(false)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] hover:underline underline-offset-4 whitespace-nowrap"
              >
                <span>{t('megaMenu.allCatalogLink')}</span>
                <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            </div>

            {!isLoaded ? (
              <p className="text-xs text-[var(--color-muted)] py-4">{t('megaMenu.loading')}</p>
            ) : tree.length === 0 ? (
              <p className="text-xs text-[var(--color-muted)] py-4">{t('megaMenu.empty')}</p>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5 max-h-[60vh] overflow-y-auto pl-1">
                {tree.map((rootNode) => (
                  <div key={rootNode.topic.id} className="space-y-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => handleSelectTopic(rootNode.topic.id)}
                      className="text-sm font-bold text-[var(--color-text)] hover:text-[var(--color-primary)] text-right block w-full truncate transition-colors"
                    >
                      {rootNode.topic.name}
                    </button>

                    {rootNode.children.length > 0 && (
                      <ul className="space-y-1.5 pr-2 border-r border-[var(--color-border)]">
                        {rootNode.children.map((level2Node) => (
                          <li key={level2Node.topic.id} className="space-y-1">
                            <button
                              type="button"
                              onClick={() => handleSelectTopic(level2Node.topic.id)}
                              className="text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-text)] text-right block w-full truncate transition-colors py-0.5"
                            >
                              {level2Node.topic.name}
                            </button>

                            {level2Node.children.length > 0 && (
                              <ul className="space-y-0.5 pr-2.5">
                                {level2Node.children.map((level3Node) => (
                                  <li key={level3Node.topic.id}>
                                    <button
                                      type="button"
                                      onClick={() => handleSelectTopic(level3Node.topic.id)}
                                      className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-primary)] text-right block w-full truncate transition-colors py-0.5"
                                    >
                                      {level3Node.topic.name}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface TopicMobileAccordionProps {
  onNavigate: () => void;
}

export function TopicMobileAccordion({ onNavigate }: TopicMobileAccordionProps) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [expandedRootIds, setExpandedRootIds] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let active = true;
    const loadTopics = async () => {
      await appContainer.ensureInitializedAtStartup();
      const all = await appContainer.taxonomyRepository.getAllTopics();
      if (active) {
        setTopics(all);
      }
    };
    void loadTopics();
    return () => {
      active = false;
    };
  }, []);

  const tree = useMemo(() => filterActiveTopicsTree(topics), [topics]);

  const toggleExpand = (id: number) => {
    setExpandedRootIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleSelect = (topicId: number) => {
    onNavigate();
    navigateToHash(`/content?topics=${topicId}`);
  };

  if (tree.length === 0) {
    return null;
  }

  return (
    <div className="pt-2 border-t border-[var(--color-border)] space-y-1.5">
      <p className="text-xs font-semibold text-[var(--color-muted)]">
        {t('megaMenu.title')}
      </p>

      <ul className="space-y-1">
        {tree.map((rootNode) => {
          const hasChildren = rootNode.children.length > 0;
          const isExpanded = Boolean(expandedRootIds[rootNode.topic.id]);

          return (
            <li
              key={rootNode.topic.id}
              className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)]"
            >
              <div className="flex items-center justify-between gap-2 px-3 min-h-[40px]">
                <button
                  type="button"
                  onClick={() => handleSelect(rootNode.topic.id)}
                  className="text-xs font-semibold text-[var(--color-text)] text-right flex-1 py-2 truncate"
                >
                  {rootNode.topic.name}
                </button>

                {hasChildren && (
                  <button
                    type="button"
                    onClick={() => toggleExpand(rootNode.topic.id)}
                    aria-expanded={isExpanded}
                    aria-label={t('catalog.filters.expandBranchAria', {
                      name: rootNode.topic.name,
                    })}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-control)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                  >
                    <ChevronDown
                      className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                )}
              </div>

              {hasChildren && isExpanded && (
                <ul className="px-3 pb-2.5 pt-1 border-t border-[var(--color-border)] space-y-1">
                  {rootNode.children.map((level2Node) => (
                    <li key={level2Node.topic.id} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => handleSelect(level2Node.topic.id)}
                        className="text-xs text-[var(--color-text)] hover:text-[var(--color-primary)] text-right block w-full py-1 truncate"
                      >
                        {level2Node.topic.name}
                      </button>

                      {level2Node.children.length > 0 && (
                        <ul className="pr-3 space-y-0.5 border-r border-[var(--color-border)]">
                          {level2Node.children.map((level3Node) => (
                            <li key={level3Node.topic.id}>
                              <button
                                type="button"
                                onClick={() => handleSelect(level3Node.topic.id)}
                                className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-primary)] text-right block w-full py-1 truncate"
                              >
                                {level3Node.topic.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
