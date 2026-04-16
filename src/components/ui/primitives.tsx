'use client';

import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UiDensity } from '@/features/shared/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
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
    neutral: 'border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-[color:var(--text-2)]',
    good: 'border-emerald-400/24 bg-emerald-400/12 text-emerald-100',
    warn: 'border-cyan-300/26 bg-cyan-300/12 text-cyan-100',
    bad: 'border-rose-300/24 bg-rose-400/12 text-rose-100',
    info: 'border-sky-300/24 bg-sky-300/12 text-sky-100',
  }[tone];
}

function resolveDensity(density?: UiDensity, compact?: boolean): UiDensity {
  if (compact) return 'compact';
  return density ?? 'balanced-compact';
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
  density,
  compact,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  badges?: string[];
  density?: UiDensity;
  compact?: boolean;
}) {
  const activeDensity = resolveDensity(density, compact);

  const shellDensity =
    activeDensity === 'comfortable'
      ? 'rounded-[22px] p-3.5 min-[390px]:rounded-[24px] min-[390px]:p-4 sm:p-5 lg:p-6'
      : activeDensity === 'compact'
        ? 'rounded-[18px] p-2.5 min-[390px]:rounded-[20px] min-[390px]:p-3 sm:rounded-[22px] sm:p-3.5 lg:p-4'
        : 'rounded-[20px] p-3 min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4 lg:p-5';

  const titleDensity =
    activeDensity === 'comfortable'
      ? 'text-[1.62rem] min-[390px]:text-[1.78rem] sm:text-3xl lg:text-[3rem]'
      : activeDensity === 'compact'
        ? 'text-[1.4rem] min-[390px]:text-[1.56rem] sm:text-[1.95rem] lg:text-[2.55rem]'
        : 'text-[1.5rem] min-[390px]:text-[1.66rem] sm:text-[2.15rem] lg:text-[2.85rem]';

  return (
    <section className={cn('surface-1 relative overflow-hidden', shellDensity)}>
      <div className="absolute inset-x-0 top-0 h-px bg-[color:var(--stroke-subtle)]" />
      <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--tone-teal)_20%,transparent),transparent_65%)] blur-2xl" />
      <div className="absolute -bottom-8 left-1/3 h-32 w-32 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--tone-teal)_14%,transparent),transparent_65%)] blur-2xl" />
      <div className="relative grid gap-3 min-[390px]:gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="micro-label mb-2">Player-facing surface</p>
          <h1 className={cn('font-heading font-semibold tracking-tight text-tier-1', titleDensity)}>
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 max-w-3xl text-xs leading-5 text-tier-3 min-[390px]:mt-2.5 min-[390px]:text-[13px] sm:mt-3 sm:text-sm sm:leading-6">{subtitle}</p>
          ) : null}
          {badges?.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5 sm:gap-2">
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
  density,
  compact,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  density?: UiDensity;
  compact?: boolean;
}) {
  const activeDensity = resolveDensity(density, compact);
  const contentDensity =
    activeDensity === 'comfortable'
      ? 'p-3.5 min-[390px]:p-4 sm:p-5 lg:p-6'
      : activeDensity === 'compact'
        ? 'p-2.5 min-[390px]:p-3 sm:p-3.5 lg:p-4'
        : 'p-3 min-[390px]:p-3.5 sm:p-4 lg:p-5';

  const headerDensity =
    activeDensity === 'comfortable'
      ? 'gap-2.5 pb-3 min-[390px]:gap-3 min-[390px]:pb-3.5'
      : activeDensity === 'compact'
        ? 'gap-1.5 pb-2 min-[390px]:gap-2 min-[390px]:pb-2.5'
        : 'gap-2 pb-2.5 min-[390px]:gap-2.5 min-[390px]:pb-3';

  return (
    <Card className={cn('surface-1 overflow-hidden', className)}>
      {title || subtitle || actions ? (
        <CardHeader className={cn('flex flex-col border-b border-[color:var(--stroke-subtle)] text-left sm:flex-row sm:items-end sm:justify-between', headerDensity)}>
          <div className="space-y-1.5 pr-2 text-left">
            {title ? <CardTitle className="font-heading text-[0.95rem] text-tier-1 min-[390px]:text-[1.02rem] sm:text-lg">{title}</CardTitle> : null}
            {subtitle ? <CardDescription className="text-xs text-tier-3 min-[390px]:text-[13px]">{subtitle}</CardDescription> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </CardHeader>
      ) : null}
      <CardContent className={contentDensity}>{children}</CardContent>
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
  density,
  compact,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
  animated?: boolean;
  density?: UiDensity;
  compact?: boolean;
}) {
  const activeDensity = resolveDensity(density, compact);
  const bodyDensity =
    activeDensity === 'comfortable'
      ? 'p-3.5 min-[390px]:p-4 sm:p-5'
      : activeDensity === 'compact'
        ? 'p-2.5 min-[390px]:p-3 sm:p-3.5'
        : 'p-3 min-[390px]:p-3.5 sm:p-4';

  const valueDensity =
    activeDensity === 'comfortable'
      ? 'text-[1.44rem] min-[390px]:text-[1.62rem] sm:text-[1.85rem]'
      : activeDensity === 'compact'
        ? 'text-[1.24rem] min-[390px]:text-[1.38rem] sm:text-[1.6rem]'
        : 'text-[1.32rem] min-[390px]:text-[1.5rem] sm:text-[1.72rem]';

  return (
    <Card className={cn('overflow-hidden', toneClasses(tone))}>
      <CardContent className={bodyDensity}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="chip-label text-xs font-medium text-tier-3">{label}</p>
            <p className={cn('font-heading font-semibold tracking-tight text-tier-1', valueDensity)}>
              {animated && typeof value === 'number' ? <AnimatedCounter value={value} /> : value}
            </p>
            {hint ? <p className="text-xs leading-5 text-tier-3 min-[390px]:text-[13px]">{hint}</p> : null}
          </div>
          {icon ? (
            <div className="rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-1.5 text-tier-2 min-[390px]:p-2">{icon}</div>
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
    gold: 'text-[color:var(--rank-gold)]',
    teal: 'text-cyan-200',
    rose: 'text-rose-200',
    slate: 'text-tier-2',
  } as const;

  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap sm:gap-2.5">
      {items.map((item) => (
        <div key={item.label} className="flex w-full min-w-0 items-center justify-between gap-3 rounded-full border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 py-1.5 text-xs text-tier-3 min-[390px]:px-3.5 min-[390px]:text-[13px] sm:inline-flex sm:w-auto sm:justify-start sm:text-sm">
          <span className="shrink-0">{item.label}</span>
          <strong className={cn('min-w-0 truncate font-medium text-tier-1', item.accent ? accentMap[item.accent] : null)}>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function FilterBar({
  children,
  className,
  style,
  density,
  compact,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  density?: UiDensity;
  compact?: boolean;
}) {
  const activeDensity = resolveDensity(density, compact);
  const shellDensity =
    activeDensity === 'comfortable'
      ? 'gap-3 rounded-[20px] p-3 min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:gap-4 sm:p-4'
      : activeDensity === 'compact'
        ? 'gap-2 rounded-[18px] p-2.5 min-[390px]:rounded-[20px] min-[390px]:p-3 sm:rounded-[22px] sm:gap-3 sm:p-3.5'
        : 'gap-3 rounded-[20px] p-3 min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:gap-4 sm:p-4';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] [&>*]:min-w-0 [&_button]:min-h-11 [&_input]:min-h-11 [&_[role=combobox]]:min-h-11',
        shellDensity,
        className
      )}
      style={style}
    >
      {children}
    </div>
  );
}

export function StickyControlBar({
  children,
  className,
  stickyTopClassName,
  density,
  compact,
}: {
  children: ReactNode;
  className?: string;
  stickyTopClassName?: string;
  density?: UiDensity;
  compact?: boolean;
}) {
  const activeDensity = resolveDensity(density, compact);
  const shellDensity =
    activeDensity === 'comfortable'
      ? 'rounded-[20px] p-3 min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4'
      : activeDensity === 'compact'
        ? 'rounded-[18px] p-2.5 min-[390px]:rounded-[20px] min-[390px]:p-3 sm:rounded-[22px] sm:p-3.5'
        : 'rounded-[20px] p-3 min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4';

  return (
    <div
      className={cn(
        'sticky z-20 border border-[color:var(--stroke-subtle)] bg-card/60 backdrop-blur-xl ring-1 ring-white/5 shadow-lg',
        'top-[74px]',
        shellDensity,
        'xl:static xl:border-[color:var(--stroke-subtle)] xl:bg-transparent xl:shadow-none xl:backdrop-blur-none',
        stickyTopClassName,
        className
      )}
    >
      {children}
    </div>
  );
}

export function CompactControlRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 overflow-x-auto rounded-[20px] border border-[color:var(--stroke-soft)] bg-card/80 p-2.5 backdrop-blur-xl ring-1 ring-white/5 shadow-[0_8px_18px_rgba(0,0,0,0.2)]',
        'min-[390px]:rounded-[22px] min-[390px]:p-3 sm:rounded-[24px] sm:gap-2.5 sm:p-3.5',
        '[&>*]:shrink-0 [&_button]:min-h-11 [&_input]:min-h-11 [&_[role=combobox]]:min-h-11',
        className
      )}
    >
      {children}
    </div>
  );
}

