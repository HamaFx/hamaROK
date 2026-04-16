'use client';

import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function toneClasses(tone: 'neutral' | 'good' | 'warn' | 'bad' | 'info') {
  return {
    neutral: 'border-white/10 bg-white/6 text-white/70',
    good: 'border-emerald-400/18 bg-emerald-400/10 text-emerald-100',
    warn: 'border-sky-300/18 bg-sky-300/10 text-sky-100',
    bad: 'border-rose-300/18 bg-rose-400/10 text-rose-100',
    info: 'border-indigo-300/18 bg-indigo-300/10 text-indigo-100',
  }[tone];
}

export function AnimatedCounter({ value, duration = 900 }: { value: string | number; duration?: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (typeof value !== 'number') return;
    let frame = 0;
    let start: number | null = null;

    const tick = (time: number) => {
      if (start == null) start = time;
      const progress = Math.min((time - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(value * eased));
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value, duration]);

  if (typeof value !== 'number') return <span>{value}</span>;
  return <span>{count.toLocaleString()}</span>;
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
    <section className="relative overflow-hidden rounded-[28px] border border-white/12 bg-[linear-gradient(145deg,rgba(16,22,36,0.97),rgba(8,11,19,0.98))] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.32)] max-[390px]:rounded-[22px] max-[390px]:p-4 sm:p-8">
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(133,187,255,0.48),transparent)]" />
      <div className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(91,155,255,0.22),transparent_65%)] blur-2xl" />
      <div className="absolute -bottom-8 left-1/3 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(124,226,255,0.12),transparent_65%)] blur-2xl" />
      <div className="relative grid gap-5 max-[390px]:gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.26em] text-white/42">Player-Facing Surface</p>
          <h1 className="font-heading text-[1.9rem] font-semibold tracking-tight text-white max-[390px]:text-[1.62rem] sm:text-4xl lg:text-[3.35rem]">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-3 max-w-3xl text-[13px] leading-6 text-white/62 max-[390px]:text-xs max-[390px]:leading-5 sm:mt-4 sm:text-base sm:leading-7">{subtitle}</p>
          ) : null}
          {badges?.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {badges.map((badge) => (
                <StatusPill key={badge} label={badge} tone="neutral" />
              ))}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex w-full flex-wrap gap-2 [&>*]:w-full sm:[&>*]:w-auto lg:w-auto">{actions}</div> : null}
      </div>
    </section>
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
    <Card className={cn('overflow-hidden border-white/12 bg-[linear-gradient(160deg,rgba(13,18,30,0.95),rgba(9,13,22,0.96))] shadow-[0_18px_48px_rgba(0,0,0,0.28)]', className)}>
      {title || subtitle || actions ? (
        <CardHeader className="flex flex-col gap-3 border-b border-white/8 pb-3.5 text-left max-[390px]:gap-2.5 max-[390px]:pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5 pr-2 text-left">
            {title ? <CardTitle className="font-heading text-[1.15rem] text-white max-[390px]:text-base sm:text-xl">{title}</CardTitle> : null}
            {subtitle ? <CardDescription className="text-[13px] text-white/58 max-[390px]:text-xs">{subtitle}</CardDescription> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </CardHeader>
      ) : null}
      <CardContent className="p-4 max-[390px]:p-3.5 sm:p-5 lg:p-6">{children}</CardContent>
    </Card>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  animated = true,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
  animated?: boolean;
}) {
  return (
    <Card className={cn('overflow-hidden border-white/12 bg-[rgba(10,14,24,0.92)]', toneClasses(tone))}>
      <CardContent className="p-4 max-[390px]:p-3.5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/45">{label}</p>
            <p className="font-heading text-[1.7rem] font-semibold tracking-tight text-white max-[390px]:text-[1.42rem] sm:text-[2rem]">
              {animated && typeof value === 'number' ? <AnimatedCounter value={value} /> : value}
            </p>
            {hint ? <p className="text-[13px] leading-5 text-white/58 max-[390px]:text-xs">{hint}</p> : null}
          </div>
          {icon ? (
            <div className="rounded-2xl border border-white/10 bg-white/8 p-2.5 text-white/72 max-[390px]:p-2">{icon}</div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function MetricStrip({
  items,
}: {
  items: Array<{ label: string; value: string | number; accent?: 'gold' | 'teal' | 'rose' | 'slate' }>;
}) {
  const accentMap = {
    gold: 'text-[#ffd47a]',
    teal: 'text-sky-200',
    rose: 'text-rose-200',
    slate: 'text-white/70',
  } as const;

  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap sm:gap-2.5">
      {items.map((item) => (
        <div key={item.label} className="flex w-full min-w-0 items-center justify-between gap-3 rounded-full border border-white/10 bg-white/7 px-3.5 py-1.5 text-[13px] text-white/58 max-[390px]:px-3 max-[390px]:py-1.5 max-[390px]:text-xs sm:inline-flex sm:w-auto sm:justify-start sm:text-sm">
          <span className="shrink-0">{item.label}</span>
          <strong className={cn('min-w-0 truncate font-medium text-white', item.accent ? accentMap[item.accent] : null)}>{item.value}</strong>
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
    <div
      className={cn(
        'flex flex-wrap items-center gap-2.5 rounded-[22px] border border-white/10 bg-white/5 p-3.5 [&>*]:min-w-0',
        'max-[390px]:gap-2 max-[390px]:rounded-[18px] max-[390px]:p-2.5',
        className
      )}
      style={style}
    >
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
    <div className={cn('flex flex-wrap items-center gap-2.5', className)} style={style}>
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
    <div className="flex flex-col items-center justify-center rounded-[26px] border border-dashed border-white/12 bg-white/5 px-6 py-12 text-center">
      <div className="mb-4 size-12 rounded-full border border-white/10 bg-white/6" />
      <h3 className="font-heading text-lg text-white">{title}</h3>
      {description ? <p className="mt-3 max-w-lg text-sm leading-6 text-white/56">{description}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function SkeletonSet({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, idx) => (
        <Skeleton key={idx} className="h-14 rounded-2xl bg-white/8" />
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
  return (
    <Badge className={cn('rounded-full border px-3 py-1 text-[10px] font-semibold tracking-[0.14em] uppercase max-[390px]:px-2.5 max-[390px]:text-[9px]', toneClasses(tone))}>
      {label}
    </Badge>
  );
}

export interface DataTableLiteColumn<T> {
  key: string;
  label: string;
  className?: string;
  thClassName?: string;
  sortable?: boolean;
  mobileHidden?: boolean;
  render: (row: T, index: number) => ReactNode;
}

export function DataTableLite<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  onSort,
  sortKey,
  sortDir,
  stickyFirst = false,
  dense = false,
  mobileCards = true,
  emptyLabel = 'No records found.',
}: {
  columns: DataTableLiteColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  rowClassName?: (row: T, index: number) => string | undefined;
  onSort?: (key: string) => void;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  stickyFirst?: boolean;
  dense?: boolean;
  mobileCards?: boolean;
  emptyLabel?: string;
}) {
  const renderSortIcon = (columnKey: string) => {
    if (sortKey !== columnKey) return <ArrowUpDown className="size-3.5 text-white/28" />;
    return sortDir === 'desc' ? <ChevronDown className="size-3.5 text-white/58" /> : <ChevronUp className="size-3.5 text-white/58" />;
  };

  const tableContent = (
    <div className="overflow-hidden rounded-[26px] border border-white/12 bg-[rgba(11,15,24,0.9)]">
      <Table>
        <TableHeader>
          <TableRow className="border-white/8 hover:bg-transparent">
            {columns.map((column, index) => {
              const sortable = column.sortable && onSort;
              return (
                <TableHead
                  key={column.key}
                  className={cn(
                    'h-12 border-b border-white/8 bg-white/[0.03] px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45',
                    column.thClassName,
                    index === 0 && stickyFirst && 'sticky left-0 z-10 bg-[rgba(11,15,24,0.96)]'
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 text-left text-inherit"
                      onClick={() => onSort?.(column.key)}
                    >
                      <span>{column.label}</span>
                      {renderSortIcon(column.key)}
                    </button>
                  ) : (
                    column.label
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="border-white/6 hover:bg-transparent">
              <TableCell colSpan={columns.length} className="py-10 text-center text-sm text-white/48">
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, idx) => (
              <TableRow
                key={rowKey(row, idx)}
                className={cn(
                  'border-white/6 text-white/78 transition-colors hover:bg-white/[0.04]',
                  rowClassName?.(row, idx)
                )}
              >
                {columns.map((column, colIdx) => (
                  <TableCell
                    key={`${rowKey(row, idx)}-${column.key}`}
                    className={cn(
                      dense ? 'px-3 py-3' : 'px-3 py-4',
                      'align-middle',
                      column.className,
                      colIdx === 0 && stickyFirst && 'sticky left-0 bg-[rgba(11,15,24,0.96)]'
                    )}
                  >
                    {column.render(row, idx)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );

  const mobileCardList = (
    <div className="grid gap-3 md:hidden">
      {rows.length === 0 ? (
        <div className="rounded-[24px] border border-white/10 bg-white/4 px-5 py-8 text-center text-sm text-white/48">{emptyLabel}</div>
      ) : (
        rows.map((row, idx) => (
          <article
            key={rowKey(row, idx)}
            className={cn(
              'rounded-[24px] border border-white/10 bg-[rgba(11,15,24,0.92)] p-4 shadow-[0_12px_28px_rgba(0,0,0,0.22)]',
              rowClassName?.(row, idx)
            )}
          >
            <div className="grid gap-3">
              {columns
                .filter((column) => !column.mobileHidden)
                .map((column) => (
                  <div key={`${rowKey(row, idx)}-${column.key}-mobile`} className="grid gap-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/38">{column.label}</span>
                    <div className="text-sm text-white/80">{column.render(row, idx)}</div>
                  </div>
                ))}
            </div>
          </article>
        ))
      )}
    </div>
  );

  if (!mobileCards) {
    return <div className="overflow-x-auto">{tableContent}</div>;
  }

  return (
    <>
      <div className="hidden md:block">{tableContent}</div>
      {mobileCardList}
    </>
  );
}
