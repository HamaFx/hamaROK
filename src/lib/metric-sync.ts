import {
  MetricObservationSourceType,
  MetricSyncBacklogStatus,
  Prisma,
  RankingRowReviewAction,
  RankingSnapshotStatus,
} from '@prisma/client';
import { ApiHttpError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { ensureWeeklyEventForWorkspace } from '@/lib/weekly-events';
import {
  computeCanonicalIdentityKey,
  normalizeGovernorAlias,
  normalizeMetricKey,
  normalizeRankingType,
  parseRankingMetric,
} from '@/lib/rankings/normalize';

export const METRIC_KEY_POWER = normalizeMetricKey('power');
export const METRIC_KEY_KILL_POINTS = normalizeMetricKey('kill_points');
export const METRIC_KEY_CONTRIBUTION = normalizeMetricKey('contribution_points');
export const METRIC_KEY_FORT = normalizeMetricKey('fort_destroying');

export const RANKING_TYPE_POWER = normalizeRankingType('individual_power');
export const RANKING_TYPE_KILL_POINT = normalizeRankingType('kill_point');

const OBSERVABLE_METRICS = new Set([
  METRIC_KEY_POWER,
  METRIC_KEY_KILL_POINTS,
  METRIC_KEY_CONTRIBUTION,
  METRIC_KEY_FORT,
]);

export interface MetricObservationCandidate {
  metricValue: bigint;
  observedAt: Date;
  sourceRefId: string | null;
}

function normalizeSourceRefId(value: string | null | undefined): string | null {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

function normalizeRank(value: number | null | undefined): number | null {
  if (!Number.isFinite(value ?? NaN)) return null;
  const asInt = Math.floor(Number(value));
  if (asInt < 1 || asInt > 5000) return null;
  return asInt;
}

function toMetricBigInt(value: string | number | bigint): bigint {
  return parseRankingMetric(value);
}

export function compareObservationPrecedence(
  current: MetricObservationCandidate,
  incoming: MetricObservationCandidate
): number {
  const currentMs = current.observedAt.getTime();
  const incomingMs = incoming.observedAt.getTime();
  if (incomingMs !== currentMs) {
    return incomingMs > currentMs ? 1 : -1;
  }

  if (incoming.metricValue !== current.metricValue) {
    return incoming.metricValue > current.metricValue ? 1 : -1;
  }

  const currentRef = current.sourceRefId || '';
  const incomingRef = incoming.sourceRefId || '';
  if (incomingRef === currentRef) return 0;
  return incomingRef > currentRef ? 1 : -1;
}

export function isObservableMetricKey(metricKey: string): boolean {
  return OBSERVABLE_METRICS.has(normalizeMetricKey(metricKey));
}

function canonicalRankingTypeForMetric(metricKeyRaw: string): string | null {
  const metricKey = normalizeMetricKey(metricKeyRaw);
  if (metricKey === METRIC_KEY_POWER) return RANKING_TYPE_POWER;
  if (metricKey === METRIC_KEY_KILL_POINTS) return RANKING_TYPE_KILL_POINT;
  return null;
}

async function loadGovernorSnapshotName(
  tx: Prisma.TransactionClient,
  governorId: string
): Promise<{ nameRaw: string; nameNormalized: string }> {
  const governor = await tx.governor.findUnique({
    where: { id: governorId },
    select: { name: true },
  });

  if (!governor) {
    throw new ApiHttpError('NOT_FOUND', 'Governor not found for metric sync.', 404);
  }

  const nameRaw = String(governor.name || '').trim() || 'Unknown';
  return {
    nameRaw,
    nameNormalized: normalizeGovernorAlias(nameRaw),
  };
}

export async function upsertMetricObservationTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    eventId: string;
    governorId: string;
    metricKey: string;
    metricValue: string | number | bigint;
    sourceType: MetricObservationSourceType;
    sourceRank?: number | null;
    sourceRefId?: string | null;
    observedAt?: Date;
  }
) {
  const metricKey = normalizeMetricKey(args.metricKey);
  if (!isObservableMetricKey(metricKey)) {
    return {
      applied: false,
      reason: 'unsupported-metric',
      observation: null,
    } as const;
  }

  const observedAt = args.observedAt || new Date();
  const sourceRefId = normalizeSourceRefId(args.sourceRefId);
  const incomingValue = toMetricBigInt(args.metricValue);

  const existing = await tx.metricObservation.findUnique({
    where: {
      workspaceId_eventId_governorId_metricKey: {
        workspaceId: args.workspaceId,
        eventId: args.eventId,
        governorId: args.governorId,
        metricKey,
      },
    },
  });

  if (!existing) {
    const created = await tx.metricObservation.create({
      data: {
        workspaceId: args.workspaceId,
        eventId: args.eventId,
        governorId: args.governorId,
        metricKey,
        metricValue: incomingValue,
        sourceType: args.sourceType,
        sourceRank: normalizeRank(args.sourceRank),
        sourceRefId,
        observedAt,
      },
    });

    return {
      applied: true,
      reason: 'created',
      observation: created,
    } as const;
  }

  const precedence = compareObservationPrecedence(
    {
      metricValue: existing.metricValue,
      observedAt: existing.observedAt,
      sourceRefId: existing.sourceRefId,
    },
    {
      metricValue: incomingValue,
      observedAt,
      sourceRefId,
    }
  );

  if (precedence < 0) {
    return {
      applied: false,
      reason: 'existing-is-newer',
      observation: existing,
    } as const;
  }

  if (precedence === 0) {
    return {
      applied: false,
      reason: 'equal-precedence',
      observation: existing,
    } as const;
  }

  const updated = await tx.metricObservation.update({
    where: {
      workspaceId_eventId_governorId_metricKey: {
        workspaceId: args.workspaceId,
        eventId: args.eventId,
        governorId: args.governorId,
        metricKey,
      },
    },
    data: {
      metricValue: incomingValue,
      sourceType: args.sourceType,
      sourceRank: normalizeRank(args.sourceRank),
      sourceRefId,
      observedAt,
    },
  });

  return {
    applied: true,
    reason: 'updated',
    observation: updated,
  } as const;
}

export async function syncCanonicalRankingFromObservationTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    eventId: string;
    governorId: string;
    metricKey: string;
    metricValue: bigint;
    sourceRank?: number | null;
    sourceRefId?: string | null;
    changedByLinkId?: string | null;
    reason?: string | null;
    governorNameRaw?: string;
  }
) {
  const metricKey = normalizeMetricKey(args.metricKey);
  const rankingType = canonicalRankingTypeForMetric(metricKey);
  if (!rankingType) {
    return {
      applied: false,
      reason: 'metric-not-canonical-leaderboard',
      snapshotId: null,
      revisionId: null,
    } as const;
  }

  const governorName = args.governorNameRaw
    ? {
        nameRaw: String(args.governorNameRaw).trim() || 'Unknown',
        nameNormalized: normalizeGovernorAlias(String(args.governorNameRaw).trim() || 'Unknown'),
      }
    : await loadGovernorSnapshotName(tx, args.governorId);

  const identityKey = computeCanonicalIdentityKey({
    governorId: args.governorId,
    governorNameNormalized: governorName.nameNormalized,
  });

  const previous = await tx.rankingSnapshot.findUnique({
    where: {
      workspaceId_eventId_rankingType_identityKey: {
        workspaceId: args.workspaceId,
        eventId: args.eventId,
        rankingType,
        identityKey,
      },
    },
    select: {
      id: true,
      rankingType: true,
      metricKey: true,
      identityKey: true,
      governorId: true,
      governorNameRaw: true,
      governorNameNormalized: true,
      sourceRank: true,
      metricValue: true,
      status: true,
      lastRunId: true,
      lastRowId: true,
    },
  });

  const snapshot = await tx.rankingSnapshot.upsert({
    where: {
      workspaceId_eventId_rankingType_identityKey: {
        workspaceId: args.workspaceId,
        eventId: args.eventId,
        rankingType,
        identityKey,
      },
    },
    create: {
      workspaceId: args.workspaceId,
      eventId: args.eventId,
      rankingType,
      metricKey,
      identityKey,
      governorId: args.governorId,
      governorNameRaw: governorName.nameRaw,
      governorNameNormalized: governorName.nameNormalized,
      sourceRank: normalizeRank(args.sourceRank),
      metricValue: args.metricValue,
      status: RankingSnapshotStatus.ACTIVE,
      lastRunId: null,
      lastRowId: null,
    },
    update: {
      metricKey,
      governorId: args.governorId,
      governorNameRaw: governorName.nameRaw,
      governorNameNormalized: governorName.nameNormalized,
      sourceRank: normalizeRank(args.sourceRank),
      metricValue: args.metricValue,
      status: RankingSnapshotStatus.ACTIVE,
      lastRunId: null,
      lastRowId: null,
    },
    select: {
      id: true,
      rankingType: true,
      metricKey: true,
      identityKey: true,
      governorId: true,
      governorNameRaw: true,
      governorNameNormalized: true,
      sourceRank: true,
      metricValue: true,
      status: true,
      lastRunId: true,
      lastRowId: true,
    },
  });

  const nextData = {
    rankingType: snapshot.rankingType,
    metricKey: snapshot.metricKey,
    identityKey: snapshot.identityKey,
    governorId: snapshot.governorId,
    governorNameRaw: snapshot.governorNameRaw,
    governorNameNormalized: snapshot.governorNameNormalized,
    sourceRank: snapshot.sourceRank,
    metricValue: snapshot.metricValue.toString(),
    status: snapshot.status,
    lastRunId: snapshot.lastRunId,
    lastRowId: snapshot.lastRowId,
    sourceRefId: normalizeSourceRefId(args.sourceRefId),
  };

  const revision = await tx.rankingRevision.create({
    data: {
      workspaceId: args.workspaceId,
      snapshotId: snapshot.id,
      changedByLinkId: args.changedByLinkId || null,
      action: RankingRowReviewAction.SYSTEM_MERGE,
      reason: args.reason || 'Metric observation canonical sync',
      previousData: previous
        ? {
            rankingType: previous.rankingType,
            metricKey: previous.metricKey,
            identityKey: previous.identityKey,
            governorId: previous.governorId,
            governorNameRaw: previous.governorNameRaw,
            governorNameNormalized: previous.governorNameNormalized,
            sourceRank: previous.sourceRank,
            metricValue: previous.metricValue.toString(),
            status: previous.status,
            lastRunId: previous.lastRunId,
            lastRowId: previous.lastRowId,
          }
        : undefined,
      nextData,
    },
    select: { id: true },
  });

  return {
    applied: true,
    reason: previous ? 'updated' : 'created',
    snapshotId: snapshot.id,
    revisionId: revision.id,
    rankingType,
  } as const;
}