export function CompactControlDrawer({
  triggerLabel = 'Filters',
  title,
  description,
  triggerClassName,
  contentClassName,
  open,
  onOpenChange,
  children,
}: {
  triggerLabel?: ReactNode;
  title: string;
  description?: string;
  triggerClassName?: string;
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-4 py-2 text-sm font-medium text-tier-2 hover:bg-[color:var(--surface-4)]',
            triggerClassName
          )}
        >
          {triggerLabel}
        </button>
      </DrawerTrigger>
      <DrawerContent className={cn('border-[color:var(--stroke-soft)] bg-card/90 backdrop-blur-2xl shadow-2xl text-tier-1', contentClassName)}>
        <DrawerHeader>
          <DrawerTitle className="font-heading text-xl text-tier-1">{title}</DrawerTitle>
          {description ? <DrawerDescription className="text-tier-3">{description}</DrawerDescription> : null}
        </DrawerHeader>
        <div className="max-h-[65svh] overflow-auto px-4 pb-4">
          <div className="space-y-4">{children}</div>
        </div>
        <DrawerFooter>
          <DrawerClose asChild>
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-4 py-2 text-sm text-tier-1 hover:bg-[color:var(--surface-4)]"
            >
              Done
            </button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

export function SegmentedChips<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Segmented controls"
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex min-h-11 items-center justify-center rounded-full border px-3.5 py-2 text-xs font-medium tracking-[0.04em] transition-colors',
              active
                ? 'border-cyan-300/26 bg-cyan-300/14 text-tier-1'
                : 'border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-3 hover:bg-[color:var(--surface-4)] hover:text-tier-1'
            )}
          >
            {option.label}
          </button>
        );
      })}
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

