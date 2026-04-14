import { describe, expect, it } from 'vitest';
import {
  computeCanonicalIdentityKey,
  computeRankingRowHash,
  normalizeGovernorAlias,
  normalizeMetricKey,
  normalizeRankingType,
  parseRankingMetric,
} from '@/lib/rankings/normalize';

describe('ranking normalize helpers', () => {
  it('normalizes ranking type and metric key consistently', () => {
    expect(normalizeRankingType('INDIVIDUAL POWER RANKINGS')).toBe('individual_power');
    expect(normalizeMetricKey('Contribution Points')).toBe('contribution_points');
  });

  it('normalizes governor aliases with punctuation and spaces removed', () => {
    expect(normalizeGovernorAlias('[GODt] Gd Hama')).toBe('godtgdhama');
  });

  it('parses numeric metrics as bigint', () => {
    expect(parseRankingMetric('54,268,607')).toBe(BigInt('54268607'));
    expect(parseRankingMetric('2O,1I8,S34')).toBe(BigInt('20118534'));
    expect(parseRankingMetric('B6,9Z0')).toBe(BigInt('86920'));
    expect(parseRankingMetric('')).toBe(BigInt(0));
  });

  it('computes deterministic row hash and canonical identity key', () => {
    const hashA = computeRankingRowHash({
      sourceRank: 1,
      governorNameRaw: 'Gd Shanks',
      metricRaw: '21,871,344',
      rankingType: 'individual_power_rankings',
      metricKey: 'power',
    });

    const hashB = computeRankingRowHash({
      sourceRank: 1,
      governorNameRaw: 'Gd   Shanks',
      metricRaw: '21,871,344',
      rankingType: 'INDIVIDUAL POWER RANKINGS',
      metricKey: 'Power',
    });

    expect(hashA).toBe(hashB);
    expect(computeCanonicalIdentityKey({ governorId: 'abc123', governorNameNormalized: 'gdhama' })).toBe('gov:abc123');
    expect(computeCanonicalIdentityKey({ governorNameNormalized: 'gdhama' })).toBe('name:gdhama');
  });
});
