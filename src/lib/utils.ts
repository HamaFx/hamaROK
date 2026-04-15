import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number | bigint | string): string {
  const normalized =
    typeof n === 'string' ? n.replace(/,/g, '').trim() || '0' : n;

  try {
    const num = typeof normalized === 'bigint' ? normalized : BigInt(normalized);
    return num.toLocaleString('en-US');
  } catch {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed.toLocaleString('en-US') : String(n);
  }
}

export function abbreviateNumber(n: number | bigint | string): string {
  const num =
    typeof n === 'bigint'
      ? Number(n)
      : typeof n === 'string'
        ? Number(n.replace(/,/g, ''))
        : n;

  if (!Number.isFinite(num)) return String(n);
  if (Math.abs(num) >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  }
  if (Math.abs(num) >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (Math.abs(num) >= 1_000) {
    return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return `${num}`;
}

export function formatDelta(n: number | bigint | string): string {
  const num =
    typeof n === 'bigint'
      ? Number(n)
      : typeof n === 'string'
        ? Number(n.replace(/,/g, ''))
        : n;

  if (!Number.isFinite(num)) return String(n);
  const prefix = num > 0 ? '+' : '';
  return `${prefix}${abbreviateNumber(num)}`;
}

export function parseNumber(str: string): number {
  return Number(str.replace(/[^0-9.-]/g, ''));
}

export function serializeBigInt<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  KVK_START: 'KvK Start',
  KVK_END: 'KvK End',
  MGE: 'MGE',
  OSIRIS: 'Ark of Osiris',
  WEEKLY: 'Weekly Check',
  CUSTOM: 'Custom',
};
