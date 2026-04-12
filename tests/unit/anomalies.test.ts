import { describe, expect, it } from 'vitest';
import {
  detectComparisonAnomalies,
  detectSnapshotPayloadAnomalies,
} from '@/lib/anomalies';

describe('detectComparisonAnomalies', () => {
  it('flags impossible negative regressions', () => {
    const anomalies = detectComparisonAnomalies(
      {
        power: BigInt(100),
        killPoints: BigInt(100),
        t4Kills: BigInt(100),
        t5Kills: BigInt(100),
        deads: BigInt(100),
      },
      {
        power: BigInt(10),
        killPoints: BigInt(90),
        t4Kills: BigInt(90),
        t5Kills: BigInt(80),
        deads: BigInt(50),
      },
      {
        power: BigInt(-90),
        killPoints: BigInt(-10),
        t4Kills: BigInt(-10),
        t5Kills: BigInt(-20),
        deads: BigInt(-50),
      }
    );

    expect(anomalies.some((a) => a.code === 'KP_NEGATIVE_DELTA')).toBe(true);
    expect(anomalies.some((a) => a.code === 'DEADS_NEGATIVE_DELTA')).toBe(true);
    expect(anomalies.some((a) => a.code === 'KILLS_NEGATIVE_DELTA')).toBe(true);
  });

  it('flags extreme power drops', () => {
    const anomalies = detectComparisonAnomalies(
      {
        power: BigInt(100_000_000),
        killPoints: BigInt(1),
        t4Kills: BigInt(1),
        t5Kills: BigInt(1),
        deads: BigInt(1),
      },
      {
        power: BigInt(45_000_000),
        killPoints: BigInt(2),
        t4Kills: BigInt(2),
        t5Kills: BigInt(2),
        deads: BigInt(2),
      },
      {
        power: BigInt(-55_000_000),
        killPoints: BigInt(1),
        t4Kills: BigInt(1),
        t5Kills: BigInt(1),
        deads: BigInt(1),
      }
    );

    expect(anomalies.some((a) => a.code === 'POWER_DROP_GT_50')).toBe(true);
  });

  it('flags snapshot-level cross-field inconsistencies', () => {
    const anomalies = detectSnapshotPayloadAnomalies({
      power: BigInt(10),
      killPoints: BigInt(5),
      t4Kills: BigInt(9),
      t5Kills: BigInt(7),
      deads: BigInt(50),
    });

    expect(anomalies.some((a) => a.code === 'KILLS_EXCEED_KP')).toBe(true);
    expect(anomalies.some((a) => a.code === 'DEADS_GT_POWER')).toBe(true);
  });
});
