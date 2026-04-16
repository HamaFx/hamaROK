import { ActivityMetricKey, EventType, RankingSnapshotStatus } from '@prisma/client';
import { ApiHttpError } from '@/lib/api-response';
import {
  TRACKED_ALLIANCES,
  detectTrackedAlliance,
  formatAllianceLabel,
  resolveAllianceQueryFilters,
} from '@/lib/alliances';
import { prisma } from '@/lib/prisma';
import { normalizeMetricKey, normalizeRankingType } from '@/lib/rankings/normalize';
import { ensureWeeklyEventForWorkspace, findWeeklyEventByKey } from '@/lib/weekly-events';
import { isWeeklyMetricKey, WeeklyMetricKey } from '@/lib/activity/metrics';
import {
  deriveOverallComplianceStatus,
  WeeklyMetricComplianceStatus,
} from '@/lib/activity/scoring';
import { countPendingMetricSyncBacklog } from '@/lib/metric-sync';

const METRIC_KEY_POWER = normalizeMetricKey('power');
const METRIC_KEY_CONTRIBUTION = normalizeMetricKey('contribution_points');
const METRIC_KEY_FORT_DESTROYING = normalizeMetricKey('fort_destroying');
const METRIC_KEY_KILL_POINTS = normalizeMetricKey('kill_points');
const RANKING_TYPE_INDIVIDUAL_POWER = normalizeRankingType('individual_power');
const RANKING_TYPE_PROFILE_POWER = normalizeRankingType('governor_profile_power');

type TrackedAllianceTag = 'GODt' | 'V57' | 'P57R';

interface ResolvedTrackedAlliance {
  tag: TrackedAllianceTag;
  label: string;
  name: string;
}

interface WeeklyMetricValue {
  metricKey: WeeklyMetricKey;
  value: bigint | null;
  minimumValue: bigint | null;
  status: WeeklyMetricComplianceStatus;
}

interface StandardInput {
  allianceTag: string;
  metricKey: WeeklyMetricKey;
  minimumValue: string | number | bigint;
  isActive?: boolean;
}

function toMetricEnum(metricKey: WeeklyMetricKey): ActivityMetricKey {
  switch (metricKey) {
    case 'power_growth': return ActivityMetricKey.POWER_GROWTH;
    case 'contribution_points': return ActivityMetricKey.CONTRIBUTION_POINTS;
    case 'fort_destroying': return ActivityMetricKey.FORT_DESTROYING;
    case 'kill_points_growth': return ActivityMetricKey.KILL_POINTS_GROWTH;
    default:
      throw new ApiHttpError('VALIDATION_ERROR', `Unsupported metric key: ${metricKey}`, 400);
  }
}

function fromMetricEnum(metricKey: ActivityMetricKey): WeeklyMetricKey {
  switch (metricKey) {
    case ActivityMetricKey.POWER_GROWTH: return 'power_growth';
    case ActivityMetricKey.CONTRIBUTION_POINTS: return 'contribution_points';
    case ActivityMetricKey.FORT_DESTROYING: return 'fort_destroying';
    case ActivityMetricKey.KILL_POINTS_GROWTH: return 'kill_points_growth';
    default:
      throw new ApiHttpError('VALIDATION_ERROR', `Unsupported metric enum: ${metricKey}`, 400);
  }
}

function toBigInt(value: string | number | bigint | null | undefined): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.max(0, Math.floor(value)));
  }
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (!digits) return BigInt(0);
  return BigInt(digits);
}

function scoreMetric(value: bigint | null, minimumValue: bigint | null): WeeklyMetricValue['status'] {
  if (value == null) return 'NO_BASELINE';
  if (minimumValue == null) return 'NO_STANDARD';
  return value >= minimumValue ? 'PASS' : 'FAIL';
}

