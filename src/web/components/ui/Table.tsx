import type { ReactNode } from 'react';
import { t } from '../../resources/i18n';

export interface TableColumn<T> {
  key: string;
  header: string;
  numeric?: boolean;
  render: (row: T) => ReactNode;
}

export interface TableProps<T> {
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  getRowKey: (row: T, index: number) => string;
  emptyText?: string;
}

export function Table<T>({
  columns,
  rows,
  getRowKey,
  emptyText,
}: TableProps<T>) {
  return (
    <div className="w-full overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <table className="w-full min-w-[520px] text-right border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-4 py-3 text-xs font-semibold text-[var(--color-muted)] whitespace-nowrap ${
                  column.numeric ? 'tabular-nums-strict' : ''
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-[var(--color-border)] text-xs sm:text-sm">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-[var(--color-muted)]"
              >
                {emptyText ?? t('ui.table.emptyText')}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                key={getRowKey(row, index)}
                className="hover:bg-[var(--color-surface-alt)]/60 transition-colors"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3 text-[var(--color-text)] align-middle ${
                      column.numeric ? 'tabular-nums-strict whitespace-nowrap' : ''
                    }`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
