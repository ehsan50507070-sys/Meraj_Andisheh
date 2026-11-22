import { CatalogExplorerView } from '../content/CatalogExplorerView';

export interface SearchResultsPageProps {
  currentRoute: string;
}

export function SearchResultsPage({ currentRoute }: SearchResultsPageProps) {
  return <CatalogExplorerView mode="search" currentRoute={currentRoute} />;
}
