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

const METRIC_KEY_POWER = normalizeMetricKey('power');
const METRIC_KEY_CONTRIBUTION = normalizeMetricKey('contribution_points');
const RANKING_TYPE_INDIVIDUAL_POWER = normalizeRankingType('individual_power');
const RANKING_TYPE_PROFILE_POWER = normalizeRankingType('governor_profile_power');

export type WeeklyMetricKey = 'power_growth' | 'contribution_points';
type TrackedAllianceTag = 'GODt' | 'V57' | 'P57R';

interface ResolvedTrackedAlliance {
  tag: TrackedAllianceTag;
  label: string;
  name: string;
}

interface WeeklyMetricValue {
  metricKey: WeeklyMetricKey;
  value: bigint;
  minimumValue: bigint | null;
  status: 'PASS' | 'FAIL' | 'NO_STANDARD';
}

interface StandardInput {
  allianceTag: string;
  metricKey: WeeklyMetricKey;
  minimumValue: string | number | bigint;
  isActive?: boolean;
}

function toMetricEnum(metricKey: WeeklyMetricKey): ActivityMetricKey {
  return metricKey === 'power_growth'
    ? ActivityMetricKey.POWER_GROWTH
    : ActivityMetricKey.CONTRIBUTION_POINTS;
}

function fromMetricEnum(metricKey: ActivityMetricKey): WeeklyMetricKey {
  return metricKey === ActivityMetricKey.POWER_GROWTH
    ? 'power_growth'
    : 'contribution_points';
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

function scoreMetric(value: bigint, minimumValue: bigint | null): WeeklyMetricValue['status'] {
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
    const metricKey = row.metricKey;
    if (!tag || !['power_growth', 'contribution_points'].includes(metricKey)) {
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

  const [currentContributionRows, currentPowerRows, currentSnapshotPower, previousPowerRows, previousSnapshotPower] =
    await Promise.all([
      prisma.rankingSnapshot.findMany({
        where: {
          workspaceId: args.workspaceId,
          eventId: event.id,
          metricKey: METRIC_KEY_CONTRIBUTION,
          status: RankingSnapshotStatus.ACTIVE,
          governorId: {
            in: governorIds.length > 0 ? governorIds : ['__none__'],
          },
        },
        select: {
          governorId: true,
          metricValue: true,
          updatedAt: true,
        },
      }),
      prisma.rankingSnapshot.findMany({
        where: {
          workspaceId: args.workspaceId,
          eventId: event.id,
          metricKey: METRIC_KEY_POWER,
          status: RankingSnapshotStatus.ACTIVE,
          governorId: {
            in: governorIds.length > 0 ? governorIds : ['__none__'],
          },
        },
        select: {
          governorId: true,
          metricValue: true,
          rankingType: true,
          updatedAt: true,
        },
      }),
      prisma.snapshot.findMany({
        where: {
          workspaceId: args.workspaceId,
          eventId: event.id,
          governorId: {
            in: governorIds.length > 0 ? governorIds : ['__none__'],
          },
        },
        select: {
          governorId: true,
          power: true,
          createdAt: true,
        },
      }),
      previousEvent
        ? prisma.rankingSnapshot.findMany({
            where: {
              workspaceId: args.workspaceId,
              eventId: previousEvent.id,
              metricKey: METRIC_KEY_POWER,
              status: RankingSnapshotStatus.ACTIVE,
              governorId: {
                in: governorIds.length > 0 ? governorIds : ['__none__'],
              },
            },
            select: {
              governorId: true,
              metricValue: true,
              rankingType: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      previousEvent
        ? prisma.snapshot.findMany({
            where: {
              workspaceId: args.workspaceId,
              eventId: previousEvent.id,
              governorId: {
                in: governorIds.length > 0 ? governorIds : ['__none__'],
              },
            },
            select: {
              governorId: true,
              power: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

  const standardsByAllianceMetric = new Map<string, bigint>();
  for (const row of standardsRows) {
    standardsByAllianceMetric.set(
      `${row.allianceTag}::${fromMetricEnum(row.metricKey)}`,
      row.minimumValue
    );
  }

  const contributionByGovernor = new Map<string, bigint>();
  for (const row of currentContributionRows) {
    if (!row.governorId) continue;
    const existing = contributionByGovernor.get(row.governorId);
    if (!existing || row.metricValue > existing) {
      contributionByGovernor.set(row.governorId, row.metricValue);
    }
  }

  const currentPowerByGovernor = new Map<string, bigint>();
  const currentPowerCandidates = new Map<
    string,
    Array<{
      metricValue: bigint;
      rankingType: string;
      updatedAt: Date;
    }>
  >();
  for (const row of currentPowerRows) {
    if (!row.governorId) continue;
    const bucket = currentPowerCandidates.get(row.governorId) || [];
    bucket.push({
      metricValue: row.metricValue,
      rankingType: row.rankingType,
      updatedAt: row.updatedAt,
    });
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
  const previousPowerCandidates = new Map<
    string,
    Array<{
      metricValue: bigint;
      rankingType: string;
      updatedAt: Date;
    }>
  >();
  for (const row of previousPowerRows) {
    if (!row.governorId) continue;
    const bucket = previousPowerCandidates.get(row.governorId) || [];
    bucket.push({
      metricValue: row.metricValue,
      rankingType: row.rankingType,
      updatedAt: row.updatedAt,
    });
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

  const rows = trackedMembers.map((member) => {
    const governorId = member.governor.id;
    const contributionValue = contributionByGovernor.get(governorId) || BigInt(0);
    const currentPower = currentPowerByGovernor.get(governorId) || BigInt(0);
    const previousPower = previousPowerByGovernor.get(governorId) || BigInt(0);
    const powerGrowthValue = currentPower - previousPower;

    const contributionMinimum =
      standardsByAllianceMetric.get(`${member.alliance.tag}::contribution_points`) ?? null;
    const powerGrowthMinimum =
      standardsByAllianceMetric.get(`${member.alliance.tag}::power_growth`) ?? null;

    const contributionMetric: WeeklyMetricValue = {
      metricKey: 'contribution_points',
      value: contributionValue,
      minimumValue: contributionMinimum,
      status: scoreMetric(contributionValue, contributionMinimum),
    };
    const growthMetric: WeeklyMetricValue = {
      metricKey: 'power_growth',
      value: powerGrowthValue,
      minimumValue: powerGrowthMinimum,
      status: scoreMetric(powerGrowthValue, powerGrowthMinimum),
    };

    return {
      governorDbId: member.governor.id,
      governorId: member.governor.governorId,
      governorName: member.governor.name,
      allianceTag: member.alliance.tag,
      allianceLabel: member.alliance.label,
      contributionPoints: contributionMetric.value.toString(),
      powerGrowth: growthMetric.value.toString(),
      currentPower: currentPower.toString(),
      previousPower: previousPower.toString(),
      standards: {
        contributionPoints: contributionMetric.minimumValue?.toString() || null,
        powerGrowth: growthMetric.minimumValue?.toString() || null,
      },
      compliance: {
        contributionPoints: contributionMetric.status,
        powerGrowth: growthMetric.status,
        overall:
          contributionMetric.status === 'FAIL' || growthMetric.status === 'FAIL'
            ? 'FAIL'
            : contributionMetric.status === 'PASS' && growthMetric.status === 'PASS'
              ? 'PASS'
              : 'NO_STANDARD',
      },
    };
  });

  rows.sort((a, b) => {
    const metricDiff = BigInt(b.contributionPoints) - BigInt(a.contributionPoints);
    if (metricDiff !== BigInt(0)) return metricDiff > BigInt(0) ? 1 : -1;
    const growthDiff = BigInt(b.powerGrowth) - BigInt(a.powerGrowth);
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
      const noStandardCount = members.filter((row) => row.compliance.overall === 'NO_STANDARD').length;
      const totalContribution = members.reduce((sum, row) => sum + BigInt(row.contributionPoints), BigInt(0));
      const totalGrowth = members.reduce((sum, row) => sum + BigInt(row.powerGrowth), BigInt(0));
      return {
        allianceTag: alliance.tag,
        allianceLabel: alliance.label,
        members: members.length,
        passCount,
        failCount,
        noStandardCount,
        totalContribution: totalContribution.toString(),
        totalPowerGrowth: totalGrowth.toString(),
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
      allianceSummary,
      topContribution: rows.slice(0, 5),
      topPowerGrowth: [...rows]
        .sort((a, b) => {
          const growthDiff = BigInt(b.powerGrowth) - BigInt(a.powerGrowth);
          if (growthDiff !== BigInt(0)) return growthDiff > BigInt(0) ? 1 : -1;
          return a.governorName.localeCompare(b.governorName);
        })
        .slice(0, 5),
    },
  };
}
