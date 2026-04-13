import { prisma } from '@/lib/prisma';
import { compareWorkspaceEvents } from '@/lib/compare-service';

interface BuildAnalyticsInput {
  workspaceId: string;
  eventAId?: string | null;
  eventBId?: string | null;
  topN?: number;
}

async function resolveComparisonPair(args: BuildAnalyticsInput) {
  if (args.eventAId && args.eventBId) {
    return {
      eventAId: args.eventAId,
      eventBId: args.eventBId,
    };
  }

  const latestTwo = await prisma.event.findMany({
    where: { workspaceId: args.workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 2,
    select: {
      id: true,
    },
  });

  if (latestTwo.length < 2) {
    return null;
  }

  return {
    eventAId: latestTwo[1].id,
    eventBId: latestTwo[0].id,
  };
}

async function buildTrendLines(workspaceId: string) {
  const events = await prisma.event.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      createdAt: true,
    },
  });

  const pairs = [] as Array<{ eventAId: string; eventBId: string; index: number }>;
  const maxPairs = 10;
  for (let i = Math.max(1, events.length - maxPairs); i < events.length; i++) {
    pairs.push({
      eventAId: events[i - 1].id,
      eventBId: events[i].id,
      index: i,
    });
  }

  const lines = [] as Array<{
    eventA: { id: string; name: string; date: string };
    eventB: { id: string; name: string; date: string };
    avgWarriorScore: number;
    totalGovernors: number;
    anomalyCount: number;
  }>;

  for (const pair of pairs) {
    try {
      const result = await compareWorkspaceEvents({
        workspaceId,
        eventAId: pair.eventAId,
        eventBId: pair.eventBId,
      });
      const eventA = events[pair.index - 1];
      const eventB = events[pair.index];

      lines.push({
        eventA: {
          id: eventA.id,
          name: eventA.name,
          date: eventA.createdAt.toISOString(),
        },
        eventB: {
          id: eventB.id,
          name: eventB.name,
          date: eventB.createdAt.toISOString(),
        },
        avgWarriorScore: result.summary.avgWarriorScore,
        totalGovernors: result.summary.totalGovernors,
        anomalyCount: result.summary.anomalyCount,
      });
    } catch {
      // Ignore pair if comparison data is incomplete.
    }
  }

  return lines;
}

async function buildKingdomSlices() {
  const workspaces = await prisma.workspace.findMany({
    where: { isArchived: false },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: {
      id: true,
      slug: true,
      name: true,
      kingdomTag: true,
      createdAt: true,
      _count: {
        select: {
          events: true,
          snapshots: true,
          governors: true,
        },
      },
    },
  });

  const slices = await Promise.all(
    workspaces.map(async (workspace) => {
      const latestEvents = await prisma.event.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { createdAt: 'desc' },
        take: 2,
        select: { id: true },
      });

      let latestAvgWarriorScore: number | null = null;
      if (latestEvents.length === 2) {
        try {
          const compare = await compareWorkspaceEvents({
            workspaceId: workspace.id,
            eventAId: latestEvents[1].id,
            eventBId: latestEvents[0].id,
          });
          latestAvgWarriorScore = compare.summary.avgWarriorScore;
        } catch {
          latestAvgWarriorScore = null;
        }
      }

      return {
        workspaceId: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        kingdomTag: workspace.kingdomTag,
        createdAt: workspace.createdAt.toISOString(),
        latestAvgWarriorScore,
        totals: workspace._count,
      };
    })
  );

  return slices.sort(
    (a, b) => (b.latestAvgWarriorScore ?? -1) - (a.latestAvgWarriorScore ?? -1)
  );
}

export async function buildWorkspaceAnalytics({
  workspaceId,
  eventAId,
  eventBId,
  topN = 10,
}: BuildAnalyticsInput) {
  const pair = await resolveComparisonPair({ workspaceId, eventAId, eventBId, topN });
  let selectedComparison: {
    eventA: { id: string; name: string; eventType: string };
    eventB: { id: string; name: string; eventType: string };
    summary: {
      totalGovernors: number;
      avgWarriorScore: number;
      anomalyCount: number;
      tierDistribution: Record<string, number>;
      scoreBuckets: Record<string, number>;
    };
    topContributors: Array<{
      governorId: string;
      governorName: string;
      score: number;
      actualDkp: number;
      killPointsDelta: number;
      deadsDelta: number;
    }>;
    topByKillPoints: Array<{
      governorId: string;
      governorName: string;
      killPointsDelta: number;
      score: number;
    }>;
    topByDeads: Array<{
      governorId: string;
      governorName: string;
      deadsDelta: number;
      score: number;
    }>;
  } | null = null;

  if (pair) {
    const result = await compareWorkspaceEvents({
      workspaceId,
      eventAId: pair.eventAId,
      eventBId: pair.eventBId,
    });

    const ranked = result.comparisons.filter((item) => item.warriorScore);

    selectedComparison = {
      eventA: result.eventA,
      eventB: result.eventB,
      summary: result.summary,
      topContributors: ranked.slice(0, topN).map((entry) => ({
        governorId: entry.governor.id,
        governorName: entry.governor.name,
        score: entry.warriorScore?.totalScore ?? 0,
        actualDkp: entry.warriorScore?.actualDkp ?? 0,
        killPointsDelta: Number(entry.deltas.killPoints),
        deadsDelta: Number(entry.deltas.deads),
      })),
      topByKillPoints: [...ranked]
        .sort((a, b) => Number(b.deltas.killPoints) - Number(a.deltas.killPoints))
        .slice(0, topN)
        .map((entry) => ({
          governorId: entry.governor.id,
          governorName: entry.governor.name,
          killPointsDelta: Number(entry.deltas.killPoints),
          score: entry.warriorScore?.totalScore ?? 0,
        })),
      topByDeads: [...ranked]
        .sort((a, b) => Number(b.deltas.deads) - Number(a.deltas.deads))
        .slice(0, topN)
        .map((entry) => ({
          governorId: entry.governor.id,
          governorName: entry.governor.name,
          deadsDelta: Number(entry.deltas.deads),
          score: entry.warriorScore?.totalScore ?? 0,
        })),
    };
  }

  const [trendLines, kingdomSlices] = await Promise.all([
    buildTrendLines(workspaceId),
    buildKingdomSlices(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    selectedComparison,
    trendLines,
    kingdomSlices,
    seriesMeta: [
      {
        label: 'Warrior Score',
        metricKey: 'score',
        colorToken: 'accent-gold',
      },
      {
        label: 'Kill Points Delta',
        metricKey: 'killPointsDelta',
        colorToken: 'accent-teal',
      },
      {
        label: 'Deads Delta',
        metricKey: 'deadsDelta',
        colorToken: 'accent-rose',
      },
      {
        label: 'Average Score Trend',
        metricKey: 'avgWarriorScore',
        colorToken: 'accent-slate',
      },
    ],
  };
}
