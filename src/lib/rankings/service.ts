import {
  IngestionDomain,
  Prisma,
  RankingIdentityStatus,
  RankingRowReviewAction,
  RankingRunStatus,
  RankingSnapshotStatus,
  ScanJobSource,
} from '@prisma/client';
import { ApiHttpError } from '@/lib/api-response';
import { withIdempotency } from '@/lib/idempotency';
import { prisma } from '@/lib/prisma';
import { hashRequestPayload } from '@/lib/security';
import { resolveRankingIdentity } from './identity';
import {
  computeCanonicalIdentityKey,
  computeCaptureFingerprint,
  computeRankingRowHash,
  normalizeGovernorAlias,
  normalizeGovernorDisplayName,
  normalizeMetricKey,
  normalizeRankingType,
  parseRankingMetric,
} from './normalize';
import {
  applyStableRanking,
  compareRankingRows,
  decodeRankingCursor,
  encodeRankingCursor,
} from './sorting';

export interface RankingRowInput {
  sourceRank?: number | null;
  governorNameRaw: string;
  allianceRaw?: string | null;
  titleRaw?: string | null;
  metricRaw: string;
  metricValue?: string | number | bigint | null;
  confidence?: number;
  ocrTrace?: unknown;
  candidates?: unknown;
}

interface PreparedRankingRow {
  sourceRank: number | null;
  governorNameRaw: string;
  governorNameNormalized: string;
  allianceRaw: string | null;
  titleRaw: string | null;
  metricRaw: string;
  metricValue: bigint;
  confidence: number;
  rowHash: string;
  ocrTrace: Prisma.InputJsonValue | undefined;
  candidates: Prisma.InputJsonValue | undefined;
}

export interface CreateRankingRunInput {
  workspaceId: string;
  eventId?: string | null;
  source?: ScanJobSource;
  domain?: IngestionDomain;
  rankingType: string;
  metricKey: string;
  headerText?: string | null;
  artifactId?: string | null;
  metadata?: Prisma.InputJsonValue;
  notes?: string | null;
  idempotencyKey?: string | null;
  createdByLinkId?: string | null;
  captureFingerprint?: string | null;
  rows: RankingRowInput[];
}

export interface ListCanonicalRankingsInput {
  workspaceId: string;
  eventId?: string | null;
  rankingType?: string | null;
  metricKey?: string | null;
  q?: string | null;
  sort?: string | null;
  status?: RankingSnapshotStatus[];
  limit: number;
  cursor?: string | null;
}

interface MergeResult {
  applied: boolean;
  snapshotId: string | null;
  revisionId: string | null;
  reason: string;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;
  return value as Prisma.InputJsonValue;
}

function mapIdentityToSnapshotStatus(identityStatus: RankingIdentityStatus): RankingSnapshotStatus {
  if (identityStatus === RankingIdentityStatus.REJECTED) {
    return RankingSnapshotStatus.REJECTED;
  }
  if (identityStatus === RankingIdentityStatus.UNRESOLVED) {
    return RankingSnapshotStatus.UNRESOLVED;
  }
  return RankingSnapshotStatus.ACTIVE;
}

function normalizeRank(value: number | null | undefined): number | null {
  if (!Number.isFinite(value ?? NaN)) return null;
  const intValue = Math.floor(Number(value));
  if (intValue < 1 || intValue > 5000) return null;
  return intValue;
}

function normalizeConfidence(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  const normalized = Number(value);
  if (normalized <= 1) return Math.max(0, Math.min(100, normalized * 100));
  return Math.max(0, Math.min(100, normalized));
}

function prepareRows(input: {
  rows: RankingRowInput[];
  rankingType: string;
  metricKey: string;
}): PreparedRankingRow[] {
  const rankingType = normalizeRankingType(input.rankingType);
  const metricKey = normalizeMetricKey(input.metricKey);

  return input.rows
    .map((row) => {
      const governorNameRaw = normalizeGovernorDisplayName(row.governorNameRaw);
      const governorNameNormalized = normalizeGovernorAlias(governorNameRaw);
      const metricRaw = String(row.metricRaw || '').trim();
      const metricValue = parseRankingMetric(row.metricValue ?? row.metricRaw);
      const sourceRank = normalizeRank(row.sourceRank);

      if (!governorNameRaw && metricValue === BigInt(0)) {
        return null;
      }

      const rowHash = computeRankingRowHash({
        sourceRank,
        governorNameRaw,
        metricRaw,
        rankingType,
        metricKey,
      });

      return {
        sourceRank,
        governorNameRaw,
        governorNameNormalized,
        allianceRaw: row.allianceRaw ? String(row.allianceRaw).trim().slice(0, 80) : null,
        titleRaw: row.titleRaw ? String(row.titleRaw).trim().slice(0, 80) : null,
        metricRaw,
        metricValue,
        confidence: normalizeConfidence(row.confidence),
        rowHash,
        ocrTrace: toJsonValue(row.ocrTrace),
        candidates: toJsonValue(row.candidates),
      } satisfies PreparedRankingRow;
    })
    .filter((row): row is PreparedRankingRow => Boolean(row));
}

