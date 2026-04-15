export function formatMetric(value: string | number | bigint | null | undefined) {
  if (value == null) return '—';
  if (typeof value === 'bigint') return value.toLocaleString('en-US');
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-US') : String(value);
}

export function formatCompactNumber(value: string | number | bigint | null | undefined) {
  if (value == null) return '—';
  const num = typeof value === 'bigint' ? Number(value) : typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
  if (!Number.isFinite(num)) return String(value);
  if (Math.abs(num) >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${num}`;
}

export function formatWeekShort(weekKey: string | null | undefined) {
  if (!weekKey) return '—';
  const match = weekKey.match(/^(\d{4})-W(\d{2})$/i);
  return match ? `W${match[2]}` : weekKey;
}

export function formatRelativeDate(iso: string) {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return 'unknown';
  const deltaMs = Math.max(0, Date.now() - ts);
  const hours = Math.floor(deltaMs / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function csvValue(value: string | number | null | undefined) {
  const raw = value == null ? '' : String(value);
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function downloadCsv(filename: string, lines: string[]) {
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function parseBigIntSafe(value: string | null | undefined): bigint | null {
  if (!value) return null;
  try {
    const parsed = BigInt(value);
    return parsed >= BigInt(0) ? parsed : BigInt(0);
  } catch {
    return null;
  }
}

export function toSafeBigInt(value: string | null | undefined) {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
}
