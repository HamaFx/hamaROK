import { describe, expect, it } from 'vitest';
import { calculateAdvancedDkp } from '@/lib/warrior-score';

describe('calculateAdvancedDkp', () => {
  it('uses both expected KP and expected deads in expected DKP', () => {
    const [result] = calculateAdvancedDkp(
      [
        {
          governorId: 'g1',
          governorName: 'Alpha',
          startPower: BigInt(100_000_000),
          killPointsDelta: BigInt(80_000_000),
          t4KillsDelta: BigInt(10_000_000),
          t5KillsDelta: BigInt(5_000_000),
          deadsDelta: BigInt(2_000_000),
          powerDelta: BigInt(-3_000_000),
        },
      ],
      {
        t4Weight: 1,
        t5Weight: 2,
        deadWeight: 5,
        kpPerPowerRatio: 0.3,
        deadPerPowerRatio: 0.02,
      }
    );

    expect(result.expectedKp).toBe(30_000_000);
    expect(result.expectedDeads).toBe(2_000_000);
    expect(result.expectedDkp).toBe(40_000_000);
  });

  it('ranks governors by warrior score descending', () => {
    const results = calculateAdvancedDkp(
      [
        {
          governorId: 'g1',
          governorName: 'A',
          startPower: BigInt(50_000_000),
          killPointsDelta: BigInt(0),
          t4KillsDelta: BigInt(1_000_000),
          t5KillsDelta: BigInt(1_000_000),
          deadsDelta: BigInt(2_000_000),
          powerDelta: BigInt(-1),
        },
        {
          governorId: 'g2',
          governorName: 'B',
          startPower: BigInt(50_000_000),
          killPointsDelta: BigInt(0),
          t4KillsDelta: BigInt(10_000),
          t5KillsDelta: BigInt(10_000),
          deadsDelta: BigInt(10_000),
          powerDelta: BigInt(1),
        },
      ],
      {
        t4Weight: 1,
        t5Weight: 2,
        deadWeight: 5,
        kpPerPowerRatio: 0.3,
        deadPerPowerRatio: 0.02,
      }
    );

    expect(results[0].governorId).toBe('g1');
    expect(results[0].rank).toBe(1);
    expect(results[1].rank).toBe(2);
  });
});