function toSnapshotRecord(snapshot: {
  id: string;
  identityKey: string;
  status: RankingSnapshotStatus;
  governorId: string | null;
  governorNameRaw: string;
  governorNameNormalized: string;
  sourceRank: number | null;
  metricValue: bigint;
  rankingType: string;
  metricKey: string;
  lastRunId: string | null;
  lastRowId: string | null;
  updatedAt: Date;
}) {
  return {
    id: snapshot.id,
    identityKey: snapshot.identityKey,
    status: snapshot.status,
    governorId: snapshot.governorId,
    governorNameRaw: snapshot.governorNameRaw,
    governorNameNormalized: snapshot.governorNameNormalized,
    sourceRank: snapshot.sourceRank,
    metricValue: snapshot.metricValue.toString(),
    rankingType: snapshot.rankingType,
    metricKey: snapshot.metricKey,
    lastRunId: snapshot.lastRunId,
    lastRowId: snapshot.lastRowId,
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

async function mergeRankingRowToCanonicalTx(
  tx: Prisma.TransactionClient,
  args: {
    run: {
      id: string;
      workspaceId: string;
      eventId: string | null;
      rankingType: string;
      metricKey: string;
      createdAt: Date;
    };
    row: {
      id: string;
      governorId: string | null;
      governorNameRaw: string;
      governorNameNormalized: string;
      sourceRank: number | null;
      metricValue: bigint;
      identityStatus: RankingIdentityStatus;
      updatedAt: Date;
    };
    changedByLinkId?: string | null;
    action?: RankingRowReviewAction;
    reason?: string | null;
  }
): Promise<MergeResult> {
  if (!args.run.eventId) {
    return {
      applied: false,
      snapshotId: null,
      revisionId: null,
      reason: 'missing-event',
    };
  }

  const identityKey = computeCanonicalIdentityKey({
    governorId: args.row.governorId,
    governorNameNormalized: args.row.governorNameNormalized,
  });

  const existing = await tx.rankingSnapshot.findUnique({
    where: {
      workspaceId_eventId_rankingType_identityKey: {
        workspaceId: args.run.workspaceId,
        eventId: args.run.eventId,
        rankingType: args.run.rankingType,
        identityKey,
      },
    },
    include: {
      lastRun: {
        select: {
          id: true,
          createdAt: true,
        },
      },
      lastRow: {
        select: {
          id: true,
          updatedAt: true,
        },
      },
    },
  });

  if (existing?.lastRun?.createdAt && existing.lastRun.createdAt > args.run.createdAt) {
    return {
      applied: false,
      snapshotId: existing.id,
      revisionId: null,
      reason: 'existing-run-is-newer',
    };
  }

  if (
    existing?.lastRun?.createdAt &&
    existing.lastRun.createdAt.getTime() === args.run.createdAt.getTime() &&
    existing.lastRow?.updatedAt &&
    existing.lastRow.updatedAt > args.row.updatedAt
  ) {
    return {
      applied: false,
      snapshotId: existing.id,
      revisionId: null,
      reason: 'existing-row-is-newer',
    };
  }

  const nextStatus = mapIdentityToSnapshotStatus(args.row.identityStatus);

  const nextData = {
    rankingType: args.run.rankingType,
    metricKey: args.run.metricKey,
    identityKey,
    governorId: args.row.governorId,
    governorNameRaw: args.row.governorNameRaw,
    governorNameNormalized: args.row.governorNameNormalized,
    sourceRank: args.row.sourceRank,
    metricValue: args.row.metricValue.toString(),
    status: nextStatus,
    lastRunId: args.run.id,
    lastRowId: args.row.id,
  };

  const snapshot = await tx.rankingSnapshot.upsert({
    where: {
      workspaceId_eventId_rankingType_identityKey: {
        workspaceId: args.run.workspaceId,
        eventId: args.run.eventId,
        rankingType: args.run.rankingType,
        identityKey,
      },
    },
    create: {
      workspaceId: args.run.workspaceId,
      eventId: args.run.eventId,
      rankingType: args.run.rankingType,
      metricKey: args.run.metricKey,
      identityKey,
      governorId: args.row.governorId,
      governorNameRaw: args.row.governorNameRaw,
      governorNameNormalized: args.row.governorNameNormalized,
      sourceRank: args.row.sourceRank,
      metricValue: args.row.metricValue,
      status: nextStatus,
      lastRunId: args.run.id,
      lastRowId: args.row.id,
    },
    update: {
      metricKey: args.run.metricKey,
      governorId: args.row.governorId,
      governorNameRaw: args.row.governorNameRaw,
      governorNameNormalized: args.row.governorNameNormalized,
      sourceRank: args.row.sourceRank,
      metricValue: args.row.metricValue,
      status: nextStatus,
      lastRunId: args.run.id,
      lastRowId: args.row.id,
    },
  });

  const previousData = existing
    ? {
        rankingType: existing.rankingType,
        metricKey: existing.metricKey,
        identityKey: existing.identityKey,
        governorId: existing.governorId,
        governorNameRaw: existing.governorNameRaw,
        governorNameNormalized: existing.governorNameNormalized,
        sourceRank: existing.sourceRank,
        metricValue: existing.metricValue.toString(),
        status: existing.status,
        lastRunId: existing.lastRunId,
        lastRowId: existing.lastRowId,
      }
    : null;

  const revision = await tx.rankingRevision.create({
    data: {
      workspaceId: args.run.workspaceId,
      snapshotId: snapshot.id,
      runId: args.run.id,
      rowId: args.row.id,
      changedByLinkId: args.changedByLinkId || null,
      action: args.action || RankingRowReviewAction.SYSTEM_MERGE,
      reason: args.reason || 'Canonical ranking merge',
      previousData: previousData as Prisma.InputJsonValue,
      nextData: nextData as Prisma.InputJsonValue,
    },
    select: {
      id: true,
    },
  });

  return {
    applied: true,
    snapshotId: snapshot.id,
    revisionId: revision.id,
    reason: existing ? 'updated' : 'created',
  };
}

async function updateRankingRunStatusTx(
  tx: Prisma.TransactionClient,
  runId: string,
  eventId: string | null
) {
  const unresolved = await tx.rankingRow.count({
    where: {
      runId,
      identityStatus: RankingIdentityStatus.UNRESOLVED,
    },
  });

  const rejected = await tx.rankingRow.count({
    where: {
      runId,
      identityStatus: RankingIdentityStatus.REJECTED,
    },
  });

  const status = !eventId
    ? RankingRunStatus.REVIEW
    : unresolved > 0
      ? RankingRunStatus.REVIEW
      : RankingRunStatus.MERGED;

  const updated = await tx.rankingRun.update({
    where: { id: runId },
    data: {
      status,
      processedAt: new Date(),
      error: null,
    },
    select: {
      id: true,
      status: true,
      processedAt: true,
      rankingType: true,
      metricKey: true,
      eventId: true,
    },
  });

  return {
    run: updated,
    unresolved,
    rejected,
  };
}

export async function reconcileRankingRun(args: {
  runId: string;
  changedByLinkId?: string | null;
  reason?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.rankingRun.findUnique({
      where: { id: args.runId },
      select: {
        id: true,
        workspaceId: true,
        eventId: true,
        rankingType: true,
        metricKey: true,
        createdAt: true,
        rows: {
          orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            governorId: true,
            governorNameRaw: true,
            governorNameNormalized: true,
            sourceRank: true,
            metricValue: true,
            identityStatus: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!run) {
      throw new ApiHttpError('NOT_FOUND', 'Ranking run not found.', 404);
    }

    let merged = 0;
    let skipped = 0;
    let revisions = 0;

    for (const row of run.rows) {
      const mergedRow = await mergeRankingRowToCanonicalTx(tx, {
        run,
        row,
        changedByLinkId: args.changedByLinkId,
        action: RankingRowReviewAction.SYSTEM_MERGE,
        reason: args.reason || 'Run reconciliation',
      });
      if (mergedRow.applied) {
        merged += 1;
        revisions += 1;
      } else {
        skipped += 1;
      }
    }

    const status = await updateRankingRunStatusTx(tx, run.id, run.eventId);

    return {
      runId: run.id,
      rankingType: run.rankingType,
      metricKey: run.metricKey,
      merged,
      skipped,
      revisions,
      unresolved: status.unresolved,
      rejected: status.rejected,
      status: status.run.status,
      processedAt: status.run.processedAt?.toISOString() || null,
    };
  });
}

function dedupeCandidatesJson(
  existing: unknown,
  suggestions: Array<{ governorId: string; governorGameId: string; name: string; source: 'alias' | 'name' }>
): Prisma.InputJsonValue | undefined {
  const base = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {};
  return {
    ...base,
    identitySuggestions: suggestions,
  } as Prisma.InputJsonValue;
}

export async function createRankingRunWithRows(input: CreateRankingRunInput) {
  const rankingType = normalizeRankingType(input.rankingType);
  const metricKey = normalizeMetricKey(input.metricKey);
  const preparedRows = prepareRows({
    rows: input.rows,
    rankingType,
    metricKey,
  });

  if (preparedRows.length === 0) {
    throw new ApiHttpError('VALIDATION_ERROR', 'At least one ranking row is required.', 400);
  }

  const dedupeHash = hashRequestPayload(preparedRows.map((row) => row.rowHash));
  const captureFingerprint =
    input.captureFingerprint ||
    computeCaptureFingerprint({
      rankingType,
      metricKey,
      headerText: input.headerText,
      eventId: input.eventId,
      fileName: null,
      bytes: preparedRows.length,
      checksum: dedupeHash,
    });

  const idempotent = await withIdempotency({
    workspaceId: input.workspaceId,
    scope: 'ranking-run',
    key: input.idempotencyKey,
    request: {
      workspaceId: input.workspaceId,
      eventId: input.eventId || null,
      rankingType,
      metricKey,
      headerText: input.headerText || null,
      dedupeHash,
      rows: preparedRows.map((row) => ({
        sourceRank: row.sourceRank,
        governorNameRaw: row.governorNameRaw,
        metricRaw: row.metricRaw,
        metricValue: row.metricValue.toString(),
      })),
    },
    execute: async () => {
      const created = await prisma.$transaction(async (tx) => {
        const duplicate = await tx.rankingRun.findFirst({
          where: {
            workspaceId: input.workspaceId,
            eventId: input.eventId || null,
            rankingType,
            metricKey,
            captureFingerprint,
            dedupeHash,
            status: {
              in: [RankingRunStatus.RAW, RankingRunStatus.REVIEW, RankingRunStatus.MERGED],
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            id: true,
            status: true,
            createdAt: true,
            _count: {
              select: {
                rows: true,
              },
            },
          },
        });

        if (duplicate) {
          return {
            runId: duplicate.id,
            deduped: true,
            status: duplicate.status,
            createdAt: duplicate.createdAt.toISOString(),
            rowCount: duplicate._count.rows,
            unresolvedCount: 0,
          };
        }

        const run = await tx.rankingRun.create({
          data: {
            workspaceId: input.workspaceId,
            eventId: input.eventId || null,
            artifactId: input.artifactId || null,
            createdByLinkId: input.createdByLinkId || null,
            domain: input.domain || IngestionDomain.RANKING_CAPTURE,
            rankingType,
            metricKey,
            headerText: input.headerText ? String(input.headerText).trim().slice(0, 120) : null,
            source: input.source || ScanJobSource.MANUAL_UPLOAD,
            status: RankingRunStatus.RAW,
            idempotencyKey: input.idempotencyKey || null,
            captureFingerprint,
            dedupeHash,
            metadata: toJsonValue(input.metadata),
            notes: input.notes ? String(input.notes).trim().slice(0, 500) : null,
          },
          select: {
            id: true,
            status: true,
            createdAt: true,
          },
        });

        let unresolvedCount = 0;

        for (const row of preparedRows) {
          const identity = await resolveRankingIdentity(tx, {
            workspaceId: input.workspaceId,
            governorNameRaw: row.governorNameRaw,
          });

          await tx.rankingRow.upsert({
            where: {
              runId_rowHash: {
                runId: run.id,
                rowHash: row.rowHash,
              },
            },
            update: {
              sourceRank: row.sourceRank,
              governorNameRaw: row.governorNameRaw,
              governorNameNormalized: row.governorNameNormalized,
              allianceRaw: row.allianceRaw,
              titleRaw: row.titleRaw,
              metricRaw: row.metricRaw,
              metricValue: row.metricValue,
              confidence: row.confidence,
              governorId: identity.governorId,
              identityStatus: identity.status,
              ocrTrace: row.ocrTrace,
              candidates: dedupeCandidatesJson(row.candidates, identity.suggestions),
            },
            create: {
              workspaceId: input.workspaceId,
              runId: run.id,
              sourceRank: row.sourceRank,
              governorNameRaw: row.governorNameRaw,
              governorNameNormalized: row.governorNameNormalized,
              allianceRaw: row.allianceRaw,
              titleRaw: row.titleRaw,
              metricRaw: row.metricRaw,
              metricValue: row.metricValue,
              confidence: row.confidence,
              governorId: identity.governorId,
              identityStatus: identity.status,
              rowHash: row.rowHash,
              ocrTrace: row.ocrTrace,
              candidates: dedupeCandidatesJson(row.candidates, identity.suggestions),
            },
          });

          if (identity.status === RankingIdentityStatus.UNRESOLVED) {
            unresolvedCount += 1;
          }
        }

        const status = unresolvedCount > 0 ? RankingRunStatus.REVIEW : RankingRunStatus.RAW;

        await tx.rankingRun.update({
          where: { id: run.id },
          data: {
            status,
          },
        });

        return {
          runId: run.id,
          deduped: false,
          status,
          createdAt: run.createdAt.toISOString(),
          rowCount: preparedRows.length,
          unresolvedCount,
        };
      });

      return created;
    },
  });

  if (!idempotent.value.deduped) {
    await reconcileRankingRun({
      runId: idempotent.value.runId,
      changedByLinkId: input.createdByLinkId || null,
      reason: 'Initial run reconciliation',
    });
  }

  const withCounts = await prisma.rankingRun.findUnique({
    where: { id: idempotent.value.runId },
    include: {
      _count: {
        select: {
          rows: true,
          snapshots: true,
          revisions: true,
        },
      },
    },
  });

  if (!withCounts) {
    throw new ApiHttpError('NOT_FOUND', 'Ranking run not found after create.', 404);
  }

  const unresolved = await prisma.rankingRow.count({
    where: {
      runId: withCounts.id,
      identityStatus: RankingIdentityStatus.UNRESOLVED,
    },
  });

  return {
    id: withCounts.id,
    workspaceId: withCounts.workspaceId,
    eventId: withCounts.eventId,
    rankingType: withCounts.rankingType,
    metricKey: withCounts.metricKey,
    status: withCounts.status,
    domain: withCounts.domain,
    source: withCounts.source,
    headerText: withCounts.headerText,
    deduped: idempotent.value.deduped,
    createdAt: withCounts.createdAt.toISOString(),
    updatedAt: withCounts.updatedAt.toISOString(),
    processedAt: withCounts.processedAt?.toISOString() || null,
    counts: {
      rows: withCounts._count.rows,
      snapshots: withCounts._count.snapshots,
      revisions: withCounts._count.revisions,
      unresolved,
    },
    idempotentReplay: idempotent.replayed,
  };
}

export async function getRankingRunById(args: {
  workspaceId: string;
  runId: string;
}) {
  const run = await prisma.rankingRun.findFirst({
    where: {
      id: args.runId,
      workspaceId: args.workspaceId,
    },
    include: {
      event: {
        select: {
          id: true,
          name: true,
        },
      },
      artifact: {
        select: {
          id: true,
          url: true,
          type: true,
        },
      },
      rows: {
        include: {
          governor: {
            select: {
              id: true,
              governorId: true,
              name: true,
            },
          },
        },
      },
      _count: {
        select: {
          rows: true,
          snapshots: true,
          revisions: true,
        },
      },
    },
  });

  if (!run) {
    throw new ApiHttpError('NOT_FOUND', 'Ranking run not found.', 404);
  }

  const ranked = applyStableRanking(
    run.rows.map((row) => ({
      rowId: row.id,
      sourceRank: row.sourceRank,
      governorNameNormalized: row.governorNameNormalized,
      metricValue: row.metricValue,
      row,
    }))
  );

  return {
    id: run.id,
    workspaceId: run.workspaceId,
    eventId: run.eventId,
    event: run.event,
    rankingType: run.rankingType,
    metricKey: run.metricKey,
    status: run.status,
    domain: run.domain,
    source: run.source,
    headerText: run.headerText,
    notes: run.notes,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    processedAt: run.processedAt?.toISOString() || null,
    artifact: run.artifact,
    counts: run._count,
    rows: ranked.map((entry) => ({
      id: entry.item.row.id,
      sourceRank: entry.item.row.sourceRank,
      stableIndex: entry.stableIndex,
      stableRank: entry.displayRank,
      tieGroup: entry.tieGroup,
      governorNameRaw: entry.item.row.governorNameRaw,
      governorNameNormalized: entry.item.row.governorNameNormalized,
      governorId: entry.item.row.governorId,
      governor: entry.item.row.governor,
      allianceRaw: entry.item.row.allianceRaw,
      titleRaw: entry.item.row.titleRaw,
      metricRaw: entry.item.row.metricRaw,
      metricValue: entry.item.row.metricValue.toString(),
      confidence: entry.item.row.confidence,
      identityStatus: entry.item.row.identityStatus,
      ocrTrace: entry.item.row.ocrTrace,
      candidates: entry.item.row.candidates,
      createdAt: entry.item.row.createdAt.toISOString(),
      updatedAt: entry.item.row.updatedAt.toISOString(),
    })),
  };
}

export async function listRankingRuns(args: {
  workspaceId: string;
  eventId?: string | null;
  rankingType?: string | null;
  status?: RankingRunStatus | null;
  limit: number;
  offset: number;
}) {
  const where: Prisma.RankingRunWhereInput = {
    workspaceId: args.workspaceId,
    ...(args.eventId ? { eventId: args.eventId } : {}),
    ...(args.rankingType
      ? { rankingType: normalizeRankingType(args.rankingType) }
      : {}),
    ...(args.status ? { status: args.status } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.rankingRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: args.limit,
      skip: args.offset,
      include: {
        _count: {
          select: {
            rows: true,
            snapshots: true,
            revisions: true,
          },
        },
      },
    }),
    prisma.rankingRun.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((run) => ({
      id: run.id,
      workspaceId: run.workspaceId,
      eventId: run.eventId,
      rankingType: run.rankingType,
      metricKey: run.metricKey,
      status: run.status,
      domain: run.domain,
      source: run.source,
      headerText: run.headerText,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      processedAt: run.processedAt?.toISOString() || null,
      counts: run._count,
    })),
  };
}

async function resolveGovernorRef(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    governorDbId?: string | null;
    governorGameId?: string | null;
  }
) {
  if (args.governorDbId) {
    const governor = await tx.governor.findFirst({
      where: {
        id: args.governorDbId,
        workspaceId: args.workspaceId,
      },
      select: {
        id: true,
        governorId: true,
        name: true,
      },
    });
    if (!governor) {
      throw new ApiHttpError('NOT_FOUND', 'Governor not found for workspace.', 404);
    }
    return governor;
  }

  if (args.governorGameId) {
    const governor = await tx.governor.findFirst({
      where: {
        governorId: args.governorGameId,
        workspaceId: args.workspaceId,
      },
      select: {
        id: true,
        governorId: true,
        name: true,
      },
    });
    if (!governor) {
      throw new ApiHttpError('NOT_FOUND', 'Governor game ID not found for workspace.', 404);
    }
    return governor;
  }

  return null;
}

export async function applyRankingReviewAction(args: {
  workspaceId: string;
  rowId: string;
  changedByLinkId: string;
  action: RankingRowReviewAction;
  reason?: string | null;
  governorDbId?: string | null;
  governorGameId?: string | null;
  aliasRaw?: string | null;
  corrected?: {
    sourceRank?: number | null;
    governorNameRaw?: string;
    allianceRaw?: string | null;
    titleRaw?: string | null;
    metricRaw?: string;
    metricValue?: string | number | bigint | null;
  };
}) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.rankingRow.findFirst({
      where: {
        id: args.rowId,
        workspaceId: args.workspaceId,
      },
      include: {
        run: {
          select: {
            id: true,
            workspaceId: true,
            eventId: true,
            rankingType: true,
            metricKey: true,
            createdAt: true,
          },
        },
      },
    });

    if (!row) {
      throw new ApiHttpError('NOT_FOUND', 'Ranking row not found.', 404);
    }

    let governorId = row.governorId;
    let identityStatus = row.identityStatus;
    let governorNameRaw = row.governorNameRaw;
    let governorNameNormalized = row.governorNameNormalized;
    let sourceRank = row.sourceRank;
    let allianceRaw = row.allianceRaw;
    let titleRaw = row.titleRaw;
    let metricRaw = row.metricRaw;
    let metricValue = row.metricValue;

    if (args.action === RankingRowReviewAction.LINK_TO_GOVERNOR) {
      const governor = await resolveGovernorRef(tx, {
        workspaceId: args.workspaceId,
        governorDbId: args.governorDbId,
        governorGameId: args.governorGameId,
      });
      if (!governor) {
        throw new ApiHttpError('VALIDATION_ERROR', 'Governor reference is required.', 400);
      }
      governorId = governor.id;
      identityStatus = RankingIdentityStatus.MANUAL_LINKED;
    }

    if (args.action === RankingRowReviewAction.CREATE_ALIAS) {
      const aliasRaw = normalizeGovernorDisplayName(args.aliasRaw || row.governorNameRaw);
      if (!aliasRaw) {
        throw new ApiHttpError('VALIDATION_ERROR', 'Alias cannot be empty.', 400);
      }
      const aliasNormalized = normalizeGovernorAlias(aliasRaw);
      if (!aliasNormalized) {
        throw new ApiHttpError('VALIDATION_ERROR', 'Alias could not be normalized.', 400);
      }

      const governor = await resolveGovernorRef(tx, {
        workspaceId: args.workspaceId,
        governorDbId: args.governorDbId,
        governorGameId: args.governorGameId,
      });

      if (!governor) {
        throw new ApiHttpError('VALIDATION_ERROR', 'Governor reference is required for alias creation.', 400);
      }

      const existingAlias = await tx.governorAlias.findUnique({
        where: {
          workspaceId_aliasNormalized: {
            workspaceId: args.workspaceId,
            aliasNormalized,
          },
        },
      });

      if (existingAlias && existingAlias.governorId !== governor.id) {
        throw new ApiHttpError(
          'CONFLICT',
          'Alias is already mapped to another governor in this workspace.',
          409
        );
      }

      await tx.governorAlias.upsert({
        where: {
          workspaceId_aliasNormalized: {
            workspaceId: args.workspaceId,
            aliasNormalized,
          },
        },
        create: {
          workspaceId: args.workspaceId,
          governorId: governor.id,
          aliasRaw,
          aliasNormalized,
          confidence: 1,
          source: 'review',
        },
        update: {
          governorId: governor.id,
          aliasRaw,
          confidence: 1,
          source: 'review',
        },
      });

      governorId = governor.id;
      identityStatus = RankingIdentityStatus.MANUAL_LINKED;
    }

    if (args.action === RankingRowReviewAction.CORRECT_ROW) {
      if (args.corrected) {
        sourceRank = normalizeRank(args.corrected.sourceRank ?? row.sourceRank);
        governorNameRaw = args.corrected.governorNameRaw
          ? normalizeGovernorDisplayName(args.corrected.governorNameRaw)
          : row.governorNameRaw;
        governorNameNormalized = normalizeGovernorAlias(governorNameRaw);
        allianceRaw = args.corrected.allianceRaw
          ? normalizeGovernorDisplayName(args.corrected.allianceRaw)
          : args.corrected.allianceRaw === null
            ? null
            : row.allianceRaw;
        titleRaw = args.corrected.titleRaw
          ? normalizeGovernorDisplayName(args.corrected.titleRaw)
          : args.corrected.titleRaw === null
            ? null
            : row.titleRaw;
        metricRaw = args.corrected.metricRaw != null ? String(args.corrected.metricRaw).trim() : row.metricRaw;
        metricValue = parseRankingMetric(args.corrected.metricValue ?? metricRaw);
      }

      const explicitGovernor = await resolveGovernorRef(tx, {
        workspaceId: args.workspaceId,
        governorDbId: args.governorDbId,
        governorGameId: args.governorGameId,
      });

      if (explicitGovernor) {
        governorId = explicitGovernor.id;
        identityStatus = RankingIdentityStatus.MANUAL_LINKED;
      } else {
        const resolved = await resolveRankingIdentity(tx, {
          workspaceId: args.workspaceId,
          governorNameRaw,
        });
        governorId = resolved.governorId;
        identityStatus = resolved.status;
      }
    }

    if (args.action === RankingRowReviewAction.REJECT_ROW) {
      governorId = null;
      identityStatus = RankingIdentityStatus.REJECTED;
    }

    const rowHash = computeRankingRowHash({
      sourceRank,
      governorNameRaw,
      metricRaw,
      rankingType: row.run.rankingType,
      metricKey: row.run.metricKey,
    });

    const conflictRow = await tx.rankingRow.findUnique({
      where: {
        runId_rowHash: {
          runId: row.runId,
          rowHash,
        },
      },
      select: { id: true },
    });

    if (conflictRow && conflictRow.id !== row.id) {
      throw new ApiHttpError('CONFLICT', 'Corrected row duplicates an existing row in this run.', 409);
    }

    const updated = await tx.rankingRow.update({
      where: { id: row.id },
      data: {
        reviewedByLinkId: args.changedByLinkId,
        governorId,
        identityStatus,
        sourceRank,
        governorNameRaw,
        governorNameNormalized,
        allianceRaw,
        titleRaw,
        metricRaw,
        metricValue,
        rowHash,
      },
      include: {
        governor: {
          select: {
            id: true,
            governorId: true,
            name: true,
          },
        },
      },
    });

    const merged = await mergeRankingRowToCanonicalTx(tx, {
      run: row.run,
      row: {
        id: updated.id,
        governorId: updated.governorId,
        governorNameRaw: updated.governorNameRaw,
        governorNameNormalized: updated.governorNameNormalized,
        sourceRank: updated.sourceRank,
        metricValue: updated.metricValue,
        identityStatus: updated.identityStatus,
        updatedAt: updated.updatedAt,
      },
      changedByLinkId: args.changedByLinkId,
      action: args.action,
      reason: args.reason || 'Manual ranking review action',
    });

    const runStatus = await updateRankingRunStatusTx(tx, row.runId, row.run.eventId);

    return {
      row: {
        id: updated.id,
        runId: updated.runId,
        sourceRank: updated.sourceRank,
        governorNameRaw: updated.governorNameRaw,
        governorNameNormalized: updated.governorNameNormalized,
        governorId: updated.governorId,
        governor: updated.governor,
        allianceRaw: updated.allianceRaw,
        titleRaw: updated.titleRaw,
        metricRaw: updated.metricRaw,
        metricValue: updated.metricValue.toString(),
        confidence: updated.confidence,
        identityStatus: updated.identityStatus,
        rowHash: updated.rowHash,
        updatedAt: updated.updatedAt.toISOString(),
      },
      run: {
        id: runStatus.run.id,
        status: runStatus.run.status,
        unresolved: runStatus.unresolved,
        rejected: runStatus.rejected,
      },
      merge: {
        applied: merged.applied,
        snapshotId: merged.snapshotId,
        revisionId: merged.revisionId,
        reason: merged.reason,
      },
    };
  });
}