export function CompactAlert({
  title,
  description,
  tone = 'neutral',
  className,
}: {
  title: string;
  description?: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
  className?: string;
}) {
  const toneClass = useMemo(
    () =>
      ({
        neutral: 'border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1',
        good: 'border-emerald-300/18 bg-emerald-400/10 text-emerald-100',
        warn: 'border-cyan-300/26 bg-cyan-300/12 text-cyan-100',
        bad: 'border-rose-300/18 bg-rose-400/10 text-rose-100',
        info: 'border-sky-300/22 bg-sky-300/10 text-sky-100',
      })[tone],
    [tone]
  );

  return (
    <Alert className={cn('rounded-2xl', toneClass, className)}>
      <AlertTitle className="font-heading text-sm text-current">{title}</AlertTitle>
      {description ? <AlertDescription className="text-current/85">{description}</AlertDescription> : null}
    </Alert>
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
    <div className="flex flex-col items-center justify-center rounded-[20px] border border-dashed border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-4 py-8 text-center min-[390px]:rounded-[22px] min-[390px]:px-5 min-[390px]:py-10 sm:rounded-[24px]">
      <div className="mb-3 size-10 rounded-full border border-[color:var(--stroke-soft)] bg-[color:var(--surface-4)]" />
      <h3 className="font-heading text-lg text-tier-1">{title}</h3>
      {description ? <p className="mt-2.5 max-w-lg text-sm leading-6 text-tier-3">{description}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function SkeletonSet({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, idx) => (
        <Skeleton key={idx} className="h-14 rounded-2xl bg-[color:var(--surface-4)]" />
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
    <Badge className={cn('chip-label rounded-full border px-2.5 py-1 text-xs font-semibold min-[390px]:px-3', toneClasses(tone))}>
      {label}
    </Badge>
  );
}

export function ActionFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mt-4 flex flex-col gap-2 border-t border-[color:var(--stroke-soft)] pt-3 sm:flex-row sm:flex-wrap sm:items-center',
        className
      )}
    >
      {children}
    </div>
  );
}

