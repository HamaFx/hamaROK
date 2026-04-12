import { prisma } from '@/lib/prisma';
import { calculateAdvancedDkp, SnapshotDelta } from '@/lib/warrior-score';
import { detectComparisonAnomalies } from '@/lib/anomalies';

interface CompareInput {
  workspaceId: string;
  eventAId: string;
  eventBId: string;
}

export async function compareWorkspaceEvents({
  workspaceId,
  eventAId,
  eventBId,
}: CompareInput) {
  const [eventA, eventB, settings] = await Promise.all([
    prisma.event.findFirst({ where: { id: eventAId, workspaceId } }),
    prisma.event.findFirst({ where: { id: eventBId, workspaceId } }),
    prisma.workspaceSettings.findUnique({ where: { workspaceId } }),
  ]);

  if (!eventA || !eventB) {
    throw new Error('One or both events were not found in this workspace.');
  }

  const [snapshotsA, snapshotsB] = await Promise.all([
    prisma.snapshot.findMany({
      where: { eventId: eventAId, workspaceId },
      include: { governor: true },
    }),
    prisma.snapshot.findMany({
      where: { eventId: eventBId, workspaceId },
      include: { governor: true },
    }),
  ]);

  const mapA = new Map(snapshotsA.map((s) => [s.governorId, s]));
  const mapB = new Map(snapshotsB.map((s) => [s.governorId, s]));

  const matched: Array<{
    governor: { id: string; governorId: string; name: string };
    snapshotA: Record<string, string>;
    snapshotB: Record<string, string>;
    deltas: Record<string, string>;
    anomalies: ReturnType<typeof detectComparisonAnomalies>;
  }> = [];
  const missingInB: Array<{ governor: { id: string; governorId: string; name: string } }> = [];
  const newInB: Array<{ governor: { id: string; governorId: string; name: string } }> = [];
  const warriorDeltas: SnapshotDelta[] = [];

  for (const [govId, snapA] of mapA) {
    const snapB = mapB.get(govId);
    if (!snapB) {
      missingInB.push({
        governor: {
          id: snapA.governor.id,
          governorId: snapA.governor.governorId,
          name: snapA.governor.name,
        },
      });
      continue;
    }

    const deltas = {
      power: snapB.power - snapA.power,
      killPoints: snapB.killPoints - snapA.killPoints,
      t4Kills: snapB.t4Kills - snapA.t4Kills,
      t5Kills: snapB.t5Kills - snapA.t5Kills,
      deads: snapB.deads - snapA.deads,
    };

    const anomalies = detectComparisonAnomalies(
      {
        power: snapA.power,
        killPoints: snapA.killPoints,
        t4Kills: snapA.t4Kills,
        t5Kills: snapA.t5Kills,
        deads: snapA.deads,
      },
      {
        power: snapB.power,
        killPoints: snapB.killPoints,
        t4Kills: snapB.t4Kills,
        t5Kills: snapB.t5Kills,
        deads: snapB.deads,
      },
      deltas
    );

    matched.push({
      governor: {
        id: snapA.governor.id,
        governorId: snapA.governor.governorId,
        name: snapB.governor.name || snapA.governor.name,
      },
      snapshotA: {
        power: snapA.power.toString(),
        killPoints: snapA.killPoints.toString(),
        t4Kills: snapA.t4Kills.toString(),
        t5Kills: snapA.t5Kills.toString(),
        deads: snapA.deads.toString(),
      },
      snapshotB: {
        power: snapB.power.toString(),
        killPoints: snapB.killPoints.toString(),
        t4Kills: snapB.t4Kills.toString(),
        t5Kills: snapB.t5Kills.toString(),
        deads: snapB.deads.toString(),
      },
      deltas: {
        power: deltas.power.toString(),
        killPoints: deltas.killPoints.toString(),
        t4Kills: deltas.t4Kills.toString(),
        t5Kills: deltas.t5Kills.toString(),
        deads: deltas.deads.toString(),
      },
      anomalies,
    });

    warriorDeltas.push({
      governorId: snapA.governor.id,
      governorName: snapB.governor.name || snapA.governor.name,
      startPower: snapA.power,
      killPointsDelta: deltas.killPoints,
      t4KillsDelta: deltas.t4Kills,
      t5KillsDelta: deltas.t5Kills,
      deadsDelta: deltas.deads,
      powerDelta: deltas.power,
    });
  }

  for (const [govId, snapB] of mapB) {
    if (mapA.has(govId)) continue;
    newInB.push({
      governor: {
        id: snapB.governor.id,
        governorId: snapB.governor.governorId,
        name: snapB.governor.name,
      },
    });
  }

  const scoringConfig = {
    t4Weight: settings?.t4Weight ?? 0.5,
    t5Weight: settings?.t5Weight ?? 1.0,
    deadWeight: settings?.deadWeight ?? 5.0,
    kpPerPowerRatio: settings?.kpPerPowerRatio ?? 0.3,
    deadPerPowerRatio: settings?.deadPerPowerRatio ?? 0.02,
  };

  const warriorScores = calculateAdvancedDkp(warriorDeltas, scoringConfig);
  const scoreMap = new Map(warriorScores.map((s) => [s.governorId, s]));

  const comparisons = matched
    .map((m) => {
      const ws = scoreMap.get(m.governor.id);
      return {
        ...m,
        warriorScore: ws
          ? {
              actualDkp: ws.actualDkp,
              expectedKp: ws.expectedKp,
              expectedDeads: ws.expectedDeads,
              expectedDkp: ws.expectedDkp,
              kdRatio: ws.kdRatio,
              totalScore: ws.warriorScore,
              isDeadweight: ws.isDeadweight,
              tier: ws.tier,
              rank: ws.rank,
            }
          : null,
      };
    })
    .sort((a, b) => (a.warriorScore?.rank || 9999) - (b.warriorScore?.rank || 9999));

  const tierDistribution: Record<string, number> = {
    'War Legend': 0,
    'Elite Warrior': 0,
    'Frontline Fighter': 0,
    'Support Role': 0,
    Inactive: 0,
  };
  for (const score of warriorScores) {
    tierDistribution[score.tier] = (tierDistribution[score.tier] || 0) + 1;
  }

  return {
    eventA: { id: eventA.id, name: eventA.name, eventType: eventA.eventType },
    eventB: { id: eventB.id, name: eventB.name, eventType: eventB.eventType },
    comparisons,
    missingInB,
    newInB,
    summary: {
      totalGovernors: comparisons.length,
      avgWarriorScore:
        warriorScores.length > 0
          ? Math.round(
              (warriorScores.reduce((acc, s) => acc + s.warriorScore, 0) /
                warriorScores.length) *
                10
            ) / 10
          : 0,
      tierDistribution,
      anomalyCount: comparisons.reduce((acc, c) => acc + c.anomalies.length, 0),
      scoreBuckets: {
        '0-24': warriorScores.filter((s) => s.warriorScore < 25).length,
        '25-49': warriorScores.filter((s) => s.warriorScore >= 25 && s.warriorScore < 50).length,
        '50-74': warriorScores.filter((s) => s.warriorScore >= 50 && s.warriorScore < 75).length,
        '75-99': warriorScores.filter((s) => s.warriorScore >= 75 && s.warriorScore < 100).length,
        '100+': warriorScores.filter((s) => s.warriorScore >= 100).length,
      },
      deadweightCount: warriorScores.filter((s) => s.isDeadweight).length,
      negativePowerCount: comparisons.filter((entry) => Number(entry.deltas.power) < 0).length,
      topContributors: comparisons.slice(0, 10).map((entry) => ({
        governorId: entry.governor.id,
        governorName: entry.governor.name,
        score: entry.warriorScore?.totalScore ?? 0,
        actualDkp: entry.warriorScore?.actualDkp ?? 0,
        killPointsDelta: Number(entry.deltas.killPoints),
        deadsDelta: Number(entry.deltas.deads),
      })),
      topByKillPoints: [...comparisons]
        .sort((a, b) => Number(b.deltas.killPoints) - Number(a.deltas.killPoints))
        .slice(0, 10)
        .map((entry) => ({
          governorId: entry.governor.id,
          governorName: entry.governor.name,
          killPointsDelta: Number(entry.deltas.killPoints),
          score: entry.warriorScore?.totalScore ?? 0,
        })),
      topByDeads: [...comparisons]
        .sort((a, b) => Number(b.deltas.deads) - Number(a.deltas.deads))
        .slice(0, 10)
        .map((entry) => ({
          governorId: entry.governor.id,
          governorName: entry.governor.name,
          deadsDelta: Number(entry.deltas.deads),
          score: entry.warriorScore?.totalScore ?? 0,
      })),
    },
    config: scoringConfig,
  };
}
