import { describe, expect, it } from 'vitest';
import {
  applyStableRanking,
  compareRankingRows,
  decodeRankingCursor,
  encodeRankingCursor,
} from '@/lib/rankings/sorting';

describe('ranking deterministic sorting', () => {
  it('sorts by metric desc, sourceRank asc, name asc, rowId asc', () => {
    const rows = [
      {
        rowId: 'c',
        metricValue: BigInt(100),
        sourceRank: 2,
        governorNameNormalized: 'beta',
      },
      {
        rowId: 'a',
        metricValue: BigInt(120),
        sourceRank: 3,
        governorNameNormalized: 'gamma',
      },
      {
        rowId: 'b',
        metricValue: BigInt(120),
        sourceRank: 1,
        governorNameNormalized: 'alpha',
      },
      {
        rowId: 'd',
        metricValue: BigInt(120),
        sourceRank: 1,
        governorNameNormalized: 'alpha',
      },
    ];

    const sorted = [...rows].sort(compareRankingRows);
    expect(sorted.map((row) => row.rowId)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('applies stable display ranks and tie groups', () => {
    const ranked = applyStableRanking([
      {
        rowId: 'a',
        metricValue: BigInt(100),
        sourceRank: 1,
        governorNameNormalized: 'a',
      },
      {
        rowId: 'b',
        metricValue: BigInt(100),
        sourceRank: 2,
        governorNameNormalized: 'b',
      },
      {
        rowId: 'c',
        metricValue: BigInt(90),
        sourceRank: 1,
        governorNameNormalized: 'c',
      },
    ]);

    expect(ranked.map((row) => row.displayRank)).toEqual([1, 1, 3]);
    expect(ranked.map((row) => row.tieGroup)).toEqual([1, 2, 3]);
  });

  it('encodes and decodes ranking cursor', () => {
    const encoded = encodeRankingCursor({ rowId: 'row_123' });
    const decoded = decodeRankingCursor(encoded);
    expect(decoded).toEqual({ rowId: 'row_123' });
    expect(decodeRankingCursor('bad')).toBeNull();
  });
});
