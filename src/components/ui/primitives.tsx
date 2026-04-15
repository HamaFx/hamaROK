'use client';

import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
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
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="relative mb-6 overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(145deg,rgba(16,21,34,0.96),rgba(8,11,19,0.96))] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.4)] sm:p-6 lg:p-8"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(133,187,255,0.48),transparent)]" />
      <div className="absolute right-0 top-0 h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(91,155,255,0.2),transparent_60%)] blur-2xl" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.28em] text-white/42">Player-Facing Surface</p>
          <h1 className="font-[family-name:var(--font-sora)] text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/62 sm:text-base">{subtitle}</p>
          ) : null}
          {badges?.length ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {badges.map((badge) => (
                <StatusPill key={badge} label={badge} tone="neutral" />
              ))}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex w-full flex-wrap gap-2 [&>*]:w-full sm:[&>*]:w-auto lg:w-auto">{actions}</div> : null}
      </div>
    </motion.section>
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
    <Card className={cn('overflow-hidden border-white/10 bg-[rgba(12,16,27,0.92)] shadow-[0_18px_50px_rgba(0,0,0,0.32)]', className)}>
      {title || subtitle || actions ? (
        <CardHeader className="flex flex-col gap-4 border-b border-white/6 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            {title ? <CardTitle className="font-[family-name:var(--font-sora)] text-lg text-white">{title}</CardTitle> : null}
            {subtitle ? <CardDescription className="text-sm text-white/56">{subtitle}</CardDescription> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </CardHeader>
      ) : null}
      <CardContent className="p-4 sm:p-6">{children}</CardContent>
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
    <Card className={cn('overflow-hidden border-white/10 bg-[rgba(11,15,24,0.92)] shadow-[0_18px_40px_rgba(0,0,0,0.28)]', toneClasses(tone))}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/45">{label}</p>
            <p className="font-[family-name:var(--font-sora)] text-3xl font-semibold tracking-tight text-white">
              {animated && typeof value === 'number' ? <AnimatedCounter value={value} /> : value}
            </p>
            {hint ? <p className="text-sm leading-6 text-white/58">{hint}</p> : null}
          </div>
          {icon ? (
            <div className="rounded-2xl border border-white/10 bg-white/6 p-3 text-white/72">{icon}</div>
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
    <div className="grid gap-2 sm:flex sm:flex-wrap">
      {items.map((item) => (
        <div key={item.label} className="flex w-full min-w-0 items-center justify-between gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/58 sm:inline-flex sm:w-auto sm:justify-start">
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
        'flex flex-wrap items-center gap-2 rounded-[24px] border border-white/8 bg-white/4 p-3 [&>*]:min-w-0',
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
    <div className={cn('flex flex-wrap items-center gap-2', className)} style={style}>
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
    <div className="flex flex-col items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-white/3 px-6 py-12 text-center">
      <div className="mb-4 size-12 rounded-full border border-white/10 bg-white/6" />
      <h3 className="font-[family-name:var(--font-sora)] text-lg text-white">{title}</h3>
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
    <Badge className={cn('rounded-full border px-3 py-1 text-[11px] font-medium tracking-[0.12em] uppercase', toneClasses(tone))}>
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
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[rgba(11,15,24,0.9)]">
      <Table>
        <TableHeader>
          <TableRow className="border-white/8 hover:bg-transparent">
            {columns.map((column, index) => {
              const sortable = column.sortable && onSort;
              return (
                <TableHead
                  key={column.key}
                  className={cn(
                    'h-12 border-b border-white/8 bg-white/[0.03] text-[11px] font-medium uppercase tracking-[0.18em] text-white/45',
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
                      dense ? 'py-2.5' : 'py-4',
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
              'rounded-[24px] border border-white/10 bg-[rgba(11,15,24,0.92)] p-4 shadow-[0_10px_26px_rgba(0,0,0,0.22)]',
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
