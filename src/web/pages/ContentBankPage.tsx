import { CatalogExplorerView } from '../content/CatalogExplorerView';

export interface ContentBankPageProps {
  currentRoute: string;
}

export function ContentBankPage({ currentRoute }: ContentBankPageProps) {
  return <CatalogExplorerView mode="bank" currentRoute={currentRoute} />;
}