export async function recordMetricObservationTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    eventId: string;
    governorId: string;
    metricKey: string;
    metricValue: string | number | bigint;
    sourceType: MetricObservationSourceType;
    sourceRank?: number | null;
    sourceRefId?: string | null;
    observedAt?: Date;
    changedByLinkId?: string | null;
    reason?: string | null;
    governorNameRaw?: string;
  }
) {
  const observationResult = await upsertMetricObservationTx(tx, args);
  if (!observationResult.observation) {
    return {
      observation: observationResult,
      canonicalSync: {
        applied: false,
        reason: 'observation-not-written',
        snapshotId: null,
        revisionId: null,
      },
    };
  }

  const canonicalSync = await syncCanonicalRankingFromObservationTx(tx, {
    workspaceId: args.workspaceId,
    eventId: args.eventId,
    governorId: args.governorId,
    metricKey: normalizeMetricKey(args.metricKey),
    metricValue: observationResult.observation.metricValue,
    sourceRank: observationResult.observation.sourceRank,
    sourceRefId: observationResult.observation.sourceRefId,
    changedByLinkId: args.changedByLinkId,
    reason: args.reason,
    governorNameRaw: args.governorNameRaw,
  });

  return {
    observation: observationResult,
    canonicalSync,
  };
}

export async function upsertProfileSnapshotForEventTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    eventId: string;
    governorId: string;
    power: bigint;
    killPoints: bigint;
    t4Kills: bigint;
    t5Kills: bigint;
    deads: bigint;
    confidencePct: number;
    changedByLinkId?: string | null;
    reason?: string | null;
  }
) {
  const previous = await tx.snapshot.findUnique({
    where: {
      eventId_governorId: {
        eventId: args.eventId,
        governorId: args.governorId,
      },
    },
    select: {
      id: true,
      power: true,
      killPoints: true,
      t4Kills: true,
      t5Kills: true,
      deads: true,
      verified: true,
      ocrConfidence: true,
    },
  });

  const snapshot = await tx.snapshot.upsert({
    where: {
      eventId_governorId: {
        eventId: args.eventId,
        governorId: args.governorId,
      },
    },
    update: {
      workspaceId: args.workspaceId,
      power: args.power,
      killPoints: args.killPoints,
      t4Kills: args.t4Kills,
      t5Kills: args.t5Kills,
      deads: args.deads,
      verified: true,
      ocrConfidence: args.confidencePct,
    },
    create: {
      workspaceId: args.workspaceId,
      eventId: args.eventId,
      governorId: args.governorId,
      power: args.power,
      killPoints: args.killPoints,
      t4Kills: args.t4Kills,
      t5Kills: args.t5Kills,
      deads: args.deads,
      verified: true,
      ocrConfidence: args.confidencePct,
    },
    select: {
      id: true,
      power: true,
      killPoints: true,
      t4Kills: true,
      t5Kills: true,
      deads: true,
      verified: true,
      ocrConfidence: true,
    },
  });

  if (previous) {
    await tx.snapshotRevision.create({
      data: {
        workspaceId: args.workspaceId,
        snapshotId: previous.id,
        changedByLinkId: args.changedByLinkId || null,
        reason: args.reason || 'Profile snapshot sync',
        previousData: {
          power: previous.power.toString(),
          killPoints: previous.killPoints.toString(),
          t4Kills: previous.t4Kills.toString(),
          t5Kills: previous.t5Kills.toString(),
          deads: previous.deads.toString(),
          verified: previous.verified,
          ocrConfidence: previous.ocrConfidence,
        },
        nextData: {
          power: snapshot.power.toString(),
          killPoints: snapshot.killPoints.toString(),
          t4Kills: snapshot.t4Kills.toString(),
          t5Kills: snapshot.t5Kills.toString(),
          deads: snapshot.deads.toString(),
          verified: snapshot.verified,
          ocrConfidence: snapshot.ocrConfidence,
        },
      },
    });
  }

  return { snapshot, previous };
}

export async function enqueueMetricSyncBacklogTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    scanJobId?: string | null;
    extractionId?: string | null;
    governorId?: string | null;
    governorGameId: string;
    governorNameRaw: string;
    power: bigint;
    killPoints: bigint;
    t4Kills: bigint;
    t5Kills: bigint;
    deads: bigint;
    sourceRefId?: string | null;
    observedAt?: Date;
    metadata?: Prisma.InputJsonValue;
  }
) {
  const observedAt = args.observedAt || new Date();
  const sourceRefId = normalizeSourceRefId(args.sourceRefId);

  if (args.extractionId) {
    return tx.metricSyncBacklog.upsert({
      where: {
        workspaceId_extractionId: {
          workspaceId: args.workspaceId,
          extractionId: args.extractionId,
        },
      },
      create: {
        workspaceId: args.workspaceId,
        scanJobId: args.scanJobId || null,
        extractionId: args.extractionId,
        governorId: args.governorId || null,
        governorGameId: args.governorGameId,
        governorNameRaw: args.governorNameRaw,
        power: args.power,
        killPoints: args.killPoints,
        t4Kills: args.t4Kills,
        t5Kills: args.t5Kills,
        deads: args.deads,
        status: MetricSyncBacklogStatus.PENDING,
        sourceRefId,
        observedAt,
        metadata: args.metadata,
      },
      update: {
        governorId: args.governorId || null,
        governorGameId: args.governorGameId,
        governorNameRaw: args.governorNameRaw,
        power: args.power,
        killPoints: args.killPoints,
        t4Kills: args.t4Kills,
        t5Kills: args.t5Kills,
        deads: args.deads,
        status: MetricSyncBacklogStatus.PENDING,
        sourceRefId,
        observedAt,
        metadata: args.metadata,
        lastError: null,
      },
    });
  }

  return tx.metricSyncBacklog.create({
    data: {
      workspaceId: args.workspaceId,
      scanJobId: args.scanJobId || null,
      governorId: args.governorId || null,
      governorGameId: args.governorGameId,
      governorNameRaw: args.governorNameRaw,
      power: args.power,
      killPoints: args.killPoints,
      t4Kills: args.t4Kills,
      t5Kills: args.t5Kills,
      deads: args.deads,
      status: MetricSyncBacklogStatus.PENDING,
      sourceRefId,
      observedAt,
      metadata: args.metadata,
    },
  });
}