export async function listRankingReviewRows(args: {
  workspaceId: string;
  eventId?: string | null;
  rankingType?: string | null;
  status?: RankingIdentityStatus[];
  limit: number;
  offset: number;
}) {
  const statuses = args.status && args.status.length > 0
    ? args.status
    : [RankingIdentityStatus.UNRESOLVED];

  const where: Prisma.RankingRowWhereInput = {
    workspaceId: args.workspaceId,
    identityStatus: { in: statuses },
    run: {
      ...(args.eventId ? { eventId: args.eventId } : {}),
      ...(args.rankingType ? { rankingType: normalizeRankingType(args.rankingType) } : {}),
    },
  };

  const [rows, total] = await Promise.all([
    prisma.rankingRow.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: args.limit,
      skip: args.offset,
      include: {
        governor: {
          select: {
            id: true,
            governorId: true,
            name: true,
          },
        },
        run: {
          select: {
            id: true,
            eventId: true,
            rankingType: true,
            metricKey: true,
            status: true,
            headerText: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.rankingRow.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      sourceRank: row.sourceRank,
      governorNameRaw: row.governorNameRaw,
      governorNameNormalized: row.governorNameNormalized,
      governorId: row.governorId,
      governor: row.governor,
      allianceRaw: row.allianceRaw,
      titleRaw: row.titleRaw,
      metricRaw: row.metricRaw,
      metricValue: row.metricValue.toString(),
      confidence: row.confidence,
      identityStatus: row.identityStatus,
      ocrTrace: row.ocrTrace,
      candidates: row.candidates,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      run: {
        id: row.run.id,
        eventId: row.run.eventId,
        rankingType: row.run.rankingType,
        metricKey: row.run.metricKey,
        status: row.run.status,
        headerText: row.run.headerText,
        createdAt: row.run.createdAt.toISOString(),
      },
    })),
  };
}

export async function listCanonicalRankings(args: ListCanonicalRankingsInput) {
  const searchRaw = args.q?.trim() || null;
  const searchNormalized = searchRaw ? normalizeGovernorAlias(searchRaw) : null;
  const searchDigits = searchRaw ? searchRaw.replace(/[^0-9]/g, '') : '';

  const where: Prisma.RankingSnapshotWhereInput = {
    workspaceId: args.workspaceId,
    ...(args.eventId ? { eventId: args.eventId } : {}),
    ...(args.rankingType ? { rankingType: normalizeRankingType(args.rankingType) } : {}),
    ...(args.metricKey ? { metricKey: normalizeMetricKey(args.metricKey) } : {}),
    ...(args.status && args.status.length > 0 ? { status: { in: args.status } } : {}),
    ...(searchRaw
      ? {
          OR: [
            {
              governorNameRaw: {
                contains: searchRaw,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            ...(searchNormalized
              ? [
                  {
                    governorNameNormalized: {
                      contains: searchNormalized,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                ]
              : []),
            ...(searchDigits.length > 0
              ? [
                  {
                    governor: {
                      governorId: {
                        contains: searchDigits,
                      },
                    },
                  },
                ]
              : []),
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.rankingSnapshot.findMany({
      where,
      select: {
        id: true,
        workspaceId: true,
        eventId: true,
        rankingType: true,
        metricKey: true,
        identityKey: true,
        governorId: true,
        governorNameRaw: true,
        governorNameNormalized: true,
        sourceRank: true,
        metricValue: true,
        status: true,
        updatedAt: true,
        createdAt: true,
        lastRunId: true,
        lastRowId: true,
      },
      take: 5000,
    }),
    prisma.rankingSnapshot.count({ where }),
  ]);

  const sorted = [...rows].sort((a, b) =>
    compareRankingRows(
      {
        rowId: a.id,
        metricValue: a.metricValue,
        sourceRank: a.sourceRank,
        governorNameNormalized: a.governorNameNormalized,
      },
      {
        rowId: b.id,
        metricValue: b.metricValue,
        sourceRank: b.sourceRank,
        governorNameNormalized: b.governorNameNormalized,
      }
    )
  );

  const ranked = applyStableRanking(
    sorted.map((row) => ({
      rowId: row.id,
      sourceRank: row.sourceRank,
      governorNameNormalized: row.governorNameNormalized,
      metricValue: row.metricValue,
      row,
    }))
  );

  const decodedCursor = decodeRankingCursor(args.cursor || null);
  const startIndex = decodedCursor
    ? Math.max(
        0,
        ranked.findIndex((entry) => entry.item.row.id === decodedCursor.rowId) + 1
      )
    : 0;

  const page = ranked.slice(startIndex, startIndex + args.limit);
  const tieGroupCounts = page.reduce<Record<number, number>>((acc, entry) => {
    acc[entry.tieGroup] = (acc[entry.tieGroup] || 0) + 1;
    return acc;
  }, {});
  const nextCursor =
    page.length === args.limit && page.length > 0
      ? encodeRankingCursor({ rowId: page[page.length - 1].item.row.id })
      : null;

  const governorDbIds = [...new Set(page.map((entry) => entry.item.row.governorId).filter(Boolean))] as string[];
  const governors = governorDbIds.length > 0
    ? await prisma.governor.findMany({
        where: {
          id: {
            in: governorDbIds,
          },
        },
        select: {
          id: true,
          governorId: true,
          name: true,
        },
      })
    : [];
  const governorById = new Map(governors.map((governor) => [governor.id, governor]));

  return {
    total,
    nextCursor,
    rows: page.map((entry) => ({
      id: entry.item.row.id,
      workspaceId: entry.item.row.workspaceId,
      eventId: entry.item.row.eventId,
      rankingType: entry.item.row.rankingType,
      metricKey: entry.item.row.metricKey,
      identityKey: entry.item.row.identityKey,
      governorId: entry.item.row.governorId,
      governor: entry.item.row.governorId
        ? governorById.get(entry.item.row.governorId) || null
        : null,
      governorNameRaw: entry.item.row.governorNameRaw,
      governorNameNormalized: entry.item.row.governorNameNormalized,
      metricValue: entry.item.row.metricValue.toString(),
      sourceRank: entry.item.row.sourceRank,
      status: entry.item.row.status,
      stableIndex: entry.stableIndex,
      stableRank: entry.displayRank,
      tieGroup: entry.tieGroup,
      conflictFlags: {
        unresolved: entry.item.row.status === RankingSnapshotStatus.UNRESOLVED,
        rejected: entry.item.row.status === RankingSnapshotStatus.REJECTED,
        tie: (tieGroupCounts[entry.tieGroup] || 0) > 1,
      },
      updatedAt: entry.item.row.updatedAt.toISOString(),
      createdAt: entry.item.row.createdAt.toISOString(),
      lastRunId: entry.item.row.lastRunId,
      lastRowId: entry.item.row.lastRowId,
    })),
  };
}

export async function getRankingSummary(args: {
  workspaceId: string;
  eventId?: string | null;
  rankingType?: string | null;
  metricKey?: string | null;
  topN: number;
}) {
  const where: Prisma.RankingSnapshotWhereInput = {
    workspaceId: args.workspaceId,
    ...(args.eventId ? { eventId: args.eventId } : {}),
    ...(args.rankingType ? { rankingType: normalizeRankingType(args.rankingType) } : {}),
    ...(args.metricKey ? { metricKey: normalizeMetricKey(args.metricKey) } : {}),
  };

  const [statusCounts, typeCounts, topRows] = await Promise.all([
    prisma.rankingSnapshot.groupBy({
      by: ['status'],
      where,
      _count: {
        _all: true,
      },
    }),
    prisma.rankingSnapshot.groupBy({
      by: ['rankingType', 'metricKey'],
      where,
      _count: {
        _all: true,
      },
      _max: {
        updatedAt: true,
      },
      orderBy: {
        _count: {
          rankingType: 'desc',
        },
      },
      take: 25,
    }),
    prisma.rankingSnapshot.findMany({
      where,
      select: {
        id: true,
        rankingType: true,
        metricKey: true,
        governorId: true,
        governorNameRaw: true,
        metricValue: true,
        sourceRank: true,
        status: true,
        updatedAt: true,
        governorNameNormalized: true,
      },
      take: 3000,
    }),
  ]);

  const sortedTop = [...topRows].sort((a, b) =>
    compareRankingRows(
      {
        rowId: a.id,
        metricValue: a.metricValue,
        sourceRank: a.sourceRank,
        governorNameNormalized: a.governorNameNormalized,
      },
      {
        rowId: b.id,
        metricValue: b.metricValue,
        sourceRank: b.sourceRank,
        governorNameNormalized: b.governorNameNormalized,
      }
    )
  );

  const computeBucket = (limit: number) => {
    const bucket = sortedTop.slice(0, limit);
    const totalMetric = bucket.reduce((sum, row) => sum + row.metricValue, BigInt(0));
    const averageMetric =
      bucket.length > 0 ? totalMetric / BigInt(bucket.length) : BigInt(0);

    return {
      count: bucket.length,
      totalMetric: totalMetric.toString(),
      averageMetric: averageMetric.toString(),
    };
  };

  const distributionMap = new Map<
    string,
    {
      rankingType: string;
      metricKey: string;
      count: number;
      max: bigint;
      min: bigint;
      total: bigint;
    }
  >();

  for (const row of topRows) {
    const key = `${row.rankingType}::${row.metricKey}`;
    const existing = distributionMap.get(key);
    if (!existing) {
      distributionMap.set(key, {
        rankingType: row.rankingType,
        metricKey: row.metricKey,
        count: 1,
        max: row.metricValue,
        min: row.metricValue,
        total: row.metricValue,
      });
      continue;
    }

    existing.count += 1;
    if (row.metricValue > existing.max) existing.max = row.metricValue;
    if (row.metricValue < existing.min) existing.min = row.metricValue;
    existing.total += row.metricValue;
  }

  const topLimit = Math.max(1, Math.min(100, args.topN));
  const topSlice = sortedTop.slice(0, topLimit);
  const governorDbIds = [...new Set(topSlice.map((row) => row.governorId).filter(Boolean))] as string[];
  const governors = governorDbIds.length > 0
    ? await prisma.governor.findMany({
        where: {
          id: {
            in: governorDbIds,
          },
        },
        select: {
          id: true,
          governorId: true,
          name: true,
        },
      })
    : [];
  const governorById = new Map(governors.map((governor) => [governor.id, governor]));

  return {
    total: topRows.length,
    statusCounts: statusCounts.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = item._count._all;
      return acc;
    }, {}),
    rankingTypes: typeCounts.map((item) => ({
      rankingType: item.rankingType,
      metricKey: item.metricKey,
      total: item._count._all,
      latestAt: item._max.updatedAt?.toISOString() || null,
    })),
    topRows: topSlice.map((row) => ({
      id: row.id,
      rankingType: row.rankingType,
      metricKey: row.metricKey,
      governorId: row.governorId,
      governor: row.governorId ? governorById.get(row.governorId) || null : null,
      governorNameRaw: row.governorNameRaw,
      metricValue: row.metricValue.toString(),
      sourceRank: row.sourceRank,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    })),
    topBuckets: {
      top100: computeBucket(100),
      top200: computeBucket(200),
      top400: computeBucket(400),
    },
    metricDistributions: Array.from(distributionMap.values())
      .map((entry) => ({
        rankingType: entry.rankingType,
        metricKey: entry.metricKey,
        count: entry.count,
        min: entry.min.toString(),
        max: entry.max.toString(),
        average: (entry.total / BigInt(Math.max(1, entry.count))).toString(),
      }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function getRankingSnapshotRevisionHistory(args: {
  workspaceId: string;
  snapshotId: string;
  limit: number;
}) {
  const revisions = await prisma.rankingRevision.findMany({
    where: {
      workspaceId: args.workspaceId,
      snapshotId: args.snapshotId,
    },
    orderBy: { createdAt: 'desc' },
    take: args.limit,
  });

  return revisions.map((revision) => ({
    id: revision.id,
    action: revision.action,
    reason: revision.reason,
    previousData: revision.previousData,
    nextData: revision.nextData,
    runId: revision.runId,
    rowId: revision.rowId,
    changedByLinkId: revision.changedByLinkId,
    createdAt: revision.createdAt.toISOString(),
  }));
}

export async function getCanonicalRankingRow(args: {
  workspaceId: string;
  snapshotId: string;
}) {
  const snapshot = await prisma.rankingSnapshot.findFirst({
    where: {
      id: args.snapshotId,
      workspaceId: args.workspaceId,
    },
  });

  if (!snapshot) {
    throw new ApiHttpError('NOT_FOUND', 'Ranking snapshot not found.', 404);
  }

  return toSnapshotRecord(snapshot);
}

export async function archiveStaleRankingRuns(args: {
  workspaceId: string;
  olderThanDays?: number;
  limit?: number;
}) {
  const olderThanDays = Math.max(7, Math.min(365, args.olderThanDays ?? 45));
  const limit = Math.max(10, Math.min(1000, args.limit ?? 200));
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const staleRuns = await prisma.rankingRun.findMany({
    where: {
      workspaceId: args.workspaceId,
      status: {
        in: [RankingRunStatus.MERGED, RankingRunStatus.FAILED],
      },
      processedAt: {
        lt: cutoff,
      },
    },
    orderBy: { processedAt: 'asc' },
    take: limit,
    select: {
      id: true,
      metadata: true,
    },
  });

  if (staleRuns.length === 0) {
    return {
      scanned: 0,
      archivedRuns: 0,
      archivedRows: 0,
    };
  }

  let archivedRows = 0;
  for (const run of staleRuns) {
    const updatedRows = await prisma.rankingRow.updateMany({
      where: {
        runId: run.id,
      },
      data: {
        ocrTrace: Prisma.JsonNull,
        candidates: Prisma.JsonNull,
      },
    });

    const metadata =
      run.metadata && typeof run.metadata === 'object'
        ? (run.metadata as Record<string, unknown>)
        : {};

    await prisma.rankingRun.update({
      where: { id: run.id },
      data: {
        metadata: {
          ...metadata,
          archivedRawRowsAt: new Date().toISOString(),
          archivedRawRowsOlderThanDays: olderThanDays,
        } as Prisma.InputJsonValue,
      },
    });

    archivedRows += updatedRows.count;
  }

  return {
    scanned: staleRuns.length,
    archivedRuns: staleRuns.length,
    archivedRows,
  };
}
