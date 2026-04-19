import {
  AnomalySeverity,
  EventType,
  MetricObservationSourceType,
  Prisma,
  WorkspaceRole,
  type AccessLink,
} from '@prisma/client';
import { ApiHttpError } from '@/lib/api-response';
import { normalizeGovernorAlias } from '@/lib/rankings/normalize';
import { ensureWeeklyEventForWorkspace } from '@/lib/weekly-events';
import {
  METRIC_KEY_KILL_POINTS,
  METRIC_KEY_POWER,
  recordMetricObservationTx,
  upsertProfileSnapshotForEventTx,
} from '@/lib/metric-sync';
import { detectSnapshotPayloadAnomalies } from '@/lib/anomalies';

export type WorkspaceEditorRole = 'EDITOR' | 'OWNER';

export interface RegisterGovernorInput {
  workspaceId: string;
  governorId: string;
  name: string;
  alliance?: string;
}

export interface UpdateGovernorInput {
  workspaceId: string;
  governorDbId: string;
  name?: string;
  alliance?: string;
  governorId?: string;
}

export interface DeleteGovernorInput {
  workspaceId: string;
  governorDbId: string;
}

export interface CreateEventInput {
  workspaceId: string;
  name: string;
  description?: string | null;
  eventType?: EventType;
}

export interface DeleteEventInput {
  workspaceId: string;
  eventId: string;
}

export interface ProfileStatsInput {
  workspaceId: string;
  governorDbId: string;
  governorName: string;
  eventId?: string | null;
  power: bigint;
  killPoints: bigint;
  t4Kills: bigint;
  t5Kills: bigint;
  deads: bigint;
  confidencePct?: number;
  reason?: string;
  changedByLinkId?: string | null;
}

export interface ResolvedGovernorForStats {
  governorDbId: string;
  governorGameId: string;
  governorName: string;
}

function assertString(value: string, label: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new ApiHttpError('VALIDATION_ERROR', `${label} is required.`, 400);
  }
  return trimmed;
}

