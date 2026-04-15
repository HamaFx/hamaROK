import { hashRequestPayload } from '@/lib/security';
import {
  sanitizeGovernorNameForAlliance,
  splitGovernorNameAndAlliance,
} from '@/lib/alliances';

const RANKING_TYPE_SYNONYMS: Record<string, string> = {
  individual_power: 'individual_power',
  individualpower: 'individual_power',
  mad_scientist: 'mad_scientist',
  madscientist: 'mad_scientist',
  fort_destroyer: 'fort_destroyer',
  fortdestroyer: 'fort_destroyer',
  fort_destroy: 'fort_destroyer',
  fort_destroying: 'fort_destroyer',
  governor_profile_power: 'governor_profile_power',
  governor_profile: 'governor_profile_power',
  kill_point: 'kill_point',
  kill_points: 'kill_point',
  killpoint: 'kill_point',
  killpoints: 'kill_point',
};

const STRICT_RANKING_TYPE_METRIC_MAP: Record<string, string> = {
  individual_power: 'power',
  mad_scientist: 'contribution_points',
  fort_destroyer: 'fort_destroying',
  kill_point: 'kill_points',
};

export interface StrictRankingPairValidation {
  ok: boolean;
  rankingType: string;
  metricKey: string;
  expectedMetricKey: string | null;
  reason?: string;
}

export function normalizeRankingType(value: string): string {
  const base = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/RANKINGS?$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
  return RANKING_TYPE_SYNONYMS[base] ?? base;
}

const METRIC_KEY_SYNONYMS: Record<string, string> = {
  power: 'power',
  contribution_points: 'contribution_points',
  contribution: 'contribution_points',
  tech_contribution: 'contribution_points',
  fort_destroying: 'fort_destroying',
  fort_destroy: 'fort_destroying',
  fort: 'fort_destroying',
  destroy: 'fort_destroying',
  kill_points: 'kill_points',
  kill_point: 'kill_points',
  kp: 'kill_points',
};

export function normalizeMetricKey(value: string): string {
  const base = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'metric';
  return METRIC_KEY_SYNONYMS[base] ?? base;
}

export function getStrictMetricForRankingType(value: string): string | null {
  const rankingType = normalizeRankingType(value);
  return STRICT_RANKING_TYPE_METRIC_MAP[rankingType] ?? null;
}

export function validateStrictRankingTypeMetricPair(
  rankingTypeValue: string,
  metricKeyValue: string
): StrictRankingPairValidation {
  const rankingType = normalizeRankingType(rankingTypeValue);
  const metricKey = normalizeMetricKey(metricKeyValue);
  const expectedMetricKey = getStrictMetricForRankingType(rankingType);

  if (!expectedMetricKey) {
    return {
      ok: false,
      rankingType,
      metricKey,
      expectedMetricKey: null,
      reason: `Unsupported rankingType "${rankingType}".`,
    };
  }

  if (metricKey !== expectedMetricKey) {
    return {
      ok: false,
      rankingType,
      metricKey,
      expectedMetricKey,
      reason: `rankingType "${rankingType}" requires metricKey "${expectedMetricKey}" (received "${metricKey}").`,
    };
  }

  return {
    ok: true,
    rankingType,
    metricKey,
    expectedMetricKey,
  };
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
