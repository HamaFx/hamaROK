import { hashRequestPayload } from '@/lib/security';

export function normalizeRankingType(value: string): string {
  return (
    String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/RANKINGS?$/i, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown'
  );
}

export function normalizeMetricKey(value: string): string {
  return (
    String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'metric'
  );
}

export function normalizeGovernorAlias(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function normalizeGovernorDisplayName(value: string): string {
  return String(value || '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

export function parseRankingMetric(value: string | number | bigint | null | undefined): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.max(0, Math.floor(value)));
  }
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (!digits) return BigInt(0);
  return BigInt(digits);
}

export function computeRankingRowHash(input: {
  sourceRank?: number | null;
  governorNameRaw: string;
  metricRaw: string;
  rankingType: string;
  metricKey: string;
}): string {
  return hashRequestPayload({
    sourceRank: input.sourceRank ?? null,
    governorNameRaw: normalizeGovernorDisplayName(input.governorNameRaw),
    metricRaw: String(input.metricRaw || ''),
    rankingType: normalizeRankingType(input.rankingType),
    metricKey: normalizeMetricKey(input.metricKey),
  });
}

export function computeCaptureFingerprint(input: {
  fileName?: string | null;
  bytes?: number | null;
  checksum?: string | null;
  rankingType?: string | null;
  metricKey?: string | null;
  headerText?: string | null;
  eventId?: string | null;
}): string {
  return hashRequestPayload({
    fileName: input.fileName || null,
    bytes: input.bytes || null,
    checksum: input.checksum || null,
    rankingType: normalizeRankingType(input.rankingType || ''),
    metricKey: normalizeMetricKey(input.metricKey || ''),
    headerText: String(input.headerText || '').trim().slice(0, 120) || null,
    eventId: input.eventId || null,
  });
}

export function computeCanonicalIdentityKey(input: {
  governorId?: string | null;
  governorNameNormalized: string;
}): string {
  if (input.governorId) return `gov:${input.governorId}`;
  return `name:${input.governorNameNormalized}`;
}