function pickBestPowerValue(
  rows: Array<{
    metricValue: bigint;
    rankingType: string;
    updatedAt: Date;
  }>
): bigint | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const aPriority =
      a.rankingType === RANKING_TYPE_INDIVIDUAL_POWER
        ? 3
        : a.rankingType === RANKING_TYPE_PROFILE_POWER
          ? 2
          : 1;
    const bPriority =
      b.rankingType === RANKING_TYPE_INDIVIDUAL_POWER
        ? 3
        : b.rankingType === RANKING_TYPE_PROFILE_POWER
          ? 2
          : 1;
    if (aPriority !== bPriority) return bPriority - aPriority;
    if (a.updatedAt.getTime() !== b.updatedAt.getTime()) {
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    }
    if (a.metricValue !== b.metricValue) {
      return a.metricValue > b.metricValue ? -1 : 1;
    }
    return 0;
  });
  return sorted[0]?.metricValue ?? null;
}

function trackedAllianceCatalog() {
  return TRACKED_ALLIANCES.map((alliance) => ({
    tag: alliance.tag,
    label: formatAllianceLabel(alliance),
    name: alliance.name,
  }));
}

function resolveTrackedAlliance(args: {
  governorName: string;
  allianceRaw: string;
}): ResolvedTrackedAlliance | null {
  const detected = detectTrackedAlliance({
    governorNameRaw: args.governorName,
    allianceRaw: args.allianceRaw,
  });
  if (!detected?.tracked) return null;
  const matched = TRACKED_ALLIANCES.find((item) => item.tag === detected.tag);
  if (!matched) return null;
  return {
    tag: matched.tag,
    label: formatAllianceLabel(matched),
    name: matched.name,
  };
}

