import { ChevronDown, ChevronLeft, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { CONTENT_FORMATS, type ContentFormat } from '../../core/domain/content';
import type { AgeGroup, Topic } from '../../core/domain/taxonomy';
import type {
  CatalogFacetsCounts,
  CatalogTaxonomyLists,
} from '../../core/services/contentCatalogService';
import { defaultSearchNormalizer } from '../../core/services/searchNormalizer';
import { buildTopicTree, type TopicTreeNode } from '../../core/services/taxonomyService';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import type { CatalogFilterState } from './catalogHashParams';

export interface CatalogFilterSidebarProps {
  state: CatalogFilterState;
  taxonomy: CatalogTaxonomyLists;
  facetsCounts: CatalogFacetsCounts;
  activeAgeGroup: AgeGroup | null;
  onToggleTopic: (topicId: number) => void;
  onToggleFormat: (format: ContentFormat) => void;
  onToggleTag: (tagId: number) => void;
  onTogglePerson: (personId: number) => void;
  onToggleImpact: (impactId: number) => void;
  onToggleAgeGroup: (ageGroupId: number) => void;
  onClearAll: () => void;
}

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[var(--color-border)] last:border-b-0 py-3.5">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label={t('catalog.filters.expandSectionAria', { title })}
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between gap-2 text-right py-1 text-sm font-bold text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] rounded-sm"
      >
        <span>{title}</span>
        <ChevronDown
          className={`w-4 h-4 text-[var(--color-muted)] shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && <div className="pt-3 space-y-2.5">{children}</div>}
    </div>
  );
}

function matchesSearchFilter(label: string, searchText: string): boolean {
  const normSearch = defaultSearchNormalizer.normalize(searchText);
  if (!normSearch) {
    return true;
  }
  const normLabel = defaultSearchNormalizer.normalize(label);
  if (normLabel.includes(normSearch)) {
    return true;
  }
  const compactSearch = normSearch.replace(/\s+/g, '');
  const compactLabel = normLabel.replace(/\s+/g, '');
  return compactSearch.length > 0 && compactLabel.includes(compactSearch);
}

function filterTopicTreeNodes(
  nodes: readonly TopicTreeNode[],
  searchText: string,
): TopicTreeNode[] {
  const trimmed = searchText.trim();
  if (!trimmed) {
    return [...nodes];
  }

  const out: TopicTreeNode[] = [];
  for (const node of nodes) {
    const filteredChildren = filterTopicTreeNodes(node.children, trimmed);
    const selfMatches = matchesSearchFilter(node.topic.name, trimmed);
    if (selfMatches || filteredChildren.length > 0) {
      out.push({
        ...node,
        children: filteredChildren,
      });
    }
  }
  return out;
}

interface TopicTreeRowProps {
  node: TopicTreeNode;
  selectedSet: ReadonlySet<number>;
  expandedBranchIds: Record<number, boolean>;
  forceExpandAll: boolean;
  topicCounts: Record<number, number>;
  onToggleExpandBranch: (id: number) => void;
  onToggleTopic: (id: number) => void;
}

function TopicTreeRow({
  node,
  selectedSet,
  expandedBranchIds,
  forceExpandAll,
  topicCounts,
  onToggleExpandBranch,
  onToggleTopic,
}: TopicTreeRowProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = forceExpandAll || Boolean(expandedBranchIds[node.topic.id]);
  const isChecked = selectedSet.has(node.topic.id);
  const count = topicCounts[node.topic.id] ?? 0;

  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between gap-2 min-h-[34px]">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggleExpandBranch(node.topic.id)}
              aria-expanded={isExpanded}
              aria-label={t('catalog.filters.expandBranchAria', { name: node.topic.name })}
              className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-control)] text-[var(--color-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)] shrink-0"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          ) : (
            <span className="w-6 shrink-0" aria-hidden="true" />
          )}

          <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer py-0.5 select-none">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => onToggleTopic(node.topic.id)}
              className="w-4 h-4 rounded accent-[var(--color-primary)] shrink-0"
            />
            <span className="text-xs sm:text-sm text-[var(--color-text)] truncate">
              {node.topic.name}
            </span>
          </label>
        </div>

        <span className="text-[11px] text-[var(--color-muted)] tabular-nums-strict shrink-0">
          {toPersianDigits(count)}
        </span>
      </div>

      {hasChildren && isExpanded && (
        <ul className="pr-4 border-r border-[var(--color-border)] space-y-1">
          {node.children.map((child) => (
            <TopicTreeRow
              key={child.topic.id}
              node={child}
              selectedSet={selectedSet}
              expandedBranchIds={expandedBranchIds}
              forceExpandAll={forceExpandAll}
              topicCounts={topicCounts}
              onToggleExpandBranch={onToggleExpandBranch}
              onToggleTopic={onToggleTopic}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function CatalogFilterSidebar({
  state,
  taxonomy,
  facetsCounts,
  activeAgeGroup,
  onToggleTopic,
  onToggleFormat,
  onToggleTag,
  onTogglePerson,
  onToggleImpact,
  onToggleAgeGroup,
  onClearAll,
}: CatalogFilterSidebarProps) {
  const [topicSearch, setTopicSearch] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [personSearch, setPersonSearch] = useState('');
  const [expandedBranches, setExpandedBranches] = useState<Record<number, boolean>>({});

  const activeTopics = useMemo<Topic[]>(
    () => taxonomy.topics.filter((topic) => topic.isActive),
    [taxonomy.topics],
  );
  const topicCountMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const [key, value] of Object.entries(facetsCounts.topics)) {
      map.set(Number(key), value);
    }
    return map;
  }, [facetsCounts.topics]);

  const topicTree = useMemo(
    () => buildTopicTree(activeTopics, topicCountMap),
    [activeTopics, topicCountMap],
  );
  const filteredTopicTree = useMemo(
    () => filterTopicTreeNodes(topicTree, topicSearch),
    [topicTree, topicSearch],
  );

  const selectedTopicSet = useMemo(() => new Set(state.topicIds), [state.topicIds]);
  const selectedFormatSet = useMemo(() => new Set(state.formats), [state.formats]);
  const selectedTagSet = useMemo(() => new Set(state.tagIds), [state.tagIds]);
  const selectedPersonSet = useMemo(() => new Set(state.personIds), [state.personIds]);
  const selectedImpactSet = useMemo(
    () => new Set(state.impactLevelIds),
    [state.impactLevelIds],
  );
  const selectedAgeSet = useMemo(
    () => new Set(state.filterAgeGroupIds),
    [state.filterAgeGroupIds],
  );

  const filteredTags = useMemo(
    () => taxonomy.tags.filter((tag) => matchesSearchFilter(tag.name, tagSearch)),
    [taxonomy.tags, tagSearch],
  );
  const filteredPersons = useMemo(
    () => taxonomy.persons.filter((person) => matchesSearchFilter(person.name, personSearch)),
    [taxonomy.persons, personSearch],
  );
  const activeAgeGroups = useMemo(
    () => taxonomy.ageGroups.filter((group) => group.isActive),
    [taxonomy.ageGroups],
  );

  const hasAnyFilter =
    state.topicIds.length > 0 ||
    state.formats.length > 0 ||
    state.tagIds.length > 0 ||
    state.personIds.length > 0 ||
    state.impactLevelIds.length > 0 ||
    state.filterAgeGroupIds.length > 0;

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-[var(--color-border)]">
        <h2 className="text-base font-bold text-[var(--color-text)]">
          {t('catalog.filters.title')}
        </h2>
        {hasAnyFilter && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs font-semibold text-[var(--color-primary)] hover:underline underline-offset-4 whitespace-nowrap"
          >
            {t('catalog.filters.clearAll')}
          </button>
        )}
      </div>

      {/* 1. Hierarchical Topics Tree */}
      <CollapsibleSection title={t('catalog.filters.section.topics')} defaultOpen>
        <div className="relative">
          <input
            type="search"
            value={topicSearch}
            onChange={(e) => setTopicSearch(e.target.value)}
            placeholder={t('catalog.filters.searchTopicsPlaceholder')}
            aria-label={t('catalog.filters.searchTopicsPlaceholder')}
            className="w-full min-h-[36px] pr-8 pl-2.5 py-1 text-xs bg-[var(--color-surface-alt)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] border border-[var(--color-border)] rounded-[var(--radius-control)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
          />
          <Search
            className="w-3.5 h-3.5 text-[var(--color-muted)] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
        </div>

        {filteredTopicTree.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)] py-1">
            {t('catalog.filters.noMatchInList')}
          </p>
        ) : (
          <ul className="space-y-1 max-h-64 overflow-y-auto pl-1">
            {filteredTopicTree.map((rootNode) => (
              <TopicTreeRow
                key={rootNode.topic.id}
                node={rootNode}
                selectedSet={selectedTopicSet}
                expandedBranchIds={expandedBranches}
                forceExpandAll={topicSearch.trim().length > 0}
                topicCounts={facetsCounts.topics}
                onToggleExpandBranch={(id) =>
                  setExpandedBranches((prev) => ({ ...prev, [id]: !prev[id] }))
                }
                onToggleTopic={onToggleTopic}
              />
            ))}
          </ul>
        )}
      </CollapsibleSection>

      {/* 2. Content Formats */}
      <CollapsibleSection title={t('catalog.filters.section.formats')} defaultOpen>
        <ul className="space-y-1.5">
          {CONTENT_FORMATS.map((format) => {
            const labelKey = `catalog.format.${format}` as ResourceKey;
            const count = facetsCounts.formats[format] ?? 0;
            return (
              <li key={format} className="flex items-center justify-between gap-2 min-h-[32px]">
                <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedFormatSet.has(format)}
                    onChange={() => onToggleFormat(format)}
                    className="w-4 h-4 rounded accent-[var(--color-primary)] shrink-0"
                  />
                  <span className="text-xs sm:text-sm text-[var(--color-text)] truncate">
                    {t(labelKey)}
                  </span>
                </label>
                <span className="text-[11px] text-[var(--color-muted)] tabular-nums-strict shrink-0">
                  {toPersianDigits(count)}
                </span>
              </li>
            );
          })}
        </ul>
      </CollapsibleSection>

      {/* 3. Tags */}
      <CollapsibleSection title={t('catalog.filters.section.tags')} defaultOpen={state.tagIds.length > 0}>
        <div className="relative">
          <input
            type="search"
            value={tagSearch}
            onChange={(e) => setTagSearch(e.target.value)}
            placeholder={t('catalog.filters.searchTagsPlaceholder')}
            aria-label={t('catalog.filters.searchTagsPlaceholder')}
            className="w-full min-h-[36px] pr-8 pl-2.5 py-1 text-xs bg-[var(--color-surface-alt)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] border border-[var(--color-border)] rounded-[var(--radius-control)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
          />
          <Search
            className="w-3.5 h-3.5 text-[var(--color-muted)] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
        </div>

        {filteredTags.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)] py-1">
            {t('catalog.filters.noMatchInList')}
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-52 overflow-y-auto pl-1">
            {filteredTags.map((tag) => (
              <li key={tag.id} className="flex items-center justify-between gap-2 min-h-[32px]">
                <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedTagSet.has(tag.id)}
                    onChange={() => onToggleTag(tag.id)}
                    className="w-4 h-4 rounded accent-[var(--color-primary)] shrink-0"
                  />
                  <span className="text-xs sm:text-sm text-[var(--color-text)] truncate">
                    {tag.name}
                  </span>
                </label>
                <span className="text-[11px] text-[var(--color-muted)] tabular-nums-strict shrink-0">
                  {toPersianDigits(facetsCounts.tags[tag.id] ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      {/* 4. Persons */}
      <CollapsibleSection
        title={t('catalog.filters.section.persons')}
        defaultOpen={state.personIds.length > 0}
      >
        <div className="relative">
          <input
            type="search"
            value={personSearch}
            onChange={(e) => setPersonSearch(e.target.value)}
            placeholder={t('catalog.filters.searchPersonsPlaceholder')}
            aria-label={t('catalog.filters.searchPersonsPlaceholder')}
            className="w-full min-h-[36px] pr-8 pl-2.5 py-1 text-xs bg-[var(--color-surface-alt)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] border border-[var(--color-border)] rounded-[var(--radius-control)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
          />
          <Search
            className="w-3.5 h-3.5 text-[var(--color-muted)] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
        </div>

        {filteredPersons.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)] py-1">
            {t('catalog.filters.noMatchInList')}
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-52 overflow-y-auto pl-1">
            {filteredPersons.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-2 min-h-[32px]">
                <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedPersonSet.has(person.id)}
                    onChange={() => onTogglePerson(person.id)}
                    className="w-4 h-4 rounded accent-[var(--color-primary)] shrink-0"
                  />
                  <span className="text-xs sm:text-sm text-[var(--color-text)] truncate">
                    {person.name}
                  </span>
                </label>
                <span className="text-[11px] text-[var(--color-muted)] tabular-nums-strict shrink-0">
                  {toPersianDigits(facetsCounts.persons[person.id] ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      {/* 5. Impact Levels */}
      <CollapsibleSection
        title={t('catalog.filters.section.impacts')}
        defaultOpen={state.impactLevelIds.length > 0}
      >
        <ul className="space-y-1.5">
          {taxonomy.impactLevels.map((impact) => (
            <li key={impact.id} className="flex items-center justify-between gap-2 min-h-[32px]">
              <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedImpactSet.has(impact.id)}
                  onChange={() => onToggleImpact(impact.id)}
                  className="w-4 h-4 rounded accent-[var(--color-primary)] shrink-0"
                />
                <span className="text-xs sm:text-sm text-[var(--color-text)] truncate">
                  {impact.name}
                </span>
              </label>
              <span className="text-[11px] text-[var(--color-muted)] tabular-nums-strict shrink-0">
                {toPersianDigits(facetsCounts.impactLevels[impact.id] ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      {/* 6. Target Age Groups */}
      <CollapsibleSection
        title={t('catalog.filters.section.ages')}
        defaultOpen={state.filterAgeGroupIds.length > 0}
      >
        {activeAgeGroup?.key === 'child' && (
          <p className="text-[11px] leading-relaxed text-[var(--color-info-text)] bg-[var(--color-info-bg)] rounded-[var(--radius-control)] px-2.5 py-2">
            {t('catalog.filters.childSafetyNotice')}
          </p>
        )}

        <ul className="space-y-1.5">
          {activeAgeGroups.map((group) => (
            <li key={group.id} className="flex items-center justify-between gap-2 min-h-[32px]">
              <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedAgeSet.has(group.id)}
                  onChange={() => onToggleAgeGroup(group.id)}
                  className="w-4 h-4 rounded accent-[var(--color-primary)] shrink-0"
                />
                <span className="text-xs sm:text-sm text-[var(--color-text)] truncate">
                  {group.name}
                </span>
              </label>
              <span className="text-[11px] text-[var(--color-muted)] tabular-nums-strict shrink-0">
                {toPersianDigits(facetsCounts.ageGroups[group.id] ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    </div>
  );
}
