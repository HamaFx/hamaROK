import type { CSSProperties, ReactNode } from 'react';

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function PageHero({
  title,
  subtitle,
  actions,
  badges,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  badges?: string[];
}) {
  return (
    <div className="page-hero">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
        {badges && badges.length > 0 ? (
          <div className="page-hero-badges">
            {badges.map((badge) => (
              <span className="status-pill neutral" key={badge}>
                {badge}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {actions ? <div className="page-hero-actions">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('panel', className)}>
      {title || subtitle || actions ? (
        <header className="panel-head">
          <div>
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
}) {
  return (
    <article className={cn('kpi-card', `tone-${tone}`)}>
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      {hint ? <p className="kpi-hint">{hint}</p> : null}
    </article>
  );
}

export function MetricStrip({
  items,
}: {
  items: Array<{ label: string; value: string | number; accent?: 'gold' | 'teal' | 'rose' | 'slate' }>;
}) {
  return (
    <div className="metric-strip">
      {items.map((item) => (
        <div className="metric-item" key={item.label}>
          <span>{item.label}</span>
          <strong className={cn(item.accent ? `accent-${item.accent}` : '')}>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function FilterBar({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn('filter-bar', className)} style={style}>
      {children}
    </div>
  );
}

export function ActionToolbar({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn('action-toolbar', className)} style={style}>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state v2-empty-state">
      <div className="empty-state-mark" />
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="mt-16">{action}</div> : null}
    </div>
  );
}

export function SkeletonSet({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-set">
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="skeleton-line" />
      ))}
    </div>
  );
}

export function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
}) {
  return <span className={cn('status-pill', tone)}>{label}</span>;
}

export interface DataTableLiteColumn<T> {
  key: string;
  label: string;
  className?: string;
  thClassName?: string;
  sortable?: boolean;
  render: (row: T, index: number) => ReactNode;
}

export function DataTableLite<T>({
  columns,
  rows,
  rowKey,
  onSort,
  sortKey,
  sortDir,
  stickyFirst = false,
  dense = false,
  emptyLabel = 'No records found.',
}: {
  columns: DataTableLiteColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onSort?: (key: string) => void;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  stickyFirst?: boolean;
  dense?: boolean;
  emptyLabel?: string;
}) {
  return (
    <div className={cn('data-table-wrap', stickyFirst ? 'sticky-first-col' : '')}>
      <table className={cn('data-table', dense ? 'data-table-dense' : '')}>
        <thead>
          <tr>
            {columns.map((column, index) => {
              const sortable = column.sortable && onSort;
              const activeSort = sortKey === column.key;
              return (
                <th
                  key={column.key}
                  className={cn(column.thClassName, index === 0 && stickyFirst ? 'sticky-col' : '')}
                  onClick={sortable ? () => onSort?.(column.key) : undefined}
                  role={sortable ? 'button' : undefined}
                  tabIndex={sortable ? 0 : undefined}
                  onKeyDown={
                    sortable
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onSort?.(column.key);
                          }
                        }
                      : undefined
                  }
                >
                  <span className="th-label">
                    {column.label}
                    {activeSort ? <span>{sortDir === 'desc' ? ' ↓' : ' ↑'}</span> : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={rowKey(row, idx)}>
              {columns.map((column, colIdx) => (
                <td
                  key={`${rowKey(row, idx)}-${column.key}`}
                  className={cn(column.className, colIdx === 0 && stickyFirst ? 'sticky-col' : '')}
                >
                  {column.render(row, idx)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="table-empty">
                {emptyLabel}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
