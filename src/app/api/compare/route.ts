import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { calculateAdvancedDkp, DkpConfig, SnapshotDelta } from '@/lib/warrior-score';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const eventAId = searchParams.get('eventA');
    const eventBId = searchParams.get('eventB');

    if (!eventAId || !eventBId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'eventA and eventB query params are required' } },
        { status: 400 }
      );
    }

    const [eventA, eventB, snapshotsA, snapshotsB, settings] = await Promise.all([
      prisma.event.findUnique({ where: { id: eventAId } }),
      prisma.event.findUnique({ where: { id: eventBId } }),
      prisma.snapshot.findMany({
        where: { eventId: eventAId },
        include: { governor: true },
      }),
      prisma.snapshot.findMany({
        where: { eventId: eventBId },
        include: { governor: true },
      }),
      prisma.kingdomSettings.findUnique({ where: { id: 'default' } }),
    ]);

    const config: DkpConfig = settings
      ? {
          t4Weight: settings.t4Weight,
          t5Weight: settings.t5Weight,
          deadWeight: settings.deadWeight,
          kpPerPowerRatio: settings.kpPerPowerRatio,
          deadPerPowerRatio: settings.deadPerPowerRatio,
        }
      : {
      t4Weight: 0.5,
      t5Weight: 1.0,
      deadWeight: 5.0,
      kpPerPowerRatio: 0.3,
      deadPerPowerRatio: 0.02,
    };

    if (!eventA || !eventB) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'One or both events not found' } },
        { status: 404 }
      );
    }

    // Build lookup maps
    const mapA = new Map(snapshotsA.map((s) => [s.governorId, s]));
    const mapB = new Map(snapshotsB.map((s) => [s.governorId, s]));

    // Find matched governors
    const matched: Array<{
      governor: { id: string; governorId: string; name: string };
      snapshotA: Record<string, string>;
      snapshotB: Record<string, string>;
      deltas: Record<string, string>;
    }> = [];
    const missingInB: Array<{ governor: { id: string; governorId: string; name: string } }> = [];
    const newInB: Array<{ governor: { id: string; governorId: string; name: string } }> = [];
    const warriorDeltas: SnapshotDelta[] = [];

    for (const [govId, snapA] of mapA) {
      const snapB = mapB.get(govId);
      if (snapB) {
        const deltas = {
          power: (snapB.power - snapA.power).toString(),
          killPoints: (snapB.killPoints - snapA.killPoints).toString(),
          t4Kills: (snapB.t4Kills - snapA.t4Kills).toString(),
          t5Kills: (snapB.t5Kills - snapA.t5Kills).toString(),
          deads: (snapB.deads - snapA.deads).toString(),
        };

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
          deltas,
        });

        warriorDeltas.push({
          governorId: snapA.governor.id,
          governorName: snapB.governor.name || snapA.governor.name,
          startPower: snapA.power,
          killPointsDelta: snapB.killPoints - snapA.killPoints,
          t4KillsDelta: snapB.t4Kills - snapA.t4Kills,
          t5KillsDelta: snapB.t5Kills - snapA.t5Kills,
          deadsDelta: snapB.deads - snapA.deads,
          powerDelta: snapB.power - snapA.power,
        });
      } else {
        missingInB.push({
          governor: { id: snapA.governor.id, governorId: snapA.governor.governorId, name: snapA.governor.name },
        });
      }
    }

    for (const [govId, snapB] of mapB) {
      if (!mapA.has(govId)) {
        newInB.push({
          governor: { id: snapB.governor.id, governorId: snapB.governor.governorId, name: snapB.governor.name },
        });
      }
    }

    // Calculate new DKP scores
    const warriorScores = calculateAdvancedDkp(warriorDeltas, config);

    // Build comparison results with advanced scores merged
    const comparisons = matched.map((m) => {
      const ws = warriorScores.find((w) => w.governorId === m.governor.id);
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
    });

    // Sort by warrior score rank
    comparisons.sort((a, b) => (a.warriorScore?.rank || 999) - (b.warriorScore?.rank || 999));

    // Summary stats
    const scores = warriorScores.map((w) => w.warriorScore);
    const tierDistribution: Record<string, number> = {
      'War Legend': 0,
      'Elite Warrior': 0,
      'Frontline Fighter': 0,
      'Support Role': 0,
      Inactive: 0,
    };
    warriorScores.forEach((w) => {
      tierDistribution[w.tier] = (tierDistribution[w.tier] || 0) + 1;
    });

    return NextResponse.json({
      eventA: { id: eventA.id, name: eventA.name, eventType: eventA.eventType },
      eventB: { id: eventB.id, name: eventB.name, eventType: eventB.eventType },
      comparisons,
      missingInB,
      newInB,
      summary: {
        totalGovernors: matched.length,
        avgWarriorScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0,
        tierDistribution,
      },
    });
  } catch (error) {
    console.error('GET /api/compare error:', error);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to compare events' } }, { status: 500 });
  }
}
