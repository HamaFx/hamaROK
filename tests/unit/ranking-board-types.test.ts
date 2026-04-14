import { describe, expect, it } from 'vitest';
import {
  getMetricDisplayName,
  getRankingTypeDisplayName,
  getSupportedBoardForPair,
  SUPPORTED_RANKING_BOARDS,
} from '@/lib/rankings/board-types';

describe('ranking board types', () => {
  it('exposes required supported board pairs', () => {
    expect(SUPPORTED_RANKING_BOARDS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rankingType: 'individual_power',
          metricKey: 'power',
        }),
        expect.objectContaining({
          rankingType: 'mad_scientist',
          metricKey: 'contribution_points',
        }),
        expect.objectContaining({
          rankingType: 'fort_destroyer',
          metricKey: 'fort_destroying',
        }),
      ])
    );
  });

  it('returns friendly labels and pair support lookup', () => {
    expect(getRankingTypeDisplayName('individual_power')).toBe('Power Rankings');
    expect(getMetricDisplayName('fort_destroying')).toBe('Fort Destroying');
    expect(getSupportedBoardForPair('fort_destroyer', 'fort_destroying')).not.toBeNull();
    expect(getSupportedBoardForPair('fort_destroyer', 'contribution_points')).toBeNull();
  });
});