async function resolveBacklogEventId(args: {
  workspaceId: string;
  linkedEventId?: string | null;
  scanJobEventId?: string | null;
}) {
  if (args.linkedEventId) return args.linkedEventId;
  if (args.scanJobEventId) return args.scanJobEventId;
  const ensured = await ensureWeeklyEventForWorkspace(args.workspaceId);
  return ensured.event.id;
}

function toProfileConfidencePct(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  const n = Number(value);
  if (n <= 1) return Math.max(0, Math.min(100, n * 100));
  return Math.max(0, Math.min(100, n));
}

function detectSuspiciousProfileMetricPair(args: {
  power: bigint;
  killPoints: bigint;
  t4Kills: bigint;
  t5Kills: bigint;
  deads: bigint;
}): string | null {
  if (args.power <= BigInt(0)) {
    return 'power is zero or missing';
  }
  if (args.killPoints === BigInt(111015) && args.power === BigInt(0)) {
    return 'matches known OCR artifact pattern (power=0 & killPoints=111015)';
  }
  return null;
}

export async function countPendingMetricSyncBacklog(args: {
  workspaceId: string;
  linkedEventId?: string | null;
}) {
  return prisma.metricSyncBacklog.count({
    where: {
      workspaceId: args.workspaceId,
      ...(args.linkedEventId ? { linkedEventId: args.linkedEventId } : {}),
      status: {
        in: [MetricSyncBacklogStatus.PENDING, MetricSyncBacklogStatus.FAILED],
      },
    },
  });
}

export async function getMetricSourceCoverage(args: {
  workspaceId: string;
  eventId?: string | null;
}) {
  const rows = await prisma.metricObservation.findMany({
    where: {
      workspaceId: args.workspaceId,
      ...(args.eventId ? { eventId: args.eventId } : {}),
      metricKey: {
        in: [METRIC_KEY_POWER, METRIC_KEY_KILL_POINTS],
      },
    },
    select: {
      metricKey: true,
      sourceType: true,
    },
  });

  const coverage = {
    power: { profile: 0, rankboard: 0, total: 0 },
    killPoints: { profile: 0, rankboard: 0, total: 0 },
  };

  for (const row of rows) {
    const key = row.metricKey === METRIC_KEY_POWER ? 'power' : 'killPoints';
    const source = row.sourceType === MetricObservationSourceType.PROFILE ? 'profile' : 'rankboard';
    coverage[key][source] += 1;
    coverage[key].total += 1;
  }

  return coverage;
}