export function RowDetailDrawer({
  triggerLabel = 'Details',
  title,
  description,
  children,
  footer,
  className,
}: {
  triggerLabel?: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-4 py-2 text-sm text-tier-2 hover:bg-[color:var(--surface-4)]"
        >
          {triggerLabel}
        </button>
      </DrawerTrigger>
      <DrawerContent className={cn('border-[color:var(--stroke-soft)] bg-card/90 backdrop-blur-2xl shadow-2xl text-tier-1', className)}>
        <DrawerHeader>
          <DrawerTitle className="font-heading text-xl text-tier-1">{title}</DrawerTitle>
          {description ? <DrawerDescription className="text-tier-3">{description}</DrawerDescription> : null}
        </DrawerHeader>
        <div className="max-h-[60svh] overflow-auto px-4 pb-4">{children}</div>
        <DrawerFooter>
          {footer}
          <DrawerClose asChild>
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-4 py-2 text-sm text-tier-1 hover:bg-[color:var(--surface-4)]"
            >
              Close
            </button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
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
  density = 'balanced-compact',
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
  density?: UiDensity;
}) {
  const activeDensity = density;
  const renderSortIcon = (columnKey: string) => {
    if (sortKey !== columnKey) return <ArrowUpDown className="size-3.5 text-tier-4" />;
    return sortDir === 'desc' ? <ChevronDown className="size-3.5 text-tier-3" /> : <ChevronUp className="size-3.5 text-tier-3" />;
  };

  const tableContent = (
    <div
      className={cn(
        'overflow-hidden surface-2 shadow-xl',
        activeDensity === 'comfortable'
          ? 'rounded-[24px]'
          : activeDensity === 'compact'
            ? 'rounded-[18px]'
            : 'rounded-[22px]'
      )}
    >
      <Table>
        <TableHeader>
          <TableRow className="border-[color:var(--stroke-subtle)] hover:bg-transparent">
            {columns.map((column, index) => {
              const sortable = column.sortable && onSort;
              return (
                <TableHead
                  key={column.key}
                  className={cn(
                    'h-12 border-b border-[color:var(--stroke-subtle)] bg-[color:var(--surface-3)] px-3 text-xs font-semibold tracking-[0.06em] text-tier-3',
                    column.thClassName,
                    index === 0 && stickyFirst && 'sticky left-0 z-10 bg-[color:var(--card)] shadow-[4px_0_12px_rgba(0,0,0,0.4)]'
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
            <TableRow className="border-[color:var(--stroke-subtle)] hover:bg-transparent">
              <TableCell colSpan={columns.length} className="py-10 text-center text-sm text-tier-3">
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, idx) => (
              <TableRow
                key={rowKey(row, idx)}
                className={cn(
                  'border-[color:var(--stroke-subtle)] text-tier-2 transition-colors hover:bg-[color:var(--surface-3)]',
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
                      colIdx === 0 && stickyFirst && 'sticky left-0 z-10 bg-[color:var(--card)] shadow-[4px_0_12px_rgba(0,0,0,0.4)]'
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
        <div className="rounded-[20px] border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-4 py-6 text-center text-sm text-tier-3 min-[390px]:rounded-[22px]">{emptyLabel}</div>
      ) : (
        rows.map((row, idx) => (
          <article
            key={rowKey(row, idx)}
            className={cn(
              activeDensity === 'compact'
                ? 'rounded-[18px] surface-2 p-2.5 shadow-md min-[390px]:rounded-[20px] min-[390px]:p-3'
                : 'rounded-[20px] surface-2 p-3 shadow-lg min-[390px]:rounded-[22px] min-[390px]:p-3.5',
              rowClassName?.(row, idx)
            )}
          >
            <div className="grid gap-3">
              {columns
                .filter((column) => !column.mobileHidden)
                .map((column) => (
                  <div key={`${rowKey(row, idx)}-${column.key}-mobile`} className="grid gap-1.5">
                    <span className="text-xs font-medium tracking-[0.06em] text-tier-3">{column.label}</span>
                    <div className="text-sm text-tier-2">{column.render(row, idx)}</div>
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
