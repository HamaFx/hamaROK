import { describe, expect, it } from 'vitest';
import { selectLatestAllTimeRankingRows } from '@/lib/rankings/service';

describe('selectLatestAllTimeRankingRows', () => {
  it('keeps one latest row per rankingType+metricKey+identityKey', () => {
    const rows = [
      {
        id: 'r1',
        rankingType: 'individual_power',
        metricKey: 'power',
        identityKey: 'gov:1',
        updatedAt: new Date('2026-04-01T00:00:00.000Z'),
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        metricValue: BigInt(100),
      },
      {
        id: 'r2',
        rankingType: 'individual_power',
        metricKey: 'power',
        identityKey: 'gov:1',
        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
        createdAt: new Date('2026-04-02T00:00:00.000Z'),
        metricValue: BigInt(90),
      },
      {
        id: 'r3',
        rankingType: 'kill_point',
        metricKey: 'kill_points',
        identityKey: 'gov:1',
        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
        createdAt: new Date('2026-04-02T00:00:00.000Z'),
        metricValue: BigInt(400),
      },
    ];

    const merged = selectLatestAllTimeRankingRows(rows);

    expect(merged).toHaveLength(2);
    expect(merged.find((row) => row.rankingType === 'individual_power')?.id).toBe('r2');
    expect(merged.find((row) => row.rankingType === 'kill_point')?.id).toBe('r3');
  });

  it('breaks ties by createdAt, metricValue, then id', () => {
    const rows = [
      {
        id: 'a',
        rankingType: 'individual_power',
        metricKey: 'power',
        identityKey: 'gov:2',
        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        metricValue: BigInt(100),
      },
      {
        id: 'b',
        rankingType: 'individual_power',
        metricKey: 'power',
        identityKey: 'gov:2',
        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
        createdAt: new Date('2026-04-02T00:00:00.000Z'),
        metricValue: BigInt(90),
      },
      {
        id: 'c',
        rankingType: 'individual_power',
        metricKey: 'power',
        identityKey: 'gov:2',
        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
        createdAt: new Date('2026-04-02T00:00:00.000Z'),
        metricValue: BigInt(120),
      },
      {
        id: 'd',
        rankingType: 'individual_power',
        metricKey: 'power',
        identityKey: 'gov:2',
        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
        createdAt: new Date('2026-04-02T00:00:00.000Z'),
        metricValue: BigInt(120),
      },
    ];

    const merged = selectLatestAllTimeRankingRows(rows);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('d');
  });
});