export async function drainMetricSyncBacklog(args: {
  workspaceId: string;
  limit?: number;
  changedByLinkId?: string | null;
}) {
  const limit = Math.max(1, Math.min(100, Math.floor(args.limit || 25)));
  const queued = await prisma.metricSyncBacklog.findMany({
    where: {
      workspaceId: args.workspaceId,
      status: {
        in: [MetricSyncBacklogStatus.PENDING, MetricSyncBacklogStatus.FAILED],
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
    include: {
      scanJob: {
        select: {
          eventId: true,
        },
      },
    },
  });

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const row of queued) {
    const claim = await prisma.metricSyncBacklog.updateMany({
      where: {
        id: row.id,
        status: {
          in: [MetricSyncBacklogStatus.PENDING, MetricSyncBacklogStatus.FAILED],
        },
      },
      data: {
        status: MetricSyncBacklogStatus.PROCESSING,
        attemptCount: { increment: 1 },
      },
    });

    if (!claim.count) continue;
    processed += 1;

    try {
      const suspiciousReason = detectSuspiciousProfileMetricPair({
        power: row.power,
        killPoints: row.killPoints,
        t4Kills: row.t4Kills,
        t5Kills: row.t5Kills,
        deads: row.deads,
      });
      if (suspiciousReason) {
        failed += 1;
        await prisma.metricSyncBacklog.update({
          where: { id: row.id },
          data: {
            status: MetricSyncBacklogStatus.FAILED,
            lastError: `Skipped invalid profile metrics: ${suspiciousReason}`.slice(0, 500),
          },
        });
        continue;
      }

      const resolvedEventId = await resolveBacklogEventId({
        workspaceId: args.workspaceId,
        linkedEventId: row.linkedEventId,
        scanJobEventId: row.scanJob?.eventId,
      });

      await prisma.$transaction(async (tx) => {
        const governor = row.governorId
          ? await tx.governor.findUnique({
              where: { id: row.governorId },
              select: {
                id: true,
                governorId: true,
                name: true,
              },
            })
          : await tx.governor.findFirst({
              where: {
                workspaceId: args.workspaceId,
                governorId: row.governorGameId,
              },
              select: {
                id: true,
                governorId: true,
                name: true,
              },
            });

        if (!governor) {
          throw new ApiHttpError('NOT_FOUND', 'Governor mapping missing for backlog entry.', 404);
        }

        await upsertProfileSnapshotForEventTx(tx, {
          workspaceId: args.workspaceId,
          eventId: resolvedEventId,
          governorId: governor.id,
          power: row.power,
          killPoints: row.killPoints,
          t4Kills: row.t4Kills,
          t5Kills: row.t5Kills,
          deads: row.deads,
          confidencePct: toProfileConfidencePct(100),
          changedByLinkId: args.changedByLinkId,
          reason: 'Metric sync backlog drain',
        });

        await recordMetricObservationTx(tx, {
          workspaceId: args.workspaceId,
          eventId: resolvedEventId,
          governorId: governor.id,
          metricKey: METRIC_KEY_POWER,
          metricValue: row.power,
          sourceType: MetricObservationSourceType.PROFILE,
          sourceRank: null,
          sourceRefId: row.sourceRefId || `backlog:${row.id}:power`,
          observedAt: row.observedAt,
          changedByLinkId: args.changedByLinkId,
          reason: 'Metric sync backlog drain (power)',
          governorNameRaw: governor.name,
        });

        await recordMetricObservationTx(tx, {
          workspaceId: args.workspaceId,
          eventId: resolvedEventId,
          governorId: governor.id,
          metricKey: METRIC_KEY_KILL_POINTS,
          metricValue: row.killPoints,
          sourceType: MetricObservationSourceType.PROFILE,
          sourceRank: null,
          sourceRefId: row.sourceRefId || `backlog:${row.id}:kill_points`,
          observedAt: row.observedAt,
          changedByLinkId: args.changedByLinkId,
          reason: 'Metric sync backlog drain (kill points)',
          governorNameRaw: governor.name,
        });

        await tx.metricSyncBacklog.update({
          where: { id: row.id },
          data: {
            status: MetricSyncBacklogStatus.COMPLETED,
            governorId: governor.id,
            linkedEventId: resolvedEventId,
            processedAt: new Date(),
            lastError: null,
          },
        });
      });

      succeeded += 1;
    } catch (error) {
      failed += 1;
      await prisma.metricSyncBacklog.update({
        where: { id: row.id },
        data: {
          status: MetricSyncBacklogStatus.FAILED,
          lastError: error instanceof Error ? error.message.slice(0, 500) : 'Backlog drain failed.',
        },
      });
    }
  }

  const pending = await countPendingMetricSyncBacklog({
    workspaceId: args.workspaceId,
  });

  return {
    processed,
    succeeded,
    failed,
    pending,
  };
}

export async function drainMetricSyncBacklogOnRead(
  workspaceId: string,
  limit = 10
): Promise<void> {
  try {
    await drainMetricSyncBacklog({
      workspaceId,
      limit,
    });
  } catch (error) {
    console.error('[metric-sync] read-path drain failed', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
