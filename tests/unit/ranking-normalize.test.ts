import { describe, expect, it } from 'vitest';
import {
  computeCanonicalIdentityKey,
  computeRankingRowHash,
  normalizeGovernorAlias,
  normalizeMetricKey,
  normalizeRankingType,
  parseRankingMetric,
  validateStrictRankingTypeMetricPair,
} from '@/lib/rankings/normalize';

describe('ranking normalize helpers', () => {
  it('normalizes ranking type and metric key consistently', () => {
    expect(normalizeRankingType('INDIVIDUAL POWER RANKINGS')).toBe('individual_power');
    expect(normalizeRankingType('FORTDESTROYER RANKINGS')).toBe('fort_destroyer');
    expect(normalizeRankingType('MADSCIENTIST')).toBe('mad_scientist');
    expect(normalizeRankingType('KILLPOINTS')).toBe('kill_point');
    expect(normalizeMetricKey('Contribution Points')).toBe('contribution_points');
  });

  it('validates strict ranking type and metric key pairs', () => {
    expect(
      validateStrictRankingTypeMetricPair('INDIVIDUAL POWER RANKINGS', 'POWER')
    ).toMatchObject({
      ok: true,
      rankingType: 'individual_power',
      metricKey: 'power',
      expectedMetricKey: 'power',
    });

    expect(
      validateStrictRankingTypeMetricPair('FORT DESTROYER RANKINGS', 'contribution_points')
    ).toMatchObject({
      ok: false,
      rankingType: 'fort_destroyer',
      metricKey: 'contribution_points',
      expectedMetricKey: 'fort_destroying',
    });

    expect(
      validateStrictRankingTypeMetricPair('Governor Profile', 'power')
    ).toMatchObject({
      ok: false,
      rankingType: 'governor_profile_power',
      expectedMetricKey: null,
    });
  });

  it('normalizes governor aliases with punctuation and spaces removed', () => {
    expect(normalizeGovernorAlias('[GODt] Gd Hama')).toBe('godtgdhama');
    expect(normalizeGovernorAlias('Łukasz')).toBe('lukasz');
    expect(normalizeGovernorAlias('Игрок №1')).toBe('игрок1');
    expect(normalizeGovernorAlias('José 王者')).toBe('jose王者');
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