function sanitizeGovernorName(value: string): string {
  return String(value || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function sanitizeAlliance(value?: string | null): string {
  return String(value || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function sanitizePrintable(value: unknown, maxLen = 120): string {
  return String(value ?? '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function parseMetricBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.max(0, Math.floor(value)));
  }

  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (!digits) {
    throw new ApiHttpError('VALIDATION_ERROR', `${fieldName} must be a numeric value.`, 400);
  }
  return BigInt(digits);
}

async function upsertGovernorAliasTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    governorDbId: string;
    rawName: string;
    source: string;
  }
): Promise<void> {
  const aliasRaw = sanitizeGovernorName(args.rawName);
  const aliasNormalized = normalizeGovernorAlias(aliasRaw);
  if (!aliasRaw || !aliasNormalized || aliasNormalized === 'unknown') return;

  await tx.governorAlias.upsert({
    where: {
      workspaceId_aliasNormalized: {
        workspaceId: args.workspaceId,
        aliasNormalized,
      },
    },
    create: {
      workspaceId: args.workspaceId,
      governorId: args.governorDbId,
      aliasRaw,
      aliasNormalized,
      confidence: 1,
      source: args.source,
    },
    update: {
      governorId: args.governorDbId,
      aliasRaw,
      confidence: 1,
      source: args.source,
    },
  });
}

export async function registerGovernorTx(
  tx: Prisma.TransactionClient,
  input: RegisterGovernorInput
): Promise<{ governor: { id: string; governorId: string; name: string; alliance: string; workspaceId: string | null }; created: boolean }> {
  const workspaceId = assertString(input.workspaceId, 'workspaceId');
  const governorId = assertString(input.governorId, 'governorId');
  const name = sanitizeGovernorName(assertString(input.name, 'name'));
  const alliance = sanitizeAlliance(input.alliance);

  const existing = await tx.governor.findUnique({
    where: { governorId },
    select: {
      id: true,
      governorId: true,
      name: true,
      alliance: true,
      workspaceId: true,
    },
  });

  if (existing && existing.workspaceId && existing.workspaceId !== workspaceId) {
    throw new ApiHttpError(
      'CONFLICT',
      `Governor ${governorId} is already registered in another workspace.`,
      409
    );
  }

  const governor = existing
    ? await tx.governor.update({
        where: { id: existing.id },
        data: {
          name,
          alliance,
          workspaceId,
        },
        select: {
          id: true,
          governorId: true,
          name: true,
          alliance: true,
          workspaceId: true,
        },
      })
    : await tx.governor.create({
        data: {
          governorId,
          name,
          alliance,
          workspaceId,
        },
        select: {
          id: true,
          governorId: true,
          name: true,
          alliance: true,
          workspaceId: true,
        },
      });

  await upsertGovernorAliasTx(tx, {
    workspaceId,
    governorDbId: governor.id,
    rawName: governor.name,
    source: existing ? 'registration_update' : 'registration',
  });

  return {
    governor,
    created: !existing,
  };
}

export async function updateGovernorTx(
  tx: Prisma.TransactionClient,
  input: UpdateGovernorInput
): Promise<{ id: string; governorId: string; name: string; alliance: string; workspaceId: string | null }> {
  const workspaceId = assertString(input.workspaceId, 'workspaceId');
  const governorDbId = assertString(input.governorDbId, 'governorDbId');

  const existing = await tx.governor.findUnique({
    where: { id: governorDbId },
    select: {
      id: true,
      governorId: true,
      name: true,
      alliance: true,
      workspaceId: true,
    },
  });

  if (!existing) {
    throw new ApiHttpError('NOT_FOUND', 'Governor not found.', 404);
  }
  if (existing.workspaceId !== workspaceId) {
    throw new ApiHttpError('NOT_FOUND', 'Governor not found in this workspace.', 404);
  }

  const patch: Prisma.GovernorUpdateInput = {};
  if (input.name != null) {
    const nextName = sanitizeGovernorName(input.name);
    if (!nextName) {
      throw new ApiHttpError('VALIDATION_ERROR', 'name cannot be empty.', 400);
    }
    patch.name = nextName;
  }
  if (input.alliance != null) {
    patch.alliance = sanitizeAlliance(input.alliance);
  }
  if (input.governorId != null) {
    const nextGameId = assertString(input.governorId, 'governorId');
    const conflict = await tx.governor.findFirst({
      where: {
        governorId: nextGameId,
        id: { not: governorDbId },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ApiHttpError('CONFLICT', 'Another governor with this ID already exists.', 409);
    }
    patch.governorId = nextGameId;
  }

  if (Object.keys(patch).length === 0) {
    throw new ApiHttpError('VALIDATION_ERROR', 'No fields to update.', 400);
  }

  const updated = await tx.governor.update({
    where: { id: governorDbId },
    data: patch,
    select: {
      id: true,
      governorId: true,
      name: true,
      alliance: true,
      workspaceId: true,
    },
  });

  if (patch.name && updated.workspaceId === workspaceId) {
    await upsertGovernorAliasTx(tx, {
      workspaceId,
      governorDbId: updated.id,
      rawName: updated.name,
      source: 'manual_edit',
    });
  }

  return updated;
}

export async function deleteGovernorTx(
  tx: Prisma.TransactionClient,
  input: DeleteGovernorInput
): Promise<{ id: string; deleted: true }> {
  const workspaceId = assertString(input.workspaceId, 'workspaceId');
  const governorDbId = assertString(input.governorDbId, 'governorDbId');

  const governor = await tx.governor.findUnique({
    where: { id: governorDbId },
    select: {
      id: true,
      workspaceId: true,
    },
  });

  if (!governor) {
    throw new ApiHttpError('NOT_FOUND', 'Governor not found.', 404);
  }
  if (governor.workspaceId !== workspaceId) {
    throw new ApiHttpError('NOT_FOUND', 'Governor not found in this workspace.', 404);
  }

  await tx.governor.update({
    where: { id: governorDbId },
    data: {
      workspaceId: null,
    },
  });

  await tx.governorAlias.deleteMany({
    where: {
      workspaceId,
      governorId: governorDbId,
    },
  });

  return { id: governorDbId, deleted: true };
}

export async function createEventTx(
  tx: Prisma.TransactionClient,
  input: CreateEventInput
): Promise<{
  id: string;
  workspaceId: string | null;
  name: string;
  description: string | null;
  eventType: EventType;
  weekKey: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isAutoGenerated: boolean;
  isClosed: boolean;
  createdAt: Date;
}> {
  const workspaceId = assertString(input.workspaceId, 'workspaceId');
  const name = sanitizeGovernorName(assertString(input.name, 'name')).slice(0, 120);

  const created = await tx.event.create({
    data: {
      workspaceId,
      name,
      description: input.description ? sanitizePrintable(input.description, 500) : null,
      eventType: input.eventType || EventType.CUSTOM,
    },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      description: true,
      eventType: true,
      weekKey: true,
      startsAt: true,
      endsAt: true,
      isAutoGenerated: true,
      isClosed: true,
      createdAt: true,
    },
  });

  return created;
}

export async function deleteEventTx(
  tx: Prisma.TransactionClient,
  input: DeleteEventInput
): Promise<{ id: string; deleted: true }> {
  const workspaceId = assertString(input.workspaceId, 'workspaceId');
  const eventId = assertString(input.eventId, 'eventId');

  const event = await tx.event.findFirst({
    where: {
      id: eventId,
      workspaceId,
    },
    select: { id: true },
  });

  if (!event) {
    throw new ApiHttpError('NOT_FOUND', 'Event not found in this workspace.', 404);
  }

  await tx.event.delete({
    where: { id: event.id },
  });

  return { id: event.id, deleted: true };
}

export async function resolveGovernorForStatsTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    governorGameId?: string | null;
    governorName?: string | null;
  }
): Promise<
  | { status: 'resolved'; governor: ResolvedGovernorForStats }
  | { status: 'missing'; reason: string; candidates: ResolvedGovernorForStats[] }
  | { status: 'ambiguous'; reason: string; candidates: ResolvedGovernorForStats[] }
> {
  const workspaceId = assertString(args.workspaceId, 'workspaceId');
  const governorGameId = String(args.governorGameId || '').trim();
  const governorName = sanitizeGovernorName(String(args.governorName || ''));

  if (governorGameId) {
    const byId = await tx.governor.findFirst({
      where: {
        workspaceId,
        governorId: governorGameId,
      },
      select: {
        id: true,
        governorId: true,
        name: true,
      },
    });

    if (!byId) {
      return {
        status: 'missing',
        reason: 'No registered governor found for governorId.',
        candidates: [],
      };
    }

    return {
      status: 'resolved',
      governor: {
        governorDbId: byId.id,
        governorGameId: byId.governorId,
        governorName: byId.name,
      },
    };
  }

  const normalizedName = normalizeGovernorAlias(governorName);
  if (!normalizedName || normalizedName === 'unknown') {
    return {
      status: 'missing',
      reason: 'Governor ID is missing and governor name could not be normalized.',
      candidates: [],
    };
  }

  const aliasHits = await tx.governorAlias.findMany({
    where: {
      workspaceId,
      aliasNormalized: normalizedName,
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
    take: 20,
  });

  const directNameHits = await tx.governor.findMany({
    where: {
      workspaceId,
      name: {
        equals: governorName,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      governorId: true,
      name: true,
    },
    take: 20,
  });

  const merged = new Map<string, ResolvedGovernorForStats>();
  for (const row of aliasHits) {
    merged.set(row.governor.id, {
      governorDbId: row.governor.id,
      governorGameId: row.governor.governorId,
      governorName: row.governor.name,
    });
  }
  for (const row of directNameHits) {
    merged.set(row.id, {
      governorDbId: row.id,
      governorGameId: row.governorId,
      governorName: row.name,
    });
  }

  const candidates = [...merged.values()];

  if (candidates.length === 0) {
    return {
      status: 'missing',
      reason: 'No registered governor matched the provided name.',
      candidates,
    };
  }

  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      reason: 'Multiple governors matched the provided name.',
      candidates,
    };
  }

  return {
    status: 'resolved',
    governor: candidates[0],
  };
}

export async function writeProfileStatsTx(
  tx: Prisma.TransactionClient,
  input: ProfileStatsInput
): Promise<{ eventId: string; snapshotId: string; anomalyCount: number }> {
  const workspaceId = assertString(input.workspaceId, 'workspaceId');

  const eventId = input.eventId
    ? assertString(input.eventId, 'eventId')
    : (
        await ensureWeeklyEventForWorkspace(workspaceId, {
          tx,
        })
      ).event.id;

  const confidencePct = Number.isFinite(input.confidencePct ?? NaN)
    ? Math.max(0, Math.min(100, Number(input.confidencePct)))
    : 100;

  const { snapshot } = await upsertProfileSnapshotForEventTx(tx, {
    workspaceId,
    eventId,
    governorId: input.governorDbId,
    power: input.power,
    killPoints: input.killPoints,
    t4Kills: input.t4Kills,
    t5Kills: input.t5Kills,
    deads: input.deads,
    confidencePct,
    changedByLinkId: input.changedByLinkId || null,
    reason: input.reason || 'Assistant profile stats write',
  });

  const anomalies = detectSnapshotPayloadAnomalies({
    power: input.power,
    killPoints: input.killPoints,
    t4Kills: input.t4Kills,
    t5Kills: input.t5Kills,
    deads: input.deads,
  });

  if (anomalies.length > 0) {
    await tx.anomaly.createMany({
      data: anomalies.map((anomaly) => ({
        workspaceId,
        snapshotId: snapshot.id,
        governorId: input.governorDbId,
        eventAId: eventId,
        code: anomaly.code,
        type: anomaly.type,
        message: anomaly.message,
        severity:
          anomaly.severity === 'ERROR'
            ? AnomalySeverity.ERROR
            : anomaly.severity === 'INFO'
              ? AnomalySeverity.INFO
              : AnomalySeverity.WARNING,
        context: (anomaly.context || {}) as Prisma.InputJsonValue,
      })),
    });
  }

  await recordMetricObservationTx(tx, {
    workspaceId,
    eventId,
    governorId: input.governorDbId,
    metricKey: METRIC_KEY_POWER,
    metricValue: input.power,
    sourceType: MetricObservationSourceType.PROFILE,
    sourceRank: null,
    sourceRefId: `assistant:snapshot:${snapshot.id}:power`,
    observedAt: new Date(),
    changedByLinkId: input.changedByLinkId || null,
    reason: input.reason || 'Assistant profile stats write (power)',
    governorNameRaw: input.governorName,
  });

  await recordMetricObservationTx(tx, {
    workspaceId,
    eventId,
    governorId: input.governorDbId,
    metricKey: METRIC_KEY_KILL_POINTS,
    metricValue: input.killPoints,
    sourceType: MetricObservationSourceType.PROFILE,
    sourceRank: null,
    sourceRefId: `assistant:snapshot:${snapshot.id}:kill_points`,
    observedAt: new Date(),
    changedByLinkId: input.changedByLinkId || null,
    reason: input.reason || 'Assistant profile stats write (kill points)',
    governorNameRaw: input.governorName,
  });

  return {
    eventId,
    snapshotId: snapshot.id,
    anomalyCount: anomalies.length,
  };
}

export function requireRoleForAction(args: {
  actionType:
    | 'register_player'
    | 'update_player'
    | 'delete_player'
    | 'create_event'
    | 'delete_event'
    | 'record_profile_stats';
}): WorkspaceRole {
  switch (args.actionType) {
    case 'delete_player':
      return WorkspaceRole.OWNER;
    case 'register_player':
    case 'update_player':
    case 'create_event':
    case 'delete_event':
    case 'record_profile_stats':
      return WorkspaceRole.EDITOR;
    default:
      return WorkspaceRole.EDITOR;
  }
}

export function toAccessLinkSummary(link: AccessLink) {
  return {
    id: link.id,
    role: link.role,
    workspaceId: link.workspaceId,
  };
}
