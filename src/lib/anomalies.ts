import type { AnomalySeverity } from '@prisma/client';

export interface DeltaInput {
  power: bigint;
  killPoints: bigint;
  t4Kills: bigint;
  t5Kills: bigint;
  deads: bigint;
}

export interface SnapshotForAnomaly {
  power: bigint;
  killPoints: bigint;
  t4Kills: bigint;
  t5Kills: bigint;
  deads: bigint;
}

export interface DetectedAnomaly {
  code: string;
  type: string;
  severity: AnomalySeverity;
  message: string;
  context?: Record<string, unknown>;
}

export interface SnapshotAnomalyInput {
  power: bigint;
  killPoints: bigint;
  t4Kills: bigint;
  t5Kills: bigint;
  deads: bigint;
}

export function detectComparisonAnomalies(
  snapshotA: SnapshotForAnomaly,
  snapshotB: SnapshotForAnomaly,
  deltas: DeltaInput
): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = [];

  if (deltas.killPoints < BigInt(0)) {
    anomalies.push({
      code: 'KP_NEGATIVE_DELTA',
      type: 'REGRESSION',
      severity: 'ERROR',
      message: 'Kill points decreased between snapshots.',
      context: { delta: deltas.killPoints.toString() },
    });
  }

  if (deltas.deads < BigInt(0)) {
    anomalies.push({
      code: 'DEADS_NEGATIVE_DELTA',
      type: 'REGRESSION',
      severity: 'ERROR',
      message: 'Dead troop count decreased between snapshots.',
      context: { delta: deltas.deads.toString() },
    });
  }

  if (deltas.t4Kills < BigInt(0) || deltas.t5Kills < BigInt(0)) {
    anomalies.push({
      code: 'KILLS_NEGATIVE_DELTA',
      type: 'REGRESSION',
      severity: 'ERROR',
      message: 'T4/T5 kill count decreased between snapshots.',
      context: {
        t4Delta: deltas.t4Kills.toString(),
        t5Delta: deltas.t5Kills.toString(),
      },
    });
  }

  if (snapshotA.power > BigInt(0)) {
    const powerRatio = Number(snapshotB.power) / Number(snapshotA.power);
    if (powerRatio < 0.5) {
      anomalies.push({
        code: 'POWER_DROP_GT_50',
        type: 'EXTREME_DROP',
        severity: 'WARNING',
        message: 'Power dropped by more than 50%.',
        context: {
          from: snapshotA.power.toString(),
          to: snapshotB.power.toString(),
        },
      });
    }
  }

  if (
    deltas.killPoints > BigInt(100_000_000) &&
    deltas.t4Kills === BigInt(0) &&
    deltas.t5Kills === BigInt(0)
  ) {
    anomalies.push({
      code: 'KP_HIGH_WITHOUT_T4T5',
      type: 'OCR_INCONSISTENCY',
      severity: 'WARNING',
      message: 'High KP delta with zero T4/T5 delta.',
      context: { killPointsDelta: deltas.killPoints.toString() },
    });
  }

  return anomalies;
}

export function detectSnapshotPayloadAnomalies(
  snapshot: SnapshotAnomalyInput
): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = [];

  if (snapshot.power <= BigInt(0)) {
    anomalies.push({
      code: 'POWER_ZERO_OR_NEGATIVE',
      type: 'OCR_INCONSISTENCY',
      severity: 'ERROR',
      message: 'Power is zero or negative.',
      context: { power: snapshot.power.toString() },
    });
  }

  const combinedKills = snapshot.t4Kills + snapshot.t5Kills;
  if (snapshot.killPoints > BigInt(0) && combinedKills > snapshot.killPoints) {
    anomalies.push({
      code: 'KILLS_EXCEED_KP',
      type: 'CROSS_FIELD_INCONSISTENCY',
      severity: 'WARNING',
      message: 'Combined T4/T5 kills exceed kill points.',
      context: {
        killPoints: snapshot.killPoints.toString(),
        totalKills: combinedKills.toString(),
      },
    });
  }

  if (snapshot.deads > snapshot.power) {
    anomalies.push({
      code: 'DEADS_GT_POWER',
      type: 'CROSS_FIELD_INCONSISTENCY',
      severity: 'WARNING',
      message: 'Dead troop count is greater than current power.',
      context: {
        deads: snapshot.deads.toString(),
        power: snapshot.power.toString(),
      },
    });
  }

  return anomalies;
}
