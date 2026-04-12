import { describe, expect, it } from 'vitest';
import {
  toComparisonCsv,
  toComparisonPackZip,
  toComparisonXlsx,
} from '@/lib/exporters';

const payload = {
  eventA: { name: 'Start' },
  eventB: { name: 'End' },
  comparisons: [
    {
      governor: { id: '1', governorId: '1001', name: 'Alpha' },
      snapshotA: { power: '100', killPoints: '100', t4Kills: '10', t5Kills: '10', deads: '10' },
      snapshotB: { power: '80', killPoints: '200', t4Kills: '30', t5Kills: '20', deads: '40' },
      deltas: { power: '-20', killPoints: '100', t4Kills: '20', t5Kills: '10', deads: '30' },
      warriorScore: {
        rank: 1,
        totalScore: 90,
        tier: 'War Legend',
        actualDkp: 500,
        expectedDkp: 450,
        expectedKp: 300,
        expectedDeads: 30,
        kdRatio: 1.2,
        isDeadweight: false,
      },
      anomalies: [],
    },
  ],
  summary: {
    totalGovernors: 1,
    avgWarriorScore: 90,
    anomalyCount: 0,
  },
};

describe('exporters', () => {
  it('builds CSV content', () => {
    const csv = toComparisonCsv(payload);
    expect(csv).toContain('Governor ID');
    expect(csv).toContain('Alpha');
    expect(csv).toContain('War Legend');
  });

  it('builds XLSX content', async () => {
    const xlsx = await toComparisonXlsx(payload);
    expect(xlsx.byteLength).toBeGreaterThan(500);
  });

  it('builds report pack zip', async () => {
    const pack = await toComparisonPackZip(payload);
    // ZIP signatures start with PK.
    expect(pack.subarray(0, 2).toString()).toBe('PK');
    expect(pack.byteLength).toBeGreaterThan(1000);
  });
});
