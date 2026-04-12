/**
 * Format a large number with commas: 85000000 → "85,000,000"
 */
export function formatNumber(n: number | bigint | string): string {
  const num = typeof n === 'string' ? BigInt(n.replace(/,/g, '')) : BigInt(n);
  return num.toLocaleString('en-US');
}

/**
 * Format a number in abbreviated form: 85000000 → "85M"
 */
export function abbreviateNumber(n: number | bigint | string): string {
  const num = typeof n === 'bigint' ? Number(n) : typeof n === 'string' ? Number(n.replace(/,/g, '')) : n;
  if (Math.abs(num) >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (Math.abs(num) >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(num) >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
}

/**
 * Format a delta with sign: +5000000 → "+5M", -3000000 → "-3M"
 */
export function formatDelta(n: number | bigint | string): string {
  const num = typeof n === 'bigint' ? Number(n) : typeof n === 'string' ? Number(n.replace(/,/g, '')) : n;
  const prefix = num > 0 ? '+' : '';
  return prefix + abbreviateNumber(num);
}

/**
 * Parse a formatted number string: "85,000,000" → 85000000
 */
export function parseNumber(str: string): number {
  return Number(str.replace(/[^0-9.-]/g, ''));
}

/**
 * Serialize BigInt fields in an object to strings for JSON responses
 */
export function serializeBigInt<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  );
}

/**
 * Merge class names, filtering out falsy values
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Format a date to a readable string
 */
export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Event type display labels
 */
export const EVENT_TYPE_LABELS: Record<string, string> = {
  KVK_START: 'KvK Start',
  KVK_END: 'KvK End',
  MGE: 'MGE',
  OSIRIS: 'Ark of Osiris',
  WEEKLY: 'Weekly Check',
  CUSTOM: 'Custom',
};