export async function listActivityStandards(workspaceId: string) {
  const rows = await prisma.allianceActivityStandard.findMany({
    where: {
      workspaceId,
    },
    orderBy: [{ allianceTag: 'asc' }, { metricKey: 'asc' }],
  });

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    allianceTag: row.allianceTag,
    allianceLabel: row.allianceLabel,
    metricKey: fromMetricEnum(row.metricKey),
    minimumValue: row.minimumValue.toString(),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function upsertActivityStandards(args: {
  workspaceId: string;
  standards: StandardInput[];
}) {
  const prepared = args.standards.map((row) => {
    const tag = String(row.allianceTag || '').trim();
    const metricKey = String(row.metricKey || '').trim();
    if (!tag || !isWeeklyMetricKey(metricKey)) {
      throw new ApiHttpError('VALIDATION_ERROR', 'Invalid activity standard input.', 400);
    }
    const alliance = TRACKED_ALLIANCES.find((item) => item.tag.toUpperCase() === tag.toUpperCase());
    if (!alliance) {
      throw new ApiHttpError('VALIDATION_ERROR', `Unsupported alliance tag: ${tag}`, 400);
    }
    return {
      allianceTag: alliance.tag,
      allianceLabel: formatAllianceLabel(alliance),
      metricKey: toMetricEnum(metricKey),
      minimumValue: toBigInt(row.minimumValue),
      isActive: row.isActive ?? true,
    };
  });

  await prisma.$transaction(
    prepared.map((row) =>
      prisma.allianceActivityStandard.upsert({
        where: {
          workspaceId_allianceTag_metricKey: {
            workspaceId: args.workspaceId,
            allianceTag: row.allianceTag,
            metricKey: row.metricKey,
          },
        },
        create: {
          workspaceId: args.workspaceId,
          allianceTag: row.allianceTag,
          allianceLabel: row.allianceLabel,
          metricKey: row.metricKey,
          minimumValue: row.minimumValue,
          isActive: row.isActive,
        },
        update: {
          allianceLabel: row.allianceLabel,
          minimumValue: row.minimumValue,
          isActive: row.isActive,
        },
      })
    )
  );

  return listActivityStandards(args.workspaceId);
}

export async function getWeeklyActivityReport(args: {
  workspaceId: string;
  weekKey?: string | null;
  alliances?: string[] | null;
}) {
  const allianceFilters = resolveAllianceQueryFilters(args.alliances || []);
  const event = args.weekKey
    ? await findWeeklyEventByKey(args.workspaceId, args.weekKey)
    : (await ensureWeeklyEventForWorkspace(args.workspaceId)).event;

  if (!event) {
    throw new ApiHttpError('NOT_FOUND', 'Weekly event not found for the requested weekKey.', 404);
  }

  const previousEvent = await prisma.event.findFirst({
    where: {
      workspaceId: args.workspaceId,
      eventType: EventType.WEEKLY,
      startsAt: event.startsAt ? { lt: event.startsAt } : undefined,
    },
    orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      weekKey: true,
      name: true,
      startsAt: true,
      endsAt: true,
    },
  });

  const [standardsRows, governors] = await Promise.all([
    prisma.allianceActivityStandard.findMany({
      where: {
        workspaceId: args.workspaceId,
        isActive: true,
      },
    }),
    prisma.governor.findMany({
      where: {
        workspaceId: args.workspaceId,
      },
      select: {
        id: true,
        governorId: true,
        name: true,
        alliance: true,
      },
    }),
  ]);

  const trackedMembers: Array<{
    governor: {
      id: string;
      governorId: string;
      name: string;
      alliance: string;
    };
    alliance: ResolvedTrackedAlliance;
  }> = [];

  for (const governor of governors) {
    const alliance = resolveTrackedAlliance({
      governorName: governor.name,
      allianceRaw: governor.alliance || '',
    });
    if (!alliance) continue;
    if (
      allianceFilters.length > 0 &&
      !allianceFilters.some((entry) => entry.toUpperCase() === alliance.label.toUpperCase())
    ) {
      continue;
    }
    trackedMembers.push({
      governor,
      alliance,
    });
  }

  const governorIds = trackedMembers.map((item) => item.governor.id);

  const govIdFilter = governorIds.length > 0 ? governorIds : ['__none__'];

  const [
    currentObservationRows,
    previousObservationRows,
    currentContributionRows,
    currentFortRows,
    currentKpRankingRows,
    previousKpRankingRows,
    currentPowerRows,
    currentSnapshotPower,
    previousPowerRows,
    previousSnapshotPower,
    currentSnapshotKp,
    previousSnapshotKp,
    unresolvedIdentityCount,
    pendingSyncCount,
  ] = await Promise.all([
    prisma.metricObservation.findMany({
      where: {
        workspaceId: args.workspaceId,
        eventId: event.id,
        metricKey: {
          in: [
            METRIC_KEY_CONTRIBUTION,
            METRIC_KEY_FORT_DESTROYING,
            METRIC_KEY_POWER,
            METRIC_KEY_KILL_POINTS,
          ],
        },
        governorId: { in: govIdFilter },
      },
      select: {
        governorId: true,
        metricKey: true,
        metricValue: true,
        observedAt: true,
      },
    }),
    previousEvent
      ? prisma.metricObservation.findMany({
          where: {
            workspaceId: args.workspaceId,
            eventId: previousEvent.id,
            metricKey: {
              in: [
                METRIC_KEY_CONTRIBUTION,
                METRIC_KEY_FORT_DESTROYING,
                METRIC_KEY_POWER,
                METRIC_KEY_KILL_POINTS,
              ],
            },
            governorId: { in: govIdFilter },
          },
          select: {
            governorId: true,
            metricKey: true,
            metricValue: true,
            observedAt: true,
          },
        })
      : Promise.resolve([]),
    // Contribution points (weekly reset — raw value from ranking board)
    prisma.rankingSnapshot.findMany({
      where: {
        workspaceId: args.workspaceId,
        eventId: event.id,
        metricKey: METRIC_KEY_CONTRIBUTION,
        status: RankingSnapshotStatus.ACTIVE,
        governorId: { in: govIdFilter },
      },
      select: { governorId: true, metricValue: true, updatedAt: true },
    }),
    // Fort destroying (weekly reset — raw value from ranking board)
    prisma.rankingSnapshot.findMany({
      where: {
        workspaceId: args.workspaceId,
        eventId: event.id,
        metricKey: METRIC_KEY_FORT_DESTROYING,
        status: RankingSnapshotStatus.ACTIVE,
        governorId: { in: govIdFilter },
      },
      select: { governorId: true, metricValue: true, updatedAt: true },
    }),
    // Kill points from ranking board (progressive — need current week)
    prisma.rankingSnapshot.findMany({
      where: {
        workspaceId: args.workspaceId,
        eventId: event.id,
        metricKey: METRIC_KEY_KILL_POINTS,
        status: RankingSnapshotStatus.ACTIVE,
        governorId: { in: govIdFilter },
      },
      select: { governorId: true, metricValue: true, updatedAt: true },
    }),
    // Kill points from ranking board (progressive — need previous week for delta)
    previousEvent
      ? prisma.rankingSnapshot.findMany({
          where: {
            workspaceId: args.workspaceId,
            eventId: previousEvent.id,
            metricKey: METRIC_KEY_KILL_POINTS,
            status: RankingSnapshotStatus.ACTIVE,
            governorId: { in: govIdFilter },
          },
          select: { governorId: true, metricValue: true, updatedAt: true },
        })
      : Promise.resolve([]),
    // Power from ranking board (progressive — need current week)
    prisma.rankingSnapshot.findMany({
      where: {
        workspaceId: args.workspaceId,
        eventId: event.id,
        metricKey: METRIC_KEY_POWER,
        status: RankingSnapshotStatus.ACTIVE,
        governorId: { in: govIdFilter },
      },
      select: { governorId: true, metricValue: true, rankingType: true, updatedAt: true },
    }),
    // Power from profile snapshots (current week fallback)
    prisma.snapshot.findMany({
      where: {
        workspaceId: args.workspaceId,
        eventId: event.id,
        governorId: { in: govIdFilter },
      },
      select: { governorId: true, power: true, killPoints: true, createdAt: true },
    }),
    // Power from ranking board (previous week for delta)
    previousEvent
      ? prisma.rankingSnapshot.findMany({
          where: {
            workspaceId: args.workspaceId,
            eventId: previousEvent.id,
            metricKey: METRIC_KEY_POWER,
            status: RankingSnapshotStatus.ACTIVE,
            governorId: { in: govIdFilter },
          },
          select: { governorId: true, metricValue: true, rankingType: true, updatedAt: true },
        })
      : Promise.resolve([]),
    // Power from profile snapshots (previous week fallback)
    previousEvent
      ? prisma.snapshot.findMany({
          where: {
            workspaceId: args.workspaceId,
            eventId: previousEvent.id,
            governorId: { in: govIdFilter },
          },
          select: { governorId: true, power: true, killPoints: true, createdAt: true },
        })
      : Promise.resolve([]),
    // Kill points from profile snapshots (current week fallback)
    prisma.snapshot.findMany({
      where: {
        workspaceId: args.workspaceId,
        eventId: event.id,
        governorId: { in: govIdFilter },
      },
      select: { governorId: true, killPoints: true, t4Kills: true, t5Kills: true, deads: true, createdAt: true },
    }),
    // Kill points from profile snapshots (previous week fallback)
    previousEvent
      ? prisma.snapshot.findMany({
          where: {
            workspaceId: args.workspaceId,
            eventId: previousEvent.id,
            governorId: { in: govIdFilter },
          },
          select: { governorId: true, killPoints: true, t4Kills: true, t5Kills: true, deads: true, createdAt: true },
        })
      : Promise.resolve([]),
    prisma.rankingSnapshot.count({
      where: {
        workspaceId: args.workspaceId,
        eventId: event.id,
        governorId: null,
        status: RankingSnapshotStatus.UNRESOLVED,
      },
    }),
    countPendingMetricSyncBacklog({ workspaceId: args.workspaceId }),
  ]);

  const standardsByAllianceMetric = new Map<string, bigint>();
  for (const row of standardsRows) {
    standardsByAllianceMetric.set(
      `${row.allianceTag}::${fromMetricEnum(row.metricKey)}`,
      row.minimumValue
    );
  }

  // --- Contribution (weekly reset: highest value wins) ---
  const contributionByGovernor = new Map<string, bigint>();
  for (const row of currentObservationRows) {
    if (row.metricKey !== METRIC_KEY_CONTRIBUTION) continue;
    const existing = contributionByGovernor.get(row.governorId);
    if (!existing || row.metricValue > existing) {
      contributionByGovernor.set(row.governorId, row.metricValue);
    }
  }
  for (const row of currentContributionRows) {
    if (!row.governorId) continue;
    const existing = contributionByGovernor.get(row.governorId);
    if (!existing || row.metricValue > existing) {
      contributionByGovernor.set(row.governorId, row.metricValue);
    }
  }

  // --- Fort destroying (weekly reset: highest value wins) ---
  const fortByGovernor = new Map<string, bigint>();
  for (const row of currentObservationRows) {
    if (row.metricKey !== METRIC_KEY_FORT_DESTROYING) continue;
    const existing = fortByGovernor.get(row.governorId);
    if (!existing || row.metricValue > existing) {
      fortByGovernor.set(row.governorId, row.metricValue);
    }
  }
  for (const row of currentFortRows) {
    if (!row.governorId) continue;
    const existing = fortByGovernor.get(row.governorId);
    if (!existing || row.metricValue > existing) {
      fortByGovernor.set(row.governorId, row.metricValue);
    }
  }

  // --- Kill points (progressive: delta between weeks) ---
  const currentKpByGovernor = new Map<string, bigint>();
  for (const row of currentObservationRows) {
    if (row.metricKey !== METRIC_KEY_KILL_POINTS) continue;
    const existing = currentKpByGovernor.get(row.governorId);
    if (!existing || row.metricValue > existing) {
      currentKpByGovernor.set(row.governorId, row.metricValue);
    }
  }
  for (const row of currentKpRankingRows) {
    if (!row.governorId) continue;
    const existing = currentKpByGovernor.get(row.governorId);
    if (!existing || row.metricValue > existing) {
      currentKpByGovernor.set(row.governorId, row.metricValue);
    }
  }
  // Fallback to profile snapshot kill points
  const currentT4ByGovernor = new Map<string, bigint>();
  const currentT5ByGovernor = new Map<string, bigint>();
  const currentDeadsByGovernor = new Map<string, bigint>();
  for (const row of currentSnapshotKp) {
    if (!currentKpByGovernor.has(row.governorId)) {
      currentKpByGovernor.set(row.governorId, row.killPoints);
      currentT4ByGovernor.set(row.governorId, row.t4Kills);
      currentT5ByGovernor.set(row.governorId, row.t5Kills);
      currentDeadsByGovernor.set(row.governorId, row.deads);
    }
  }

  const previousKpByGovernor = new Map<string, bigint>();
  const previousT4ByGovernor = new Map<string, bigint>();
  const previousT5ByGovernor = new Map<string, bigint>();
  const previousDeadsByGovernor = new Map<string, bigint>();
  for (const row of previousObservationRows) {
    if (row.metricKey !== METRIC_KEY_KILL_POINTS) continue;
    const existing = previousKpByGovernor.get(row.governorId);
    if (!existing || row.metricValue > existing) {
      previousKpByGovernor.set(row.governorId, row.metricValue);
    }
  }
  for (const row of previousKpRankingRows) {
    if (!row.governorId) continue;
    const existing = previousKpByGovernor.get(row.governorId);
    if (!existing || row.metricValue > existing) {
      previousKpByGovernor.set(row.governorId, row.metricValue);
    }
  }
  for (const row of previousSnapshotKp) {
    if (!previousKpByGovernor.has(row.governorId)) {
      previousKpByGovernor.set(row.governorId, row.killPoints);
      previousT4ByGovernor.set(row.governorId, row.t4Kills);
      previousT5ByGovernor.set(row.governorId, row.t5Kills);
      previousDeadsByGovernor.set(row.governorId, row.deads);
    }
  }

  // --- Power (progressive: delta between weeks) ---
  const currentPowerByGovernor = new Map<string, bigint>();
  for (const row of currentObservationRows) {
    if (row.metricKey !== METRIC_KEY_POWER) continue;
    const existing = currentPowerByGovernor.get(row.governorId);
    if (!existing || row.metricValue > existing) {
      currentPowerByGovernor.set(row.governorId, row.metricValue);
    }
  }
  const currentPowerCandidates = new Map<
    string,
    Array<{ metricValue: bigint; rankingType: string; updatedAt: Date }>
  >();
  for (const row of currentPowerRows) {
    if (!row.governorId) continue;
    const bucket = currentPowerCandidates.get(row.governorId) || [];
    bucket.push({ metricValue: row.metricValue, rankingType: row.rankingType, updatedAt: row.updatedAt });
    currentPowerCandidates.set(row.governorId, bucket);
  }
  for (const [governorId, candidates] of currentPowerCandidates.entries()) {
    const best = pickBestPowerValue(candidates);
    if (best != null) currentPowerByGovernor.set(governorId, best);
  }
  for (const row of currentSnapshotPower) {
    if (!currentPowerByGovernor.has(row.governorId)) {
      currentPowerByGovernor.set(row.governorId, row.power);
    }
  }

  const previousPowerByGovernor = new Map<string, bigint>();
  for (const row of previousObservationRows) {
    if (row.metricKey !== METRIC_KEY_POWER) continue;
    const existing = previousPowerByGovernor.get(row.governorId);
    if (!existing || row.metricValue > existing) {
      previousPowerByGovernor.set(row.governorId, row.metricValue);
    }
  }
  const previousPowerCandidates = new Map<
    string,
    Array<{ metricValue: bigint; rankingType: string; updatedAt: Date }>
  >();
  for (const row of previousPowerRows) {
    if (!row.governorId) continue;
    const bucket = previousPowerCandidates.get(row.governorId) || [];
    bucket.push({ metricValue: row.metricValue, rankingType: row.rankingType, updatedAt: row.updatedAt });
    previousPowerCandidates.set(row.governorId, bucket);
  }
  for (const [governorId, candidates] of previousPowerCandidates.entries()) {
    const best = pickBestPowerValue(candidates);
    if (best != null) previousPowerByGovernor.set(governorId, best);
  }
  for (const row of previousSnapshotPower) {
    if (!previousPowerByGovernor.has(row.governorId)) {
      previousPowerByGovernor.set(row.governorId, row.power);
    }
  }

  // --- Build per-governor rows with all 4 metrics ---
  const rows = trackedMembers.map((member) => {
    const governorId = member.governor.id;
    const tag = member.alliance.tag;

    const contributionValue = contributionByGovernor.get(governorId) || BigInt(0);
    const fortValue = fortByGovernor.get(governorId) || BigInt(0);
    const currentPowerValue = currentPowerByGovernor.get(governorId) ?? null;
    const previousPowerValue = previousPowerByGovernor.get(governorId) ?? null;
    const powerBaselineReady = currentPowerValue != null && previousPowerValue != null;
    const powerGrowthValue = powerBaselineReady
      ? currentPowerValue - previousPowerValue
      : null;
    const currentKpValue = currentKpByGovernor.get(governorId) ?? null;
    const previousKpValue = previousKpByGovernor.get(governorId) ?? null;
    const killPointsBaselineReady = currentKpValue != null && previousKpValue != null;
    const kpGrowthValue = killPointsBaselineReady
      ? currentKpValue - previousKpValue
      : null;
      
    const currentT4Value = currentT4ByGovernor.get(governorId) ?? BigInt(0);
    const previousT4Value = previousT4ByGovernor.get(governorId) ?? BigInt(0);
    const currentT5Value = currentT5ByGovernor.get(governorId) ?? BigInt(0);
    const previousT5Value = previousT5ByGovernor.get(governorId) ?? BigInt(0);
    const currentDeadsValue = currentDeadsByGovernor.get(governorId) ?? BigInt(0);
    const previousDeadsValue = previousDeadsByGovernor.get(governorId) ?? BigInt(0);
    
    const t4GrowthValue = killPointsBaselineReady ? currentT4Value - previousT4Value : null;
    const t5GrowthValue = killPointsBaselineReady ? currentT5Value - previousT5Value : null;
    const deadsGrowthValue = killPointsBaselineReady ? currentDeadsValue - previousDeadsValue : null;

    const contributionMin = standardsByAllianceMetric.get(`${tag}::contribution_points`) ?? null;
    const powerGrowthMin = standardsByAllianceMetric.get(`${tag}::power_growth`) ?? null;
    const fortMin = standardsByAllianceMetric.get(`${tag}::fort_destroying`) ?? null;
    const kpGrowthMin = standardsByAllianceMetric.get(`${tag}::kill_points_growth`) ?? null;

    const contributionMetric: WeeklyMetricValue = {
      metricKey: 'contribution_points',
      value: contributionValue,
      minimumValue: contributionMin,
      status: scoreMetric(contributionValue, contributionMin),
    };
    const growthMetric: WeeklyMetricValue = {
      metricKey: 'power_growth',
      value: powerGrowthValue,
      minimumValue: powerGrowthMin,
      status: scoreMetric(powerGrowthValue, powerGrowthMin),
    };
    const fortMetric: WeeklyMetricValue = {
      metricKey: 'fort_destroying',
      value: fortValue,
      minimumValue: fortMin,
      status: scoreMetric(fortValue, fortMin),
    };
    const kpGrowthMetric: WeeklyMetricValue = {
      metricKey: 'kill_points_growth',
      value: kpGrowthValue,
      minimumValue: kpGrowthMin,
      status: scoreMetric(kpGrowthValue, kpGrowthMin),
    };

    const allStatuses: WeeklyMetricValue['status'][] = [
      contributionMetric.status,
      growthMetric.status,
      fortMetric.status,
      kpGrowthMetric.status,
    ];
    const overallCompliance = deriveOverallComplianceStatus(allStatuses);

    return {
      governorDbId: member.governor.id,
      governorId: member.governor.governorId,
      governorName: member.governor.name,
      allianceTag: tag,
      allianceLabel: member.alliance.label,
      contributionPoints: (contributionMetric.value || BigInt(0)).toString(),
      fortDestroying: (fortMetric.value || BigInt(0)).toString(),
      powerGrowth: growthMetric.value?.toString() || null,
      killPointsGrowth: kpGrowthMetric.value?.toString() || null,
      t4KillsGrowth: t4GrowthValue?.toString() || null,
      t5KillsGrowth: t5GrowthValue?.toString() || null,
      deadsGrowth: deadsGrowthValue?.toString() || null,
      currentPower: (currentPowerValue || BigInt(0)).toString(),
      previousPower: (previousPowerValue || BigInt(0)).toString(),
      currentKillPoints: (currentKpValue || BigInt(0)).toString(),
      previousKillPoints: (previousKpValue || BigInt(0)).toString(),
      powerBaselineReady,
      killPointsBaselineReady,
      standards: {
        contributionPoints: contributionMetric.minimumValue?.toString() || null,
        fortDestroying: fortMetric.minimumValue?.toString() || null,
        powerGrowth: growthMetric.minimumValue?.toString() || null,
        killPointsGrowth: kpGrowthMetric.minimumValue?.toString() || null,
      },
      compliance: {
        contributionPoints: contributionMetric.status,
        fortDestroying: fortMetric.status,
        powerGrowth: growthMetric.status,
        killPointsGrowth: kpGrowthMetric.status,
        overall: overallCompliance as 'PASS' | 'FAIL' | 'PARTIAL' | 'NO_STANDARD',
      },
    };
  });

  rows.sort((a, b) => {
    const metricDiff = BigInt(b.contributionPoints) - BigInt(a.contributionPoints);
    if (metricDiff !== BigInt(0)) return metricDiff > BigInt(0) ? 1 : -1;
    const growthDiff = BigInt(b.powerGrowth || '0') - BigInt(a.powerGrowth || '0');
    if (growthDiff !== BigInt(0)) return growthDiff > BigInt(0) ? 1 : -1;
    return a.governorName.localeCompare(b.governorName);
  });

  const allianceSummary = trackedAllianceCatalog()
    .filter((alliance) => {
      if (allianceFilters.length === 0) return true;
      return allianceFilters.some((entry) => entry.toUpperCase() === alliance.label.toUpperCase());
    })
    .map((alliance) => {
      const members = rows.filter((row) => row.allianceTag === alliance.tag);
      const passCount = members.filter((row) => row.compliance.overall === 'PASS').length;
      const failCount = members.filter((row) => row.compliance.overall === 'FAIL').length;
      const partialCount = members.filter((row) => row.compliance.overall === 'PARTIAL').length;
      const noStandardCount = members.filter((row) => row.compliance.overall === 'NO_STANDARD').length;
      const totalContribution = members.reduce((sum, row) => sum + BigInt(row.contributionPoints), BigInt(0));
      const totalGrowth = members.reduce((sum, row) => sum + BigInt(row.powerGrowth || '0'), BigInt(0));
      const totalFort = members.reduce((sum, row) => sum + BigInt(row.fortDestroying), BigInt(0));
      const totalKpGrowth = members.reduce(
        (sum, row) => sum + BigInt(row.killPointsGrowth || '0'),
        BigInt(0)
      );
      return {
        allianceTag: alliance.tag,
        allianceLabel: alliance.label,
        members: members.length,
        passCount,
        failCount,
        partialCount,
        noStandardCount,
        totalContribution: totalContribution.toString(),
        totalPowerGrowth: totalGrowth.toString(),
        totalFortDestroying: totalFort.toString(),
        totalKillPointsGrowth: totalKpGrowth.toString(),
      };
    });

  return {
    event: {
      id: event.id,
      name: event.name,
      eventType: event.eventType,
      weekKey: event.weekKey || null,
      startsAt: event.startsAt?.toISOString() || null,
      endsAt: event.endsAt?.toISOString() || null,
      isClosed: event.isClosed,
    },
    previousEvent: previousEvent
      ? {
          id: previousEvent.id,
          name: previousEvent.name,
          weekKey: previousEvent.weekKey,
          startsAt: previousEvent.startsAt?.toISOString() || null,
          endsAt: previousEvent.endsAt?.toISOString() || null,
        }
      : null,
    rows,
    summary: {
      membersTracked: rows.length,
      noPowerBaselineCount: rows.filter((row) => !row.powerBaselineReady).length,
      noKillPointsBaselineCount: rows.filter((row) => !row.killPointsBaselineReady).length,
      unresolvedIdentityCount,
      pendingSyncCount,
      allianceSummary,
      topContribution: rows.slice(0, 5),
      topPowerGrowth: [...rows]
        .sort((a, b) => {
          const d = BigInt(b.powerGrowth || '0') - BigInt(a.powerGrowth || '0');
          if (d !== BigInt(0)) return d > BigInt(0) ? 1 : -1;
          return a.governorName.localeCompare(b.governorName);
        })
        .slice(0, 5),
      topFortDestroying: [...rows]
        .sort((a, b) => {
          const d = BigInt(b.fortDestroying) - BigInt(a.fortDestroying);
          if (d !== BigInt(0)) return d > BigInt(0) ? 1 : -1;
          return a.governorName.localeCompare(b.governorName);
        })
        .slice(0, 5),
      topKillPointsGrowth: [...rows]
        .sort((a, b) => {
          const d = BigInt(b.killPointsGrowth || '0') - BigInt(a.killPointsGrowth || '0');
          if (d !== BigInt(0)) return d > BigInt(0) ? 1 : -1;
          return a.governorName.localeCompare(b.governorName);
        })
        .slice(0, 5),
    },
  };
}
