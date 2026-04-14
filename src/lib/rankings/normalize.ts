import { hashRequestPayload } from '@/lib/security';
import {
  sanitizeGovernorNameForAlliance,
  splitGovernorNameAndAlliance,
} from '@/lib/alliances';

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
  const parsed = splitGovernorNameAndAlliance({ governorNameRaw: value });
  return sanitizeGovernorNameForAlliance(parsed.governorNameRaw || value);
}

export function normalizeOcrNumericDigits(value: string | number | bigint | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const mapped = raw
    .toUpperCase()
    // Common OCR confusions for numeric score fields.
    .replace(/[OQD]/g, '0')
    .replace(/[I|L]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/G/g, '6')
    .replace(/Z/g, '2');

  return mapped.replace(/[^0-9]/g, '');
}

export function parseRankingMetric(value: string | number | bigint | null | undefined): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.max(0, Math.floor(value)));
  }
  const digits = normalizeOcrNumericDigits(value);
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
