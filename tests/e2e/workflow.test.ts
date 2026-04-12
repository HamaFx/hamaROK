import { describe, expect, it } from 'vitest';
import { parseExtractionValues, toApprovedSnapshotPayload } from '@/lib/review-queue';
import { detectSnapshotPayloadAnomalies } from '@/lib/anomalies';
import { calculateAdvancedDkp } from '@/lib/warrior-score';

describe('workflow smoke: upload -> review -> score', () => {
  it('creates deterministic approved payload and scoreable delta', () => {
    const parsed = parseExtractionValues({
      fields: {
        governorId: { value: '123456789', confidence: 88 },
        governorName: { value: 'Frontliner', confidence: 80 },
        power: { value: '150000000', confidence: 85 },
        killPoints: { value: '450000000', confidence: 84 },
        t4Kills: { value: '12000000', confidence: 83 },
        t5Kills: { value: '5200000', confidence: 81 },
        deads: { value: '740000', confidence: 79 },
      },
      normalized: null,
      governorIdRaw: '123456789',
      governorNameRaw: 'Frontliner',
      confidence: 0.82,
    });

    const approved = toApprovedSnapshotPayload(parsed);
    const anomalies = detectSnapshotPayloadAnomalies({
      power: approved.power,
      killPoints: approved.killPoints,
      t4Kills: approved.t4Kills,
      t5Kills: approved.t5Kills,
      deads: approved.deads,
    });

    expect(approved.governorId).toBe('123456789');
    expect(anomalies.length).toBe(0);

    const scores = calculateAdvancedDkp(
      [
        {
          governorId: approved.governorId,
          governorName: approved.governorName,
          startPower: approved.power,
          killPointsDelta: approved.killPoints,
          t4KillsDelta: approved.t4Kills,
          t5KillsDelta: approved.t5Kills,
          deadsDelta: approved.deads,
          powerDelta: BigInt(-1000000),
        },
      ],
      {
        t4Weight: 0.5,
        t5Weight: 1,
        deadWeight: 5,
        kpPerPowerRatio: 0.3,
        deadPerPowerRatio: 0.02,
      }
    );

    expect(scores.length).toBe(1);
    expect(scores[0].warriorScore).toBeGreaterThan(0);
  });
});
