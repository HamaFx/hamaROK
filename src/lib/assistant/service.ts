import crypto from 'node:crypto';
import {
  AssistantActionStatus,
  AssistantConversationStatus,
  AssistantMessageRole,
  AssistantPendingIdentityStatus,
  AssistantPlanStatus,
  EventType,
  IngestionTaskStatus,
  OcrExtractionStatus,
  Prisma,
  RankingIdentityStatus,
  RankingRunStatus,
  ScanJobStatus,
  WorkspaceRole,
  type AccessLink,
  type AssistantAction,
  type AssistantPendingIdentity,
} from '@prisma/client';
import { ApiHttpError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import {
  appendMistralConversation,
  extractConversationTextOutputs,
  extractFunctionCalls,
  runMistralOcr,
  runMistralStructuredOutput,
  startMistralConversation,
  type MistralTool,
  type MistralConversationResponse,
} from '@/lib/mistral/client';
import { runMistralIngestionExtraction } from '@/lib/ocr/mistral-extraction';
import {
  createEventTx,
  deleteEventTx,
  deleteGovernorTx,
  parseMetricBigInt,
  registerGovernorTx,
  requireRoleForAction,
  resolveGovernorForStatsTx,
  updateGovernorTx,
  writeProfileStatsTx,
} from '@/lib/domain/workspace-actions';
import { buildWorkspaceAnalytics } from '@/lib/analytics';
import { compareWorkspaceEvents } from '@/lib/compare-service';
import { getWeeklyActivityReport } from '@/lib/activity/service';
import { resolveGovernorBySimilarityTx } from '@/lib/governor-similarity';
import {
  getRankingRunById,
  listRankingReviewRows,
  listRankingRuns,
} from '@/lib/rankings/service';
import {
  assistantReadActionSchema,
  assistantActionOutputJsonSchema,
  assistantActionSchema,
  assistantPlanOutputSchema,
  mapActionTypeToPrisma,
  type AssistantActionInput,
  type AssistantReadActionInput,
  type AssistantPlanOutput,
  type RecordProfileStatsActionInput,
} from '@/lib/assistant/types';

const roleRank: Record<WorkspaceRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
};

const OCR_MODEL_DEFAULT = 'mistral-ocr-latest';
const ASSISTANT_MODEL_DEFAULT = 'mistral-large-latest';
const MAX_READ_ACTIONS_PER_TURN = 20;
const MAX_READ_ROWS = 60;
const MAX_READ_TOOL_LOOPS = 4;
const MAX_EVIDENCE_IMAGES = 6;
const ATTACHMENT_EXTRACTION_CONCURRENCY = 2;
const ASSISTANT_BATCH_SAFE_ACTIONS = new Set([
  'register_player',
  'update_player',
  'record_profile_stats',
]);
const ASSISTANT_BATCH_DEFAULT_PROMPT =
  'Analyze this screenshot. Register missing players and prepare updates for existing players. Keep write actions precise and limited to evidence.';
const ASSISTANT_ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export function evaluateAssistantBatchAutoConfirm(actions: Array<{ type?: unknown }>) {
  const actionTypes = actions
    .map((action) => String(action?.type || '').trim())
    .filter(Boolean);
  const unsafeActionTypes = actionTypes.filter(
    (actionType) => !ASSISTANT_BATCH_SAFE_ACTIONS.has(actionType)
  );
  return {
    actionTypes,
    unsafeActionTypes,
    safe: unsafeActionTypes.length === 0,
  };
}

function sanitizePrintable(value: unknown, max = 3000): string {
  return String(value ?? '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeDigits(value: unknown, max = 18): string {
  return String(value ?? '')
    .replace(/[^0-9]/g, '')
    .slice(0, max);
}

function toDataUrl(base64: string, mimeType: string): string {
  const normalized = String(base64 || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');
  return `data:${mimeType || 'image/png'};base64,${normalized}`;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function requireRole(link: AccessLink, requiredRole: WorkspaceRole) {
  if (roleRank[link.role] < roleRank[requiredRole]) {
    throw new ApiHttpError('FORBIDDEN', `Requires ${requiredRole} access.`, 403);
  }
}

function normalizeEventName(value: unknown): string {
  return sanitizePrintable(value, 120);
}

function normalizeGovernorName(value: unknown): string {
  return sanitizePrintable(value, 80);
}

async function readAssistantSettings(workspaceId: string) {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { workspaceId },
    select: {
      assistantEnabled: true,
      assistantModel: true,
      ocrModel: true,
      assistantLogRetentionDays: true,
    },
  });

  if (settings && !settings.assistantEnabled) {
    throw new ApiHttpError('FORBIDDEN', 'Assistant is disabled for this workspace.', 403);
  }

  return {
    assistantModel: settings?.assistantModel || ASSISTANT_MODEL_DEFAULT,
    ocrModel: settings?.ocrModel || OCR_MODEL_DEFAULT,
    retentionDays:
      Number.isFinite(settings?.assistantLogRetentionDays) &&
      Number(settings?.assistantLogRetentionDays) > 0
        ? Number(settings?.assistantLogRetentionDays)
        : 180,
  };
}

function clampLimit(value: unknown, fallback: number, max = MAX_READ_ROWS): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function clampOffset(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(20_000, Math.floor(parsed)));
}

function safeJsonText(value: unknown, max = 8_000): string {
  try {
    return sanitizePrintable(JSON.stringify(value), max);
  } catch {
    return '[unserializable]';
  }
}

function mistralReadTools(): MistralTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'read_workspace_overview',
        description: 'Read high-level workspace counts and queue status.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            includeWeekly: { type: ['boolean', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_governors',
        description: 'Search or list governors in workspace.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            search: { type: ['string', 'null'] },
            includeWeekly: { type: ['boolean', 'null'] },
            limit: { type: ['integer', 'null'] },
            offset: { type: ['integer', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_governor_detail',
        description: 'Fetch a specific governor details and latest activity by governorDbId or governorId.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            governorDbId: { type: ['string', 'null'] },
            governorId: { type: ['string', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_events',
        description: 'List workspace events.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            search: { type: ['string', 'null'] },
            includeClosed: { type: ['boolean', 'null'] },
            limit: { type: ['integer', 'null'] },
            offset: { type: ['integer', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_event_detail',
        description: 'Fetch details for a specific event by eventId or eventName.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            eventId: { type: ['string', 'null'] },
            eventName: { type: ['string', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_scan_jobs',
        description: 'List upload scan jobs and statuses.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: ['string', 'null'] },
            limit: { type: ['integer', 'null'] },
            offset: { type: ['integer', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_scan_job_tasks',
        description: 'Inspect ingestion task rows for one scan job.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['scanJobId'],
          properties: {
            scanJobId: { type: 'string' },
            status: { type: ['string', 'null'] },
            limit: { type: ['integer', 'null'] },
            offset: { type: ['integer', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_profile_review_queue',
        description: 'Read OCR profile review queue items and severity counts.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: ['string', 'null'] },
            severity: { type: ['string', 'null'] },
            limit: { type: ['integer', 'null'] },
            offset: { type: ['integer', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_ranking_review_queue',
        description: 'Read ranking review queue rows grouped by ranking run.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: ['string', 'null'] },
            rankingType: { type: ['string', 'null'] },
            metricKey: { type: ['string', 'null'] },
            limit: { type: ['integer', 'null'] },
            offset: { type: ['integer', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_ranking_runs',
        description: 'List ranking runs by filters.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            eventId: { type: ['string', 'null'] },
            rankingType: { type: ['string', 'null'] },
            status: { type: ['string', 'null'] },
            limit: { type: ['integer', 'null'] },
            offset: { type: ['integer', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_ranking_run_detail',
        description: 'Fetch one ranking run detail by runId.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['runId'],
          properties: {
            runId: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_activity_weekly',
        description: 'Read weekly activity standings and metrics.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            weekKey: { type: ['string', 'null'] },
            alliances: {
              type: ['array', 'null'],
              items: { type: 'string' },
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_analytics',
        description: 'Read workspace analytics for event comparisons.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            eventA: { type: ['string', 'null'] },
            eventB: { type: ['string', 'null'] },
            topN: { type: ['integer', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_compare',
        description: 'Compare two events in the workspace.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['eventA', 'eventB'],
          properties: {
            eventA: { type: 'string' },
            eventB: { type: 'string' },
            topN: { type: ['integer', 'null'] },
          },
        },
      },
    },
  ];
}

function mistralActionTools(): MistralTool[] {
  return [
    ...mistralReadTools(),
    {
      type: 'function',
      function: {
        name: 'register_player',
        description: 'Register a new player/governor in the current workspace.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['governorId', 'name'],
          properties: {
            governorId: { type: 'string' },
            name: { type: 'string' },
            alliance: { type: ['string', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_player',
        description: 'Update player name/alliance/governor ID.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            governorDbId: { type: ['string', 'null'] },
            governorId: { type: ['string', 'null'] },
            governorName: { type: ['string', 'null'] },
            name: { type: ['string', 'null'] },
            alliance: { type: ['string', 'null'] },
            newGovernorId: { type: ['string', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_player',
        description: 'Delete a player from workspace ownership context.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            governorDbId: { type: ['string', 'null'] },
            governorId: { type: ['string', 'null'] },
            governorName: { type: ['string', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_event',
        description: 'Create an event in workspace.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: { type: 'string' },
            description: { type: ['string', 'null'] },
            eventType: {
              type: 'string',
              enum: ['KVK_START', 'KVK_END', 'MGE', 'OSIRIS', 'WEEKLY', 'CUSTOM'],
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_event',
        description: 'Delete an event in workspace.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            eventId: { type: ['string', 'null'] },
            eventName: { type: ['string', 'null'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'record_profile_stats',
        description:
          'Record profile stats (power, kill points, t4, t5, deads) for an existing player.',
        strict: false,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['power', 'killPoints', 'deads'],
          properties: {
            governorDbId: { type: ['string', 'null'] },
            governorId: { type: ['string', 'null'] },
            governorName: { type: ['string', 'null'] },
            eventId: { type: ['string', 'null'] },
            eventName: { type: ['string', 'null'] },
            power: { type: ['string', 'number', 'integer'] },
            killPoints: { type: ['string', 'number', 'integer'] },
            t4Kills: { type: ['string', 'number', 'integer', 'null'] },
            t5Kills: { type: ['string', 'number', 'integer', 'null'] },
            deads: { type: ['string', 'number', 'integer'] },
            confidencePct: { type: ['number', 'null'] },
          },
        },
      },
    },
  ];
}

function tryParseActionFromCall(name: string, args: Record<string, unknown> | string): AssistantActionInput | null {
  const normalizedName = String(name || '').trim();
  const payload = typeof args === 'string' ? { raw: args } : args;

  const parsed = assistantActionSchema.safeParse({
    ...payload,
    type: normalizedName,
  });

  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

function tryParseReadActionFromCall(
  name: string,
  args: Record<string, unknown> | string
): AssistantReadActionInput | null {
  const normalizedName = String(name || '').trim();
  const payload = typeof args === 'string' ? { raw: args } : args;

  const parsed = assistantReadActionSchema.safeParse({
    ...payload,
    type: normalizedName,
  });

  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

function normalizePlannedActions(actions: unknown[]): AssistantActionInput[] {
  const normalized: AssistantActionInput[] = [];
  for (const candidate of actions) {
    const parsed = assistantActionSchema.safeParse(candidate);
    if (parsed.success) {
      normalized.push(parsed.data);
    }
  }
  return normalized;
}

function normalizeReadActions(actions: unknown[]): AssistantReadActionInput[] {
  const normalized: AssistantReadActionInput[] = [];
  for (const candidate of actions) {
    const parsed = assistantReadActionSchema.safeParse(candidate);
    if (parsed.success) {
      normalized.push(parsed.data);
    }
  }
  return normalized;
}

export interface AssistantAttachmentInput {
  artifactId: string | null;
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  base64: string;
}

export interface CreateAssistantConversationInput {
  workspaceId: string;
  accessLink: AccessLink;
  title?: string | null;
}

export async function createAssistantConversation(input: CreateAssistantConversationInput) {
  const workspaceId = String(input.workspaceId || '').trim();
  if (!workspaceId) {
    throw new ApiHttpError('VALIDATION_ERROR', 'workspaceId is required.', 400);
  }
  if (input.accessLink.workspaceId !== workspaceId) {
    throw new ApiHttpError('FORBIDDEN', 'Access link is not valid for this workspace.', 403);
  }

  await readAssistantSettings(workspaceId);

  const created = await prisma.assistantConversation.create({
    data: {
      workspaceId,
      accessLinkId: input.accessLink.id,
      title: sanitizePrintable(input.title || '', 120) || null,
      status: AssistantConversationStatus.ACTIVE,
    },
  });

  return {
    id: created.id,
    workspaceId: created.workspaceId,
    title: created.title,
    status: created.status,
    model: created.model,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

export async function listAssistantConversations(args: {
  workspaceId: string;
  accessLink: AccessLink;
}) {
  const workspaceId = String(args.workspaceId || '').trim();
  if (!workspaceId) {
    throw new ApiHttpError('VALIDATION_ERROR', 'workspaceId is required.', 400);
  }
  if (args.accessLink.workspaceId !== workspaceId) {
    throw new ApiHttpError('FORBIDDEN', 'Access link is not valid for this workspace.', 403);
  }

  await readAssistantSettings(workspaceId);

  const rows = await prisma.assistantConversation.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: 'desc' },
    take: 120,
    include: {
      _count: {
        select: {
          messages: true,
          plans: true,
          pendingIdentities: true,
        },
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    status: row.status,
    model: row.model,
    mistralConversationId: row.mistralConversationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    counts: row._count,
    lastMessage: row.messages[0]
      ? {
          id: row.messages[0].id,
          role: row.messages[0].role,
          content: row.messages[0].content,
          createdAt: row.messages[0].createdAt.toISOString(),
        }
      : null,
  }));
}

export interface CleanupAssistantWorkspaceInput {
  workspaceId: string;
  accessLink: AccessLink;
  mode: 'archive' | 'purge';
  requirePurgeConfirmation?: boolean;
  includePendingIdentities?: boolean;
}

export async function cleanupAssistantWorkspace(input: CleanupAssistantWorkspaceInput) {
  const workspaceId = String(input.workspaceId || '').trim();
  if (!workspaceId) {
    throw new ApiHttpError('VALIDATION_ERROR', 'workspaceId is required.', 400);
  }
  if (input.accessLink.workspaceId !== workspaceId) {
    throw new ApiHttpError('FORBIDDEN', 'Access link is not valid for this workspace.', 403);
  }
  requireRole(input.accessLink, WorkspaceRole.OWNER);

  const mode = input.mode;
  const includePendingIdentities = input.includePendingIdentities !== false;

  if (mode === 'archive') {
    const now = new Date();
    const [totalConversations, archivedResult] = await Promise.all([
      prisma.assistantConversation.count({
        where: { workspaceId },
      }),
      prisma.assistantConversation.updateMany({
        where: {
          workspaceId,
          status: { not: AssistantConversationStatus.ARCHIVED },
        },
        data: {
          status: AssistantConversationStatus.ARCHIVED,
          archivedAt: now,
          updatedAt: now,
        },
      }),
    ]);

    return {
      workspaceId,
      mode,
      totalConversations,
      archivedConversations: archivedResult.count,
      deletedConversations: 0,
      deletedMessages: 0,
      deletedPlans: 0,
      deletedActions: 0,
      deletedPendingIdentities: 0,
    };
  }

  if (input.requirePurgeConfirmation) {
    throw new ApiHttpError(
      'VALIDATION_ERROR',
      'Destructive cleanup requires explicit confirmation.',
      400
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const totalConversations = await tx.assistantConversation.count({
      where: { workspaceId },
    });

    const actionsResult = await tx.assistantAction.deleteMany({
      where: { workspaceId },
    });
    const plansResult = await tx.assistantPlan.deleteMany({
      where: { workspaceId },
    });
    const messagesResult = await tx.assistantMessage.deleteMany({
      where: { workspaceId },
    });
    const pendingResult = includePendingIdentities
      ? await tx.assistantPendingIdentity.deleteMany({
          where: { workspaceId },
        })
      : { count: 0 };
    const conversationsResult = await tx.assistantConversation.deleteMany({
      where: { workspaceId },
    });

    return {
      workspaceId,
      mode,
      totalConversations,
      archivedConversations: 0,
      deletedConversations: conversationsResult.count,
      deletedMessages: messagesResult.count,
      deletedPlans: plansResult.count,
      deletedActions: actionsResult.count,
      deletedPendingIdentities: pendingResult.count,
    };
  });

  return result;
}

type AssistantBatchStatus = 'RUNNING' | 'COMPLETED';

interface AssistantBatchFlag {
  artifactId: string;
  fileName: string;
  reason:
    | 'non_safe_actions'
    | 'pending_identity'
    | 'action_failed'
    | 'no_high_confidence_identity'
    | 'unexpected_error';
  planId?: string | null;
  actionTypes?: string[];
  details?: string | null;
  createdAt: string;
}

interface AssistantBatchState {
  version: 1;
  scanJobId: string;
  status: AssistantBatchStatus;
  totalArtifacts: number;
  processedArtifactIds: string[];
  flagged: AssistantBatchFlag[];
  autoConfirmedCount: number;
  pendingManualCount: number;
  lastProcessedArtifactId: string | null;
  lastProcessedFileName: string | null;
  createdAt: string;
  updatedAt: string;
  prompt: string;
}

type BatchArtifactRow = {
  artifactId: string;
  fileName: string;
  artifactUrl: string;
  mimeType: string;
  bytes: number;
};

function parseAssistantBatchState(value: unknown): AssistantBatchState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Number(row.version) !== 1) return null;
  const scanJobId = String(row.scanJobId || '').trim();
  if (!scanJobId) return null;

  const processedArtifactIds = Array.isArray(row.processedArtifactIds)
    ? row.processedArtifactIds
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    : [];

  const flagged = Array.isArray(row.flagged)
    ? row.flagged
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
        .map((entry) => ({
          artifactId: String(entry.artifactId || '').trim(),
          fileName: String(entry.fileName || '').trim() || 'artifact',
          reason: String(entry.reason || '').trim() as AssistantBatchFlag['reason'],
          planId: entry.planId == null ? null : String(entry.planId || '').trim() || null,
          actionTypes: Array.isArray(entry.actionTypes)
            ? entry.actionTypes.map((value) => String(value || '').trim()).filter(Boolean)
            : [],
          details: entry.details == null ? null : sanitizePrintable(entry.details, 280),
          createdAt: String(entry.createdAt || '').trim() || new Date().toISOString(),
        }))
        .filter((entry) => entry.artifactId && entry.reason)
    : [];

  return {
    version: 1,
    scanJobId,
    status: row.status === 'COMPLETED' ? 'COMPLETED' : 'RUNNING',
    totalArtifacts: Math.max(0, Number(row.totalArtifacts || 0)),
    processedArtifactIds,
    flagged,
    autoConfirmedCount: Math.max(0, Number(row.autoConfirmedCount || 0)),
    pendingManualCount: Math.max(0, Number(row.pendingManualCount || 0)),
    lastProcessedArtifactId:
      row.lastProcessedArtifactId == null
        ? null
        : String(row.lastProcessedArtifactId || '').trim() || null,
    lastProcessedFileName:
      row.lastProcessedFileName == null
        ? null
        : String(row.lastProcessedFileName || '').trim() || null,
    createdAt: String(row.createdAt || '').trim() || new Date().toISOString(),
    updatedAt: String(row.updatedAt || '').trim() || new Date().toISOString(),
    prompt: sanitizePrintable(row.prompt || ASSISTANT_BATCH_DEFAULT_PROMPT, 2000) || ASSISTANT_BATCH_DEFAULT_PROMPT,
  };
}

function normalizeMimeType(value: unknown): string {
  const mimeType = String(value || '').toLowerCase().trim();
  if (ASSISTANT_ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    return mimeType;
  }
  return 'image/png';
}

async function listBatchArtifactsForScanJob(args: {
  workspaceId: string;
  scanJobId: string;
}): Promise<BatchArtifactRow[]> {
  const tasks = await prisma.ingestionTask.findMany({
    where: {
      workspaceId: args.workspaceId,
      scanJobId: args.scanJobId,
      status: IngestionTaskStatus.COMPLETED,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      artifactId: true,
      metadata: true,
      artifact: {
        select: {
          id: true,
          url: true,
          bytes: true,
          metadata: true,
        },
      },
    },
  });

  const seen = new Set<string>();
  const rows: BatchArtifactRow[] = [];
  for (const task of tasks) {
    const artifactId = String(task.artifactId || '').trim();
    if (!artifactId || seen.has(artifactId)) continue;
    if (!task.artifact?.url) continue;
    seen.add(artifactId);

    const artifactMeta =
      task.artifact.metadata &&
      typeof task.artifact.metadata === 'object' &&
      !Array.isArray(task.artifact.metadata)
        ? (task.artifact.metadata as Record<string, unknown>)
        : {};
    const taskMeta =
      task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? (task.metadata as Record<string, unknown>)
        : {};
    const mergedMeta = {
      ...artifactMeta,
      ...taskMeta,
    };

    rows.push({
      artifactId,
      fileName:
        sanitizePrintable(mergedMeta.fileName || '', 180) || `artifact-${artifactId.slice(-8)}`,
      artifactUrl: task.artifact.url,
      mimeType: normalizeMimeType(mergedMeta.mimeType),
      bytes: Number(task.artifact.bytes || 0),
    });
  }

  return rows;
}

async function isScanJobTerminal(args: {
  workspaceId: string;
  scanJobId: string;
}): Promise<boolean> {
  const row = await prisma.scanJob.findFirst({
    where: {
      id: args.scanJobId,
      workspaceId: args.workspaceId,
    },
    select: {
      status: true,
    },
  });
  if (!row) {
    throw new ApiHttpError('NOT_FOUND', 'Scan job not found in this workspace.', 404);
  }
  return (
    row.status === ScanJobStatus.REVIEW ||
    row.status === ScanJobStatus.FAILED ||
    row.status === ScanJobStatus.COMPLETED
  );
}

async function hydrateBatchArtifactAttachment(args: {
  workspaceId: string;
  artifact: BatchArtifactRow;
}): Promise<AssistantAttachmentInput> {
  const response = await fetch(args.artifact.artifactUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new ApiHttpError(
      'INTERNAL_ERROR',
      `Failed to download artifact image (${response.status}).`,
      500
    );
  }
  const contentType = normalizeMimeType(
    response.headers.get('content-type') || args.artifact.mimeType
  );
  if (!ASSISTANT_ALLOWED_IMAGE_MIME_TYPES.has(contentType)) {
    throw new ApiHttpError('VALIDATION_ERROR', 'Batch artifact is not a supported image type.', 400);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    artifactId: args.artifact.artifactId,
    url: args.artifact.artifactUrl,
    fileName: args.artifact.fileName,
    mimeType: contentType,
    sizeBytes: args.artifact.bytes || bytes.byteLength,
    base64: bytes.toString('base64'),
  };
}

function serializeAssistantBatch(args: {
  batchId: string;
  workspaceId: string;
  conversationId: string;
  batch: AssistantBatchState;
  artifacts: BatchArtifactRow[];
}) {
  const artifactSet = new Set(args.artifacts.map((row) => row.artifactId));
  const processed = args.batch.processedArtifactIds.filter((id) => artifactSet.has(id));
  const processedSet = new Set(processed);
  const nextArtifact = args.artifacts.find((row) => !processedSet.has(row.artifactId)) || null;
  const totalArtifacts = args.artifacts.length;
  const processedCount = processed.length;
  const pendingManualCount = Math.max(
    args.batch.pendingManualCount,
    args.batch.flagged.length
  );

  return {
    id: args.batchId,
    workspaceId: args.workspaceId,
    conversationId: args.conversationId,
    scanJobId: args.batch.scanJobId,
    status: args.batch.status,
    totalArtifacts,
    processedCount,
    remainingCount: Math.max(0, totalArtifacts - processedCount),
    autoConfirmedCount: args.batch.autoConfirmedCount,
    pendingManualCount,
    lastProcessedArtifactId: args.batch.lastProcessedArtifactId,
    lastProcessedFileName: args.batch.lastProcessedFileName,
    nextArtifact: nextArtifact
      ? {
          artifactId: nextArtifact.artifactId,
          fileName: nextArtifact.fileName,
        }
      : null,
    flagged: args.batch.flagged,
    createdAt: args.batch.createdAt,
    updatedAt: args.batch.updatedAt,
  };
}

export async function createAssistantBatchRun(args: {
  workspaceId: string;
  scanJobId: string;
  conversationId?: string | null;
  accessLink: AccessLink;
}) {
  if (args.accessLink.workspaceId !== args.workspaceId) {
    throw new ApiHttpError('FORBIDDEN', 'Access link is not valid for this workspace.', 403);
  }
  requireRole(args.accessLink, WorkspaceRole.EDITOR);

  const scanJob = await prisma.scanJob.findFirst({
    where: {
      id: args.scanJobId,
      workspaceId: args.workspaceId,
    },
    select: { id: true },
  });
  if (!scanJob) {
    throw new ApiHttpError('NOT_FOUND', 'Scan job not found in this workspace.', 404);
  }

  const conversationId = String(args.conversationId || '').trim();
  let conversation:
    | {
        id: string;
        workspaceId: string;
        metadata: Prisma.JsonValue | null;
      }
    | null = null;

  if (conversationId) {
    const row = await assertConversationAccess({
      workspaceId: args.workspaceId,
      conversationId,
      accessLink: args.accessLink,
    });
    conversation = {
      id: row.id,
      workspaceId: row.workspaceId,
      metadata: row.metadata,
    };
  } else {
    const created = await createAssistantConversation({
      workspaceId: args.workspaceId,
      accessLink: args.accessLink,
      title: `Batch ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    });
    const row = await prisma.assistantConversation.findUnique({
      where: { id: created.id },
      select: {
        id: true,
        workspaceId: true,
        metadata: true,
      },
    });
    if (!row) {
      throw new ApiHttpError('INTERNAL_ERROR', 'Failed to initialize batch conversation.', 500);
    }
    conversation = row;
  }

  const artifacts = await listBatchArtifactsForScanJob({
    workspaceId: args.workspaceId,
    scanJobId: args.scanJobId,
  });

  const nowIso = new Date().toISOString();
  const existingState = parseAssistantBatchState(
    asJsonObject(conversation.metadata).batchRun
  );

  const batch: AssistantBatchState = {
    version: 1,
    scanJobId: args.scanJobId,
    status:
      existingState?.scanJobId === args.scanJobId &&
      existingState.status === 'COMPLETED' &&
      existingState.processedArtifactIds.length >= artifacts.length &&
      artifacts.length > 0
        ? 'COMPLETED'
        : 'RUNNING',
    totalArtifacts: artifacts.length,
    processedArtifactIds:
      existingState?.scanJobId === args.scanJobId
        ? existingState.processedArtifactIds
        : [],
    flagged: existingState?.scanJobId === args.scanJobId ? existingState.flagged : [],
    autoConfirmedCount:
      existingState?.scanJobId === args.scanJobId
        ? existingState.autoConfirmedCount
        : 0,
    pendingManualCount:
      existingState?.scanJobId === args.scanJobId
        ? existingState.pendingManualCount
        : 0,
    lastProcessedArtifactId:
      existingState?.scanJobId === args.scanJobId
        ? existingState.lastProcessedArtifactId
        : null,
    lastProcessedFileName:
      existingState?.scanJobId === args.scanJobId
        ? existingState.lastProcessedFileName
        : null,
    createdAt:
      existingState?.scanJobId === args.scanJobId
        ? existingState.createdAt
        : nowIso,
    updatedAt: nowIso,
    prompt:
      existingState?.scanJobId === args.scanJobId
        ? existingState.prompt
        : ASSISTANT_BATCH_DEFAULT_PROMPT,
  };

  const nextMetadata = {
    ...asJsonObject(conversation.metadata),
    batchRun: batch,
  } as unknown as Prisma.InputJsonValue;

  await prisma.assistantConversation.update({
    where: { id: conversation.id },
    data: {
      metadata: nextMetadata,
      updatedAt: new Date(),
    },
  });

  return serializeAssistantBatch({
    batchId: conversation.id,
    workspaceId: args.workspaceId,
    conversationId: conversation.id,
    batch,
    artifacts,
  });
}

export async function getAssistantBatchRun(args: {
  workspaceId: string;
  batchId: string;
  accessLink: AccessLink;
}) {
  const conversation = await assertConversationAccess({
    workspaceId: args.workspaceId,
    conversationId: args.batchId,
    accessLink: args.accessLink,
  });
  const metadata = asJsonObject(conversation.metadata);
  const batch = parseAssistantBatchState(metadata.batchRun);
  if (!batch) {
    throw new ApiHttpError('NOT_FOUND', 'Assistant batch run not found.', 404);
  }

  const artifacts = await listBatchArtifactsForScanJob({
    workspaceId: args.workspaceId,
    scanJobId: batch.scanJobId,
  });

  return serializeAssistantBatch({
    batchId: conversation.id,
    workspaceId: args.workspaceId,
    conversationId: conversation.id,
    batch,
    artifacts,
  });
}

export async function runAssistantBatchStep(args: {
  workspaceId: string;
  batchId: string;
  accessLink: AccessLink;
}) {
  if (args.accessLink.workspaceId !== args.workspaceId) {
    throw new ApiHttpError('FORBIDDEN', 'Access link is not valid for this workspace.', 403);
  }
  requireRole(args.accessLink, WorkspaceRole.EDITOR);

  const conversation = await assertConversationAccess({
    workspaceId: args.workspaceId,
    conversationId: args.batchId,
    accessLink: args.accessLink,
  });
  const metadata = asJsonObject(conversation.metadata);
  const batch = parseAssistantBatchState(metadata.batchRun);
  if (!batch) {
    throw new ApiHttpError('NOT_FOUND', 'Assistant batch run not found.', 404);
  }

  const artifacts = await listBatchArtifactsForScanJob({
    workspaceId: args.workspaceId,
    scanJobId: batch.scanJobId,
  });
  const artifactSet = new Set(artifacts.map((row) => row.artifactId));
  const processedArtifactIds = batch.processedArtifactIds.filter((id) =>
    artifactSet.has(id)
  );
  const processedSet = new Set(processedArtifactIds);
  const nextArtifact = artifacts.find((row) => !processedSet.has(row.artifactId)) || null;

  if (!nextArtifact) {
    const scanJobTerminal = await isScanJobTerminal({
      workspaceId: args.workspaceId,
      scanJobId: batch.scanJobId,
    });
    const completedBatch: AssistantBatchState = {
      ...batch,
      status: scanJobTerminal ? 'COMPLETED' : 'RUNNING',
      totalArtifacts: artifacts.length,
      processedArtifactIds,
      updatedAt: new Date().toISOString(),
    };
    await prisma.assistantConversation.update({
      where: { id: conversation.id },
      data: {
        metadata: {
          ...metadata,
          batchRun: completedBatch,
        } as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });

    return {
      batch: serializeAssistantBatch({
        batchId: conversation.id,
        workspaceId: args.workspaceId,
        conversationId: conversation.id,
        batch: completedBatch,
        artifacts,
      }),
      step: null,
    };
  }

  let step:
    | {
        artifactId: string;
        fileName: string;
        planId: string | null;
        actionTypes: string[];
        autoConfirmed: boolean;
        flaggedReason: AssistantBatchFlag['reason'] | null;
      }
    | null = null;

  const nextProcessed = [...processedArtifactIds, nextArtifact.artifactId];
  const nextFlagged = [...batch.flagged];
  let autoConfirmedCount = batch.autoConfirmedCount;
  let pendingManualCount = batch.pendingManualCount;

  try {
    const attachment = await hydrateBatchArtifactAttachment({
      workspaceId: args.workspaceId,
      artifact: nextArtifact,
    });

    const messageResult = await postAssistantMessage({
      workspaceId: args.workspaceId,
      conversationId: conversation.id,
      accessLink: args.accessLink,
      text: batch.prompt || ASSISTANT_BATCH_DEFAULT_PROMPT,
      attachments: [attachment],
    });

    const plan = messageResult.plan;
    const safety = evaluateAssistantBatchAutoConfirm(
      (plan?.actions || []).map((action) => ({
        type:
          action.request && typeof action.request === 'object'
            ? (action.request as Record<string, unknown>).type
            : null,
      }))
    );
    const actionTypes = safety.actionTypes;
    const hasUnsafeActions = !safety.safe;

    let autoConfirmed = false;
    let flaggedReason: AssistantBatchFlag['reason'] | null = null;
    let flaggedDetail: string | null = null;

    if (plan && hasUnsafeActions) {
      flaggedReason = 'non_safe_actions';
      pendingManualCount += 1;
    } else if (plan && actionTypes.length > 0) {
      const confirmed = await confirmAssistantPlan({
        workspaceId: args.workspaceId,
        planId: plan.id,
        accessLink: args.accessLink,
      });
      if (confirmed.plan.status === AssistantPlanStatus.EXECUTED) {
        autoConfirmed = true;
        autoConfirmedCount += 1;
      } else if ((confirmed.pendingIdentityCount || 0) > 0) {
        const skippedReason = confirmed.actions
          .filter((entry) => entry.status === AssistantActionStatus.SKIPPED)
          .map((entry) =>
            entry.result && typeof entry.result === 'object'
              ? sanitizePrintable((entry.result as Record<string, unknown>).reason || '', 240)
              : ''
          )
          .find(Boolean);
        const noHighConfidence = skippedReason
          ? skippedReason.toLowerCase().includes('high-confidence')
          : false;
        flaggedReason = noHighConfidence
          ? 'no_high_confidence_identity'
          : 'pending_identity';
        flaggedDetail =
          skippedReason ||
          'At least one action requires identity resolution before completion.';
        pendingManualCount += 1;
      } else {
        const failedActions = confirmed.actions.filter(
          (entry) => entry.status === AssistantActionStatus.FAILED
        );
        if (failedActions.length > 0) {
          const noHighConfidence = failedActions.some((entry) =>
            String(entry.error || '')
              .toLowerCase()
              .includes('high confidence')
          );
          flaggedReason = noHighConfidence
            ? 'no_high_confidence_identity'
            : 'action_failed';
          flaggedDetail =
            failedActions[0]?.error || 'At least one action failed in auto-confirm.';
          pendingManualCount += 1;
        }
      }
    }

    if (flaggedReason) {
      nextFlagged.push({
        artifactId: nextArtifact.artifactId,
        fileName: nextArtifact.fileName,
        reason: flaggedReason,
        planId: plan?.id || null,
        actionTypes,
        details: flaggedDetail,
        createdAt: new Date().toISOString(),
      });
    }

    step = {
      artifactId: nextArtifact.artifactId,
      fileName: nextArtifact.fileName,
      planId: plan?.id || null,
      actionTypes,
      autoConfirmed,
      flaggedReason,
    };
  } catch (error) {
    const details =
      error instanceof Error ? sanitizePrintable(error.message, 260) : 'Unexpected batch step error.';
    nextFlagged.push({
      artifactId: nextArtifact.artifactId,
      fileName: nextArtifact.fileName,
      reason: 'unexpected_error',
      planId: null,
      actionTypes: [],
      details,
      createdAt: new Date().toISOString(),
    });
    pendingManualCount += 1;
    step = {
      artifactId: nextArtifact.artifactId,
      fileName: nextArtifact.fileName,
      planId: null,
      actionTypes: [],
      autoConfirmed: false,
      flaggedReason: 'unexpected_error',
    };
  }

  const scanJobTerminal = await isScanJobTerminal({
    workspaceId: args.workspaceId,
    scanJobId: batch.scanJobId,
  });
  const nextStatus: AssistantBatchStatus =
    nextProcessed.length >= artifacts.length && artifacts.length > 0 && scanJobTerminal
      ? 'COMPLETED'
      : 'RUNNING';

  const nextBatch: AssistantBatchState = {
    ...batch,
    status: nextStatus,
    totalArtifacts: artifacts.length,
    processedArtifactIds: nextProcessed,
    flagged: nextFlagged,
    autoConfirmedCount,
    pendingManualCount,
    lastProcessedArtifactId: nextArtifact.artifactId,
    lastProcessedFileName: nextArtifact.fileName,
    updatedAt: new Date().toISOString(),
  };

  const refreshedConversation = await prisma.assistantConversation.findUnique({
    where: { id: conversation.id },
    select: {
      metadata: true,
    },
  });
  const mergedMetadata = {
    ...asJsonObject(refreshedConversation?.metadata),
    batchRun: nextBatch,
  } as unknown as Prisma.InputJsonValue;

  await prisma.assistantConversation.update({
    where: { id: conversation.id },
    data: {
      metadata: mergedMetadata,
      updatedAt: new Date(),
    },
  });

  return {
    batch: serializeAssistantBatch({
      batchId: conversation.id,
      workspaceId: args.workspaceId,
      conversationId: conversation.id,
      batch: nextBatch,
      artifacts,
    }),
    step,
  };
}

async function assertConversationAccess(args: {
  conversationId: string;
  workspaceId: string;
  accessLink: AccessLink;
}) {
  if (args.accessLink.workspaceId !== args.workspaceId) {
    throw new ApiHttpError('FORBIDDEN', 'Access link is not valid for this workspace.', 403);
  }

  const conversation = await prisma.assistantConversation.findUnique({
    where: { id: args.conversationId },
  });

  if (!conversation || conversation.workspaceId !== args.workspaceId) {
    throw new ApiHttpError('NOT_FOUND', 'Assistant conversation not found.', 404);
  }

  if (conversation.status === AssistantConversationStatus.ARCHIVED) {
    throw new ApiHttpError('CONFLICT', 'Conversation is archived.', 409);
  }

  return conversation;
}

async function buildWorkspaceContext(workspaceId: string) {
  const [governors, events] = await Promise.all([
    prisma.governor.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
      take: 160,
      select: {
        id: true,
        governorId: true,
        name: true,
        alliance: true,
      },
    }),
    prisma.event.findMany({
      where: { workspaceId },
      orderBy: [{ isClosed: 'asc' }, { createdAt: 'desc' }],
      take: 48,
      select: {
        id: true,
        name: true,
        eventType: true,
        weekKey: true,
        isClosed: true,
      },
    }),
  ]);

  return {
    governors,
    events,
  };
}

function buildFallbackPlanningPrompt(args: {
  userText: string;
  ocrMarkdownByImage: Array<{ fileName: string; markdown: string }>;
  governors: Array<{ id: string; governorId: string; name: string; alliance: string }>;
  events: Array<{ id: string; name: string; eventType: EventType; weekKey: string | null; isClosed: boolean }>;
  readContextText?: string;
}) {
  const governorsBlock = args.governors
    .slice(0, 160)
    .map((row) => `${row.id} | ${row.governorId} | ${row.name} | ${row.alliance || '-'}`)
    .join('\n');

  const eventsBlock = args.events
    .slice(0, 48)
    .map(
      (row) =>
        `${row.id} | ${row.name} | ${row.eventType}${row.weekKey ? ` | week:${row.weekKey}` : ''}${
          row.isClosed ? ' | closed' : ' | open'
        }`
    )
    .join('\n');

  const ocrBlock = args.ocrMarkdownByImage
    .map((entry, index) => {
      const snippet = sanitizePrintable(entry.markdown, 12000);
      return `Image ${index + 1} (${entry.fileName}):\n${snippet}`;
    })
    .join('\n\n');

  return [
    'Workspace action planning task.',
    'Generate assistantResponse, summary, and typed actions only when explicitly supported by the user text or OCR evidence.',
    'Rules:',
    '- Never invent player identifiers.',
    '- For record_profile_stats, include governorId or governorName from evidence when possible.',
    '- For delete actions, include concrete identifiers.',
    '- If no write should happen yet, return actions as empty array.',
    '',
    `User text:\n${sanitizePrintable(args.userText, 4000) || '(empty)'}`,
    args.readContextText
      ? `\nRead tool context:\n${sanitizePrintable(args.readContextText, 12000)}`
      : '',
    '',
    `OCR evidence:\n${ocrBlock || '(no OCR markdown)'}`,
    '',
    `Registered governors (id | governorId | name | alliance):\n${governorsBlock || '(none)'}`,
    '',
    `Workspace events (id | name | type | week/open-state):\n${eventsBlock || '(none)'}`,
  ].join('\n');
}

function buildConversationInputs(args: {
  userText: string;
  attachments: AssistantAttachmentInput[];
  ocrMarkdownByImage: Array<{ fileName: string; markdown: string }>;
}): Array<Record<string, unknown>> {
  const chunks: Array<Record<string, unknown>> = [];

  if (sanitizePrintable(args.userText, 8000)) {
    chunks.push({
      type: 'text',
      text: sanitizePrintable(args.userText, 8000),
    });
  }

  if (args.ocrMarkdownByImage.length > 0) {
    const ocrText = args.ocrMarkdownByImage
      .map((entry, index) => `Image ${index + 1} (${entry.fileName}) OCR:\n${sanitizePrintable(entry.markdown, 9000)}`)
      .join('\n\n');

    chunks.push({
      type: 'text',
      text: `OCR summary:\n${ocrText}`,
    });
  }

  for (const attachment of args.attachments) {
    chunks.push({
      type: 'image_url',
      image_url: toDataUrl(attachment.base64, attachment.mimeType),
    });
  }

  if (chunks.length === 0) {
    chunks.push({ type: 'text', text: '(no message body)' });
  }

  return chunks;
}

function pickConversationAssistantText(response: MistralConversationResponse): string {
  const textOutputs = extractConversationTextOutputs(response.outputs);
  const joined = textOutputs.join('\n\n').trim();
  return sanitizePrintable(joined, 5000);
}

function parseActionsFromFunctionCalls(response: MistralConversationResponse) {
  const calls = extractFunctionCalls(response.outputs);
  const writeActions: AssistantActionInput[] = [];
  const readCalls: Array<{ toolCallId: string; action: AssistantReadActionInput }> = [];
  const readActions: AssistantReadActionInput[] = [];
  const pendingToolCallIds: string[] = [];
  const droppedCalls: Array<{ name: string; reason: string }> = [];

  for (const call of calls) {
    const readAction = tryParseReadActionFromCall(call.name, call.arguments);
    if (readAction) {
      readCalls.push({
        toolCallId: call.toolCallId,
        action: readAction,
      });
      readActions.push(readAction);
      continue;
    }

    const writeAction = tryParseActionFromCall(call.name, call.arguments);
    if (writeAction) {
      writeActions.push(writeAction);
      if (call.confirmationStatus === 'pending') {
        pendingToolCallIds.push(call.toolCallId);
      }
      continue;
    }

    droppedCalls.push({
      name: call.name,
      reason: 'unsupported_or_invalid',
    });
  }

  return {
    writeActions,
    readCalls,
    readActions,
    pendingToolCallIds,
    droppedCalls,
    rawCalls: calls,
  };
}

function parsePlanMetadata(actionsJson: Prisma.JsonValue | null | undefined): {
  actions: AssistantActionInput[];
  pendingToolCallIds: string[];
  confirmationMode: 'mistral_tool_confirmations' | 'app_managed';
} {
  const root = asJsonObject(actionsJson);
  const actionCandidates = Array.isArray(root.actions)
    ? root.actions
    : Array.isArray(actionsJson)
      ? (actionsJson as unknown[])
      : [];

  const actions = normalizePlannedActions(actionCandidates);
  const pendingToolCallIds = Array.isArray(root.pendingToolCallIds)
    ? root.pendingToolCallIds
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    : [];

  const confirmationMode =
    root.confirmationMode === 'mistral_tool_confirmations'
      ? 'mistral_tool_confirmations'
      : 'app_managed';

  return {
    actions,
    pendingToolCallIds,
    confirmationMode,
  };
}

function normalizeWriteAction(action: AssistantActionInput): AssistantActionInput {
  switch (action.type) {
    case 'register_player':
      return {
        ...action,
        governorId: normalizeDigits(action.governorId, 24),
        name: normalizeGovernorName(action.name),
        alliance: action.alliance == null ? action.alliance : sanitizePrintable(action.alliance, 80),
      };
    case 'update_player':
      return {
        ...action,
        governorDbId: action.governorDbId == null ? action.governorDbId : sanitizePrintable(action.governorDbId, 60),
        governorId: action.governorId == null ? action.governorId : normalizeDigits(action.governorId, 24),
        governorName: action.governorName == null ? action.governorName : normalizeGovernorName(action.governorName),
        name: action.name == null ? action.name : normalizeGovernorName(action.name),
        alliance: action.alliance == null ? action.alliance : sanitizePrintable(action.alliance, 80),
        newGovernorId: action.newGovernorId == null ? action.newGovernorId : normalizeDigits(action.newGovernorId, 24),
      };
    case 'delete_player':
      return {
        ...action,
        governorDbId: action.governorDbId == null ? action.governorDbId : sanitizePrintable(action.governorDbId, 60),
        governorId: action.governorId == null ? action.governorId : normalizeDigits(action.governorId, 24),
        governorName: action.governorName == null ? action.governorName : normalizeGovernorName(action.governorName),
      };
    case 'create_event':
      return {
        ...action,
        name: normalizeEventName(action.name),
        description: action.description == null ? action.description : sanitizePrintable(action.description, 500),
      };
    case 'delete_event':
      return {
        ...action,
        eventId: action.eventId == null ? action.eventId : sanitizePrintable(action.eventId, 60),
        eventName: action.eventName == null ? action.eventName : normalizeEventName(action.eventName),
      };
    case 'record_profile_stats':
      return {
        ...action,
        governorDbId: action.governorDbId == null ? action.governorDbId : sanitizePrintable(action.governorDbId, 60),
        governorId: action.governorId == null ? action.governorId : normalizeDigits(action.governorId, 24),
        governorName: action.governorName == null ? action.governorName : normalizeGovernorName(action.governorName),
        eventId: action.eventId == null ? action.eventId : sanitizePrintable(action.eventId, 60),
        eventName: action.eventName == null ? action.eventName : normalizeEventName(action.eventName),
      };
    default:
      return action;
  }
}

function preflightWriteActions(
  actions: AssistantActionInput[]
): {
  accepted: AssistantActionInput[];
  dropped: Array<{ index: number; type: string; reason: string }>;
} {
  const accepted: AssistantActionInput[] = [];
  const dropped: Array<{ index: number; type: string; reason: string }> = [];

  for (const [index, action] of actions.entries()) {
    const normalized = normalizeWriteAction(action);
    let reason: string | null = null;

    switch (normalized.type) {
      case 'register_player': {
        if (!normalized.governorId) reason = 'missing_governor_id';
        else if (!normalized.name) reason = 'missing_name';
        break;
      }
      case 'update_player': {
        const hasIdentifier =
          Boolean(normalized.governorDbId) || Boolean(normalized.governorId) || Boolean(normalized.governorName);
        const hasPatch = normalized.name != null || normalized.alliance != null || normalized.newGovernorId != null;
        if (!hasIdentifier) reason = 'missing_identifier';
        else if (!hasPatch) reason = 'missing_patch_fields';
        break;
      }
      case 'delete_player': {
        const hasIdentifier =
          Boolean(normalized.governorDbId) || Boolean(normalized.governorId) || Boolean(normalized.governorName);
        if (!hasIdentifier) reason = 'missing_identifier';
        break;
      }
      case 'create_event': {
        if (!normalized.name) reason = 'missing_event_name';
        break;
      }
      case 'delete_event': {
        const hasIdentifier = Boolean(normalized.eventId) || Boolean(normalized.eventName);
        if (!hasIdentifier) reason = 'missing_event_identifier';
        break;
      }
      case 'record_profile_stats': {
        const hasIdentifier =
          Boolean(normalized.governorDbId) || Boolean(normalized.governorId) || Boolean(normalized.governorName);
        if (!hasIdentifier) reason = 'missing_governor_identifier';
        break;
      }
      default:
        reason = 'unsupported_action';
    }

    if (reason) {
      dropped.push({ index, type: normalized.type, reason });
      continue;
    }

    accepted.push(normalized);
  }

  return {
    accepted,
    dropped,
  };
}

type AssistantReadExecution = {
  toolCallId?: string;
  actionType: AssistantReadActionInput['type'];
  request: AssistantReadActionInput;
  summary: string;
  result: Record<string, unknown>;
  durationMs: number;
  error?: string;
};

function summarizeReadExecution(execution: AssistantReadExecution): string {
  if (execution.error) {
    return `${execution.actionType}: error=${execution.error}`;
  }

  switch (execution.actionType) {
    case 'read_workspace_overview':
      return `${execution.actionType}: workspace counts loaded`;
    case 'read_governors':
      return `${execution.actionType}: ${Number(execution.result.count || 0)} governor rows`;
    case 'read_events':
      return `${execution.actionType}: ${Number(execution.result.count || 0)} events`;
    case 'read_scan_jobs':
      return `${execution.actionType}: ${Number(execution.result.count || 0)} scan jobs`;
    case 'read_profile_review_queue':
      return `${execution.actionType}: ${Number(execution.result.count || 0)} profile review rows`;
    case 'read_ranking_review_queue':
      return `${execution.actionType}: ${Number(execution.result.count || 0)} ranking review rows`;
    case 'read_ranking_runs':
      return `${execution.actionType}: ${Number(execution.result.count || 0)} ranking runs`;
    default:
      return `${execution.actionType}: completed`;
  }
}

function profileSeverityForRead(row: {
  lowConfidence: boolean;
  failureReasons: Prisma.JsonValue;
  status: OcrExtractionStatus;
  confidence: number;
}): 'HIGH' | 'MEDIUM' | 'LOW' {
  const reasons = Array.isArray(row.failureReasons) ? row.failureReasons : [];
  if (row.status === OcrExtractionStatus.RAW && row.lowConfidence) return 'HIGH';
  if (reasons.length > 0) return 'HIGH';
  if (row.lowConfidence || row.confidence < 70) return 'MEDIUM';
  return 'LOW';
}

async function executeReadAction(args: {
  workspaceId: string;
  action: AssistantReadActionInput;
}): Promise<AssistantReadExecution> {
  const startedAt = Date.now();

  try {
    switch (args.action.type) {
      case 'read_workspace_overview': {
        const [governorCount, eventCount, scanJobCount, profilePendingCount, rankingPendingCount] = await Promise.all([
          prisma.governor.count({ where: { workspaceId: args.workspaceId } }),
          prisma.event.count({ where: { workspaceId: args.workspaceId } }),
          prisma.scanJob.count({ where: { workspaceId: args.workspaceId } }),
          prisma.ocrExtraction.count({
            where: {
              scanJob: { workspaceId: args.workspaceId },
              status: { in: [OcrExtractionStatus.RAW, OcrExtractionStatus.REVIEWED] },
            },
          }),
          prisma.rankingRow.count({
            where: {
              workspaceId: args.workspaceId,
              identityStatus: RankingIdentityStatus.UNRESOLVED,
            },
          }),
        ]);

        const result = {
          governorCount,
          eventCount,
          scanJobCount,
          profilePendingCount,
          rankingPendingCount,
        };

        return {
          actionType: args.action.type,
          request: args.action,
          summary: 'Loaded workspace overview counts.',
          result,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'read_governors': {
        const limit = clampLimit(args.action.limit, 20);
        const offset = clampOffset(args.action.offset, 0);
        const search = sanitizePrintable(args.action.search || '', 80);
        const where: Prisma.GovernorWhereInput = {
          workspaceId: args.workspaceId,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { governorId: { contains: search } },
                ],
              }
            : {}),
        };
        const [rows, total] = await Promise.all([
          prisma.governor.findMany({
            where,
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            skip: offset,
            take: limit,
            select: {
              id: true,
              governorId: true,
              name: true,
              alliance: true,
              updatedAt: true,
            },
          }),
          prisma.governor.count({ where }),
        ]);

        const result = {
          count: rows.length,
          total,
          limit,
          offset,
          rows: rows.map((row) => ({
            ...row,
            updatedAt: row.updatedAt.toISOString(),
          })),
        };

        return {
          actionType: args.action.type,
          request: args.action,
          summary: `Loaded ${rows.length} governors.`,
          result,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'read_governor_detail': {
        const governor = args.action.governorDbId
          ? await prisma.governor.findFirst({
              where: {
                workspaceId: args.workspaceId,
                id: String(args.action.governorDbId),
              },
              select: {
                id: true,
                governorId: true,
                name: true,
                alliance: true,
                updatedAt: true,
              },
            })
          : await prisma.governor.findFirst({
              where: {
                workspaceId: args.workspaceId,
                governorId: String(args.action.governorId),
              },
              select: {
                id: true,
                governorId: true,
                name: true,
                alliance: true,
                updatedAt: true,
              },
            });

        if (!governor) {
          throw new ApiHttpError('NOT_FOUND', 'Governor not found for read_governor_detail.', 404);
        }

        const snapshots = await prisma.snapshot.findMany({
          where: {
            governorId: governor.id,
            OR: [{ workspaceId: args.workspaceId }, { event: { workspaceId: args.workspaceId } }],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 8,
          select: {
            id: true,
            eventId: true,
            power: true,
            killPoints: true,
            t4Kills: true,
            t5Kills: true,
            deads: true,
            createdAt: true,
          },
        });

        const result = {
          governor: {
            ...governor,
            updatedAt: governor.updatedAt.toISOString(),
          },
          snapshots: snapshots.map((row) => ({
            ...row,
            power: row.power.toString(),
            killPoints: row.killPoints.toString(),
            t4Kills: row.t4Kills.toString(),
            t5Kills: row.t5Kills.toString(),
            deads: row.deads.toString(),
            createdAt: row.createdAt.toISOString(),
          })),
        };

        return {
          actionType: args.action.type,
          request: args.action,
          summary: `Loaded governor ${governor.name} (${governor.governorId}).`,
          result,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'read_events': {
        const limit = clampLimit(args.action.limit, 20);
        const offset = clampOffset(args.action.offset, 0);
        const search = sanitizePrintable(args.action.search || '', 120);
        const includeClosed = Boolean(args.action.includeClosed);
        const where: Prisma.EventWhereInput = {
          workspaceId: args.workspaceId,
          ...(includeClosed ? {} : { isClosed: false }),
          ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        };

        const [rows, total] = await Promise.all([
          prisma.event.findMany({
            where,
            orderBy: [{ isClosed: 'asc' }, { createdAt: 'desc' }],
            skip: offset,
            take: limit,
            select: {
              id: true,
              name: true,
              description: true,
              eventType: true,
              weekKey: true,
              isClosed: true,
              createdAt: true,
            },
          }),
          prisma.event.count({ where }),
        ]);

        const result = {
          count: rows.length,
          total,
          limit,
          offset,
          rows: rows.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
          })),
        };

        return {
          actionType: args.action.type,
          request: args.action,
          summary: `Loaded ${rows.length} events.`,
          result,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'read_event_detail': {
        const event = args.action.eventId
          ? await prisma.event.findFirst({
              where: {
                id: String(args.action.eventId),
                workspaceId: args.workspaceId,
              },
              include: {
                _count: {
                  select: {
                    snapshots: true,
                    metricObservations: true,
                    rankingRuns: true,
                  },
                },
              },
            })
          : await prisma.event.findFirst({
              where: {
                workspaceId: args.workspaceId,
                name: {
                  equals: String(args.action.eventName || ''),
                  mode: 'insensitive',
                },
              },
              include: {
                _count: {
                  select: {
                    snapshots: true,
                    metricObservations: true,
                    rankingRuns: true,
                  },
                },
              },
            });

        if (!event) {
          throw new ApiHttpError('NOT_FOUND', 'Event not found for read_event_detail.', 404);
        }

        const result = {
          id: event.id,
          name: event.name,
          description: event.description,
          eventType: event.eventType,
          weekKey: event.weekKey,
          isClosed: event.isClosed,
          startsAt: toIso(event.startsAt),
          endsAt: toIso(event.endsAt),
          createdAt: event.createdAt.toISOString(),
          counts: event._count,
        };

        return {
          actionType: args.action.type,
          request: args.action,
          summary: `Loaded event ${event.name}.`,
          result,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'read_scan_jobs': {
        const limit = clampLimit(args.action.limit, 20);
        const offset = clampOffset(args.action.offset, 0);
        const statusRaw = String(args.action.status || '').trim();
        const status =
          statusRaw && Object.values(ScanJobStatus).includes(statusRaw as ScanJobStatus)
            ? (statusRaw as ScanJobStatus)
            : null;

        const where: Prisma.ScanJobWhereInput = {
          workspaceId: args.workspaceId,
          ...(status ? { status } : {}),
        };
        const [rows, total] = await Promise.all([
          prisma.scanJob.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit,
            skip: offset,
            select: {
              id: true,
              status: true,
              source: true,
              totalFiles: true,
              processedFiles: true,
              lowConfidenceFiles: true,
              createdAt: true,
              startedAt: true,
              completedAt: true,
            },
          }),
          prisma.scanJob.count({ where }),
        ]);

        const result = {
          count: rows.length,
          total,
          limit,
          offset,
          rows: rows.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            startedAt: toIso(row.startedAt),
            completedAt: toIso(row.completedAt),
          })),
        };

        return {
          actionType: args.action.type,
          request: args.action,
          summary: `Loaded ${rows.length} scan jobs.`,
          result,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'read_scan_job_tasks': {
        const limit = clampLimit(args.action.limit, 30);
        const offset = clampOffset(args.action.offset, 0);
        const scanJobId = String(args.action.scanJobId || '').trim();
        const scanJob = await prisma.scanJob.findFirst({
          where: {
            id: scanJobId,
            workspaceId: args.workspaceId,
          },
          select: {
            id: true,
            status: true,
          },
        });
        if (!scanJob) {
          throw new ApiHttpError('NOT_FOUND', 'Scan job not found for read_scan_job_tasks.', 404);
        }

        const statusFilter = String(args.action.status || '')
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry): entry is IngestionTaskStatus =>
            Object.values(IngestionTaskStatus).includes(entry as IngestionTaskStatus)
          );

        const where: Prisma.IngestionTaskWhereInput = {
          scanJobId: scanJob.id,
          ...(statusFilter.length > 0 ? { status: { in: statusFilter } } : {}),
        };

        const [rows, total] = await Promise.all([
          prisma.ingestionTask.findMany({
            where,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: limit,
            skip: offset,
            select: {
              id: true,
              status: true,
              attemptCount: true,
              artifactId: true,
              archetypeHint: true,
              lastError: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
          prisma.ingestionTask.count({ where }),
        ]);

        const result = {
          scanJobId: scanJob.id,
          scanJobStatus: scanJob.status,
          count: rows.length,
          total,
          limit,
          offset,
          rows: rows.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          })),
        };

        return {
          actionType: args.action.type,
          request: args.action,
          summary: `Loaded ${rows.length} tasks for scan job ${scanJob.id.slice(-8)}.`,
          result,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'read_profile_review_queue': {
        const limit = clampLimit(args.action.limit, 20);
        const offset = clampOffset(args.action.offset, 0);
        const severity = String(args.action.severity || '').trim().toUpperCase();
        const statuses = String(args.action.status || '')
          .split(',')
          .map((entry) => entry.trim().toUpperCase())
          .filter((entry): entry is OcrExtractionStatus =>
            Object.values(OcrExtractionStatus).includes(entry as OcrExtractionStatus)
          );

        const where: Prisma.OcrExtractionWhereInput = {
          scanJob: { workspaceId: args.workspaceId },
          status: { in: statuses.length > 0 ? statuses : [OcrExtractionStatus.RAW, OcrExtractionStatus.REVIEWED] },
        };
        const candidates = await prisma.ocrExtraction.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: {
            artifact: {
              select: {
                id: true,
                url: true,
              },
            },
            scanJob: {
              select: {
                id: true,
                status: true,
              },
            },
          },
          take: Math.max(120, limit * 4),
        });

        const mapped = candidates
          .map((row) => {
            const sev = profileSeverityForRead(row);
            return {
              id: row.id,
              status: row.status,
              confidence: row.confidence,
              severity: sev,
              lowConfidence: row.lowConfidence,
              governorIdRaw: row.governorIdRaw,
              governorNameRaw: row.governorNameRaw,
              failureReasons: Array.isArray(row.failureReasons) ? row.failureReasons : [],
              artifact: row.artifact,
              scanJob: row.scanJob,
              createdAt: row.createdAt.toISOString(),
            };
          })
          .filter((row) => (severity ? row.severity === severity : true));

        const sliced = mapped.slice(offset, offset + limit);

        const result = {
          count: sliced.length,
          total: mapped.length,
          limit,
          offset,
          summary: {
            high: mapped.filter((row) => row.severity === 'HIGH').length,
            medium: mapped.filter((row) => row.severity === 'MEDIUM').length,
            low: mapped.filter((row) => row.severity === 'LOW').length,
          },
          rows: sliced,
        };

        return {
          actionType: args.action.type,
          request: args.action,
          summary: `Loaded ${sliced.length} profile review rows.`,
          result,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'read_ranking_review_queue': {
        const limit = clampLimit(args.action.limit, 30);
        const offset = clampOffset(args.action.offset, 0);
        const statuses = String(args.action.status || '')
          .split(',')
          .map((entry) => entry.trim().toUpperCase())
          .filter((entry): entry is RankingIdentityStatus =>
            Object.values(RankingIdentityStatus).includes(entry as RankingIdentityStatus)
          );

        const rows = await listRankingReviewRows({
          workspaceId: args.workspaceId,
          eventId: null,
          rankingType: args.action.rankingType || null,
          metricKey: args.action.metricKey || null,
          status: statuses.length > 0 ? statuses : [RankingIdentityStatus.UNRESOLVED],
          limit,
          offset,
        });

        const result = {
          count: rows.rows.length,
          total: rows.total,
          limit,
          offset,
          rows: rows.rows,
        };

        return {
          actionType: args.action.type,
          request: args.action,
          summary: `Loaded ${rows.rows.length} ranking review rows.`,
          result,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'read_ranking_runs': {
        const limit = clampLimit(args.action.limit, 20);
        const offset = clampOffset(args.action.offset, 0);
        const statusRaw = String(args.action.status || '').trim();
        const status =
          statusRaw && Object.values(RankingRunStatus).includes(statusRaw as RankingRunStatus)
            ? (statusRaw as RankingRunStatus)
            : null;
        const runs = await listRankingRuns({
          workspaceId: args.workspaceId,
          eventId: args.action.eventId || null,
          rankingType: args.action.rankingType || null,
          status,
          limit,
          offset,
        });

        const result = {
          count: runs.rows.length,
          total: runs.total,
          limit,
          offset,
          rows: runs.rows,
        };

        return {
          actionType: args.action.type,
          request: args.action,
          summary: `Loaded ${runs.rows.length} ranking runs.`,
          result,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'read_ranking_run_detail': {
        const run = await getRankingRunById({
          workspaceId: args.workspaceId,
          runId: args.action.runId,
        });
        const result = {
          ...run,
          rows: run.rows.slice(0, 80),
        };
        return {
          actionType: args.action.type,
          request: args.action,
          summary: `Loaded ranking run ${run.id.slice(-8)} (${run.rows.length} rows).`,
          result,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'read_activity_weekly': {
        const report = await getWeeklyActivityReport({
          workspaceId: args.workspaceId,
          weekKey: args.action.weekKey || null,
          alliances: Array.isArray(args.action.alliances) ? args.action.alliances : [],
        });

        return {
          actionType: args.action.type,
          request: args.action,
          summary: 'Loaded weekly activity report.',
          result: report as unknown as Record<string, unknown>,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'read_analytics': {
        const analytics = await buildWorkspaceAnalytics({
          workspaceId: args.workspaceId,
          eventAId: args.action.eventA || null,
          eventBId: args.action.eventB || null,
          topN: clampLimit(args.action.topN, 10, 50),
        });

        return {
          actionType: args.action.type,
          request: args.action,
          summary: 'Loaded analytics summary.',
          result: analytics as unknown as Record<string, unknown>,
          durationMs: Date.now() - startedAt,
        };
      }

      case 'read_compare': {
        const compared = await compareWorkspaceEvents({
          workspaceId: args.workspaceId,
          eventAId: args.action.eventA,
          eventBId: args.action.eventB,
        });
        const topN = clampLimit(args.action.topN, 10, 50);

        return {
          actionType: args.action.type,
          request: args.action,
          summary: `Compared events ${args.action.eventA} vs ${args.action.eventB}.`,
          result: {
            ...compared,
            leaderboard: compared.comparisons.slice(0, topN),
            leaderboardCount: Math.min(topN, compared.comparisons.length),
          } as unknown as Record<string, unknown>,
          durationMs: Date.now() - startedAt,
        };
      }

      default:
        throw new ApiHttpError('VALIDATION_ERROR', 'Unsupported assistant read action.', 400);
    }
  } catch (error) {
    return {
      actionType: args.action.type,
      request: args.action,
      summary: `Read action failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      result: {},
      error: sanitizePrintable(error instanceof Error ? error.message : 'Read action failed.', 320),
      durationMs: Date.now() - startedAt,
    };
  }
}

async function executeReadActions(args: {
  workspaceId: string;
  calls: Array<{ toolCallId: string; action: AssistantReadActionInput }>;
}): Promise<AssistantReadExecution[]> {
  const executions: AssistantReadExecution[] = [];
  const readCalls = args.calls.slice(0, MAX_READ_ACTIONS_PER_TURN);

  for (const call of readCalls) {
    const execution = await executeReadAction({
      workspaceId: args.workspaceId,
      action: call.action,
    });
    execution.toolCallId = call.toolCallId;
    executions.push(execution);
  }

  return executions;
}

function buildReadResultsPrompt(executions: AssistantReadExecution[]): string {
  if (executions.length === 0) return '';
  const lines = executions.map((execution, index) => {
    const head = `${index + 1}. ${summarizeReadExecution(execution)} (${execution.durationMs}ms)`;
    const body = execution.error
      ? `Error: ${execution.error}`
      : safeJsonText(
          {
            actionType: execution.actionType,
            result: execution.result,
          },
          7_500
        );
    return `${head}\n${body}`;
  });

  return [
    'Read tool execution results (source of truth):',
    ...lines,
    'Use these results to answer questions and plan write actions if needed.',
  ].join('\n\n');
}

type AttachmentEvidence = {
  fileName: string;
  markdown: string;
  metadata: Record<string, unknown>;
};

function summarizeExtractionForPrompt(
  fileName: string,
  extraction:
    | {
        ingestionDomain: 'PROFILE_SNAPSHOT';
        screenArchetype: 'governor_profile';
        profile: Record<string, unknown>;
        metadata: Record<string, unknown>;
      }
    | {
        ingestionDomain: 'RANKING_CAPTURE';
        screenArchetype: 'ranking_board';
        ranking: Record<string, unknown>;
        metadata: Record<string, unknown>;
      }
): AttachmentEvidence {
  if (extraction.ingestionDomain === 'PROFILE_SNAPSHOT') {
    const profile = extraction.profile || {};
    const normalized = asJsonObject(profile.normalized);
    const markdown = [
      `Image (${fileName}) extracted as governor profile.`,
      `governorId: ${sanitizePrintable(normalized.governorId || '', 40) || '(unknown)'}`,
      `governorName: ${sanitizePrintable(normalized.governorName || '', 120) || '(unknown)'}`,
      `power: ${sanitizePrintable(normalized.power || '', 30) || '(unknown)'}`,
      `killPoints: ${sanitizePrintable(normalized.killPoints || '', 30) || '(unknown)'}`,
      `t4Kills: ${sanitizePrintable(normalized.t4Kills || '', 30) || '(unknown)'}`,
      `t5Kills: ${sanitizePrintable(normalized.t5Kills || '', 30) || '(unknown)'}`,
      `deads: ${sanitizePrintable(normalized.deads || '', 30) || '(unknown)'}`,
      `alliance: ${sanitizePrintable(normalized.alliance || '', 80) || '(unknown)'}`,
    ].join('\n');

    return {
      fileName,
      markdown,
      metadata: {
        ingestionDomain: extraction.ingestionDomain,
        screenArchetype: extraction.screenArchetype,
        extraction: {
          normalized,
        },
      },
    };
  }

  const ranking = extraction.ranking || {};
  const rows = Array.isArray((ranking as Record<string, unknown>).rows)
    ? ((ranking as Record<string, unknown>).rows as Array<Record<string, unknown>>).slice(0, 20)
    : [];
  const markdown = [
    `Image (${fileName}) extracted as ranking board.`,
    `rankingType: ${sanitizePrintable((ranking as Record<string, unknown>).rankingType || '', 60) || 'unknown'}`,
    `metricKey: ${sanitizePrintable((ranking as Record<string, unknown>).metricKey || '', 60) || 'metric'}`,
    'Rows:',
    ...rows.map((row, index) => {
      return `${index + 1}. rank=${sanitizePrintable(row.sourceRank || '-', 20)} | name=${sanitizePrintable(
        row.governorNameRaw || '',
        80
      )} | metric=${sanitizePrintable(row.metricValue || row.metricRaw || '', 80)}`;
    }),
  ].join('\n');

  return {
    fileName,
    markdown,
    metadata: {
      ingestionDomain: extraction.ingestionDomain,
      screenArchetype: extraction.screenArchetype,
      extraction: {
        rankingType: (ranking as Record<string, unknown>).rankingType || null,
        metricKey: (ranking as Record<string, unknown>).metricKey || null,
        rows: rows.length,
      },
    },
  };
}

async function extractAttachmentEvidence(args: {
  settings: Awaited<ReturnType<typeof readAssistantSettings>>;
  attachments: AssistantAttachmentInput[];
}): Promise<{
  evidence: AttachmentEvidence[];
  diagnostics: Array<Record<string, unknown>>;
}> {
  const evidence: AttachmentEvidence[] = [];
  const diagnostics: Array<Record<string, unknown>> = [];
  const queue = [...args.attachments].slice(0, MAX_EVIDENCE_IMAGES);
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const attachment = queue[index];
      const startedAt = Date.now();

      try {
        const extracted = await runMistralIngestionExtraction({
          image: {
            base64: attachment.base64,
            mimeType: attachment.mimeType,
          },
          ocrModel: args.settings.ocrModel,
          extractionModel: args.settings.assistantModel,
        });

        const row = summarizeExtractionForPrompt(attachment.fileName, extracted);
        evidence.push(row);
        diagnostics.push({
          fileName: attachment.fileName,
          strategy: 'mistral_ingestion_extraction',
          durationMs: Date.now() - startedAt,
          ...row.metadata,
        });
      } catch (primaryError) {
        try {
          const ocr = await runMistralOcr({
            image: {
              base64: attachment.base64,
              mimeType: attachment.mimeType,
            },
            model: args.settings.ocrModel,
            includeImageBase64: false,
          });

          const markdown = (ocr.pages || [])
            .slice(0, 4)
            .map((page) => String(page.markdown || '').trim())
            .filter(Boolean)
            .join('\n\n');

          evidence.push({
            fileName: attachment.fileName,
            markdown,
            metadata: {
              strategy: 'mistral_ocr_fallback',
            },
          });
          diagnostics.push({
            fileName: attachment.fileName,
            strategy: 'mistral_ocr_fallback',
            durationMs: Date.now() - startedAt,
            ocrModel: ocr.model,
            primaryError: sanitizePrintable(
              primaryError instanceof Error ? primaryError.message : 'primary extraction failed',
              240
            ),
          });
        } catch (fallbackError) {
          diagnostics.push({
            fileName: attachment.fileName,
            strategy: 'failed',
            durationMs: Date.now() - startedAt,
            primaryError: sanitizePrintable(
              primaryError instanceof Error ? primaryError.message : 'primary extraction failed',
              240
            ),
            fallbackError: sanitizePrintable(
              fallbackError instanceof Error ? fallbackError.message : 'fallback OCR failed',
              240
            ),
          });
        }
      }
    }
  };

  await Promise.all(
    Array.from({
      length: Math.min(ATTACHMENT_EXTRACTION_CONCURRENCY, queue.length),
    }).map(() => worker())
  );

  return {
    evidence,
    diagnostics,
  };
}

async function resolveGovernorForMutationTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    governorDbId?: string | null;
    governorId?: string | null;
    governorName?: string | null;
  }
): Promise<{ id: string; governorId: string; name: string }>{
  const workspaceId = String(args.workspaceId || '').trim();
  if (!workspaceId) {
    throw new ApiHttpError('VALIDATION_ERROR', 'workspaceId is required.', 400);
  }

  const governorDbId = String(args.governorDbId || '').trim();
  if (governorDbId) {
    const byDbId = await tx.governor.findFirst({
      where: {
        id: governorDbId,
        workspaceId,
      },
      select: {
        id: true,
        governorId: true,
        name: true,
      },
    });
    if (!byDbId) {
      throw new ApiHttpError('NOT_FOUND', 'Governor not found in this workspace.', 404);
    }
    return byDbId;
  }

  const governorId = String(args.governorId || '').trim();
  if (governorId) {
    const byGameId = await tx.governor.findFirst({
      where: {
        workspaceId,
        governorId,
      },
      select: {
        id: true,
        governorId: true,
        name: true,
      },
    });
    if (!byGameId) {
      throw new ApiHttpError('NOT_FOUND', 'Governor not found in this workspace.', 404);
    }
    return byGameId;
  }

  const governorName = normalizeGovernorName(args.governorName || '');
  if (!governorName) {
    throw new ApiHttpError(
      'VALIDATION_ERROR',
      'Governor identifier is required (governorDbId, governorId, or governorName).',
      400
    );
  }

  const similarity = await resolveGovernorBySimilarityTx(tx, {
    workspaceId,
    governorNameRaw: governorName,
    suggestionLimit: 8,
  });

  if (similarity.status === 'resolved') {
    return {
      id: similarity.governor.governorDbId,
      governorId: similarity.governor.governorGameId,
      name: similarity.governor.governorName,
    };
  }

  const candidates = similarity.candidates.map((candidate) => ({
    governorDbId: candidate.governorDbId,
    governorGameId: candidate.governorGameId,
    governorName: candidate.governorName,
    score: candidate.score,
  }));

  if (similarity.status === 'ambiguous') {
    throw new ApiHttpError(
      'CONFLICT',
      'Multiple high-confidence governors matched this name. Provide governorId or governorDbId.',
      409,
      {
        threshold: similarity.autoThreshold,
        candidates,
      }
    );
  }

  throw new ApiHttpError(
    'NOT_FOUND',
    'Governor name did not match any registered player with high confidence.',
    404,
    {
      threshold: similarity.autoThreshold,
      candidates,
    }
  );
}

async function resolveEventForActionTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    eventId?: string | null;
    eventName?: string | null;
  }
): Promise<{ id: string } | null> {
  const eventId = String(args.eventId || '').trim();
  if (eventId) {
    const event = await tx.event.findFirst({
      where: {
        id: eventId,
        workspaceId: args.workspaceId,
      },
      select: {
        id: true,
      },
    });
    if (!event) {
      throw new ApiHttpError('NOT_FOUND', 'Event not found in this workspace.', 404);
    }
    return event;
  }

  const eventName = normalizeEventName(args.eventName || '');
  if (!eventName) return null;

  const events = await tx.event.findMany({
    where: {
      workspaceId: args.workspaceId,
      name: {
        equals: eventName,
        mode: 'insensitive',
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 2,
    select: {
      id: true,
    },
  });

  if (events.length === 0) {
    throw new ApiHttpError('NOT_FOUND', 'Event name was not found in this workspace.', 404);
  }
  if (events.length > 1) {
    throw new ApiHttpError(
      'CONFLICT',
      'Multiple events matched this name. Use eventId.',
      409
    );
  }

  return events[0];
}

async function createPendingIdentityTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    conversationId: string;
    planId: string;
    requestedByLinkId: string;
    reason: string;
    governorIdRaw?: string | null;
    governorNameRaw: string;
    eventId?: string | null;
    payload: Record<string, unknown>;
    candidates: Array<{ governorDbId: string; governorGameId: string; governorName: string }>;
  }
): Promise<AssistantPendingIdentity> {
  return tx.assistantPendingIdentity.create({
    data: {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      planId: args.planId,
      requestedByLinkId: args.requestedByLinkId,
      status: AssistantPendingIdentityStatus.PENDING,
      reason: sanitizePrintable(args.reason, 320),
      governorIdRaw: String(args.governorIdRaw || '').trim() || null,
      governorNameRaw: normalizeGovernorName(args.governorNameRaw),
      eventId: args.eventId || null,
      payload: args.payload as Prisma.InputJsonValue,
      candidateGovernorIds:
        args.candidates.length > 0
          ? (args.candidates as unknown as Prisma.InputJsonValue)
          : undefined,
    },
  });
}

async function executeActionTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    conversationId: string;
    planId: string;
    action: AssistantAction;
    accessLink: AccessLink;
  }
): Promise<
  | {
      status: 'executed';
      result: Record<string, unknown>;
    }
  | {
      status: 'pending_identity';
      pendingIdentityId: string;
      reason: string;
      candidates: Array<{ governorDbId: string; governorGameId: string; governorName: string }>;
    }
> {
  const parsed = assistantActionSchema.parse(args.action.request);

  switch (parsed.type) {
    case 'register_player': {
      const result = await registerGovernorTx(tx, {
        workspaceId: args.workspaceId,
        governorId: normalizeDigits(parsed.governorId, 24),
        name: normalizeGovernorName(parsed.name),
        alliance: sanitizePrintable(parsed.alliance || '', 80) || '',
      });

      return {
        status: 'executed',
        result: {
          actionType: parsed.type,
          created: result.created,
          governor: result.governor,
        },
      };
    }

    case 'update_player': {
      const target = await resolveGovernorForMutationTx(tx, {
        workspaceId: args.workspaceId,
        governorDbId: parsed.governorDbId,
        governorId: parsed.governorId,
        governorName: parsed.governorName,
      });

      const updated = await updateGovernorTx(tx, {
        workspaceId: args.workspaceId,
        governorDbId: target.id,
        name: parsed.name == null ? undefined : normalizeGovernorName(parsed.name),
        alliance:
          parsed.alliance == null ? undefined : sanitizePrintable(parsed.alliance, 80),
        governorId:
          parsed.newGovernorId == null ? undefined : normalizeDigits(parsed.newGovernorId, 24),
      });

      return {
        status: 'executed',
        result: {
          actionType: parsed.type,
          governor: updated,
        },
      };
    }

    case 'delete_player': {
      const target = await resolveGovernorForMutationTx(tx, {
        workspaceId: args.workspaceId,
        governorDbId: parsed.governorDbId,
        governorId: parsed.governorId,
        governorName: parsed.governorName,
      });

      const deleted = await deleteGovernorTx(tx, {
        workspaceId: args.workspaceId,
        governorDbId: target.id,
      });

      return {
        status: 'executed',
        result: {
          actionType: parsed.type,
          ...deleted,
        },
      };
    }

    case 'create_event': {
      const created = await createEventTx(tx, {
        workspaceId: args.workspaceId,
        name: normalizeEventName(parsed.name),
        description:
          parsed.description == null ? null : sanitizePrintable(parsed.description, 500),
        eventType: parsed.eventType || EventType.CUSTOM,
      });

      return {
        status: 'executed',
        result: {
          actionType: parsed.type,
          event: {
            ...created,
            startsAt: toIso(created.startsAt),
            endsAt: toIso(created.endsAt),
            createdAt: created.createdAt.toISOString(),
          },
        },
      };
    }

    case 'delete_event': {
      const eventRef = await resolveEventForActionTx(tx, {
        workspaceId: args.workspaceId,
        eventId: parsed.eventId,
        eventName: parsed.eventName,
      });

      if (!eventRef?.id) {
        throw new ApiHttpError('NOT_FOUND', 'Event not found in this workspace.', 404);
      }

      const deleted = await deleteEventTx(tx, {
        workspaceId: args.workspaceId,
        eventId: eventRef.id,
      });

      return {
        status: 'executed',
        result: {
          actionType: parsed.type,
          ...deleted,
        },
      };
    }

    case 'record_profile_stats': {
      const power = parseMetricBigInt(parsed.power, 'power');
      const killPoints = parseMetricBigInt(parsed.killPoints, 'killPoints');
      const t4Kills = parseMetricBigInt(parsed.t4Kills ?? 0, 't4Kills');
      const t5Kills = parseMetricBigInt(parsed.t5Kills ?? 0, 't5Kills');
      const deads = parseMetricBigInt(parsed.deads, 'deads');

      const eventRef = await resolveEventForActionTx(tx, {
        workspaceId: args.workspaceId,
        eventId: parsed.eventId,
        eventName: parsed.eventName,
      });

      const governorId = String(parsed.governorId || '').trim() || null;
      const governorName = normalizeGovernorName(parsed.governorName || '');

      const resolved = await resolveGovernorForStatsTx(tx, {
        workspaceId: args.workspaceId,
        governorGameId: governorId,
        governorName: governorName || null,
      });

      if (resolved.status !== 'resolved') {
        const pendingIdentity = await createPendingIdentityTx(tx, {
          workspaceId: args.workspaceId,
          conversationId: args.conversationId,
          planId: args.planId,
          requestedByLinkId: args.accessLink.id,
          reason: resolved.reason,
          governorIdRaw: governorId,
          governorNameRaw: governorName || '(unknown)',
          eventId: eventRef?.id || null,
          payload: {
            actionId: args.action.id,
            actionType: parsed.type,
            governorIdRaw: governorId,
            governorNameRaw: governorName,
            eventId: eventRef?.id || null,
            power: power.toString(),
            killPoints: killPoints.toString(),
            t4Kills: t4Kills.toString(),
            t5Kills: t5Kills.toString(),
            deads: deads.toString(),
            confidencePct:
              parsed.confidencePct == null
                ? null
                : Math.max(0, Math.min(100, Number(parsed.confidencePct))),
          },
          candidates: resolved.candidates,
        });

        return {
          status: 'pending_identity',
          pendingIdentityId: pendingIdentity.id,
          reason: resolved.reason,
          candidates: resolved.candidates,
        };
      }

      const write = await writeProfileStatsTx(tx, {
        workspaceId: args.workspaceId,
        governorDbId: resolved.governor.governorDbId,
        governorName: resolved.governor.governorName,
        eventId: eventRef?.id || null,
        power,
        killPoints,
        t4Kills,
        t5Kills,
        deads,
        confidencePct:
          parsed.confidencePct == null
            ? undefined
            : Math.max(0, Math.min(100, Number(parsed.confidencePct))),
        changedByLinkId: args.accessLink.id,
        reason: 'Assistant confirmed plan execution',
      });

      return {
        status: 'executed',
        result: {
          actionType: parsed.type,
          governor: resolved.governor,
          eventId: write.eventId,
          snapshotId: write.snapshotId,
          anomalyCount: write.anomalyCount,
        },
      };
    }

    default:
      throw new ApiHttpError('VALIDATION_ERROR', 'Unsupported assistant action type.', 400);
  }
}

export async function listAssistantConversationMessages(args: {
  workspaceId: string;
  conversationId: string;
  accessLink: AccessLink;
}) {
  await assertConversationAccess({
    workspaceId: args.workspaceId,
    conversationId: args.conversationId,
    accessLink: args.accessLink,
  });

  const [messages, plans, pendingIdentities] = await Promise.all([
    prisma.assistantMessage.findMany({
      where: {
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.assistantPlan.findMany({
      where: {
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        actions: {
          orderBy: { actionIndex: 'asc' },
        },
      },
    }),
    prisma.assistantPendingIdentity.findMany({
      where: {
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

  return {
    messages: messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      attachments: msg.attachments || [],
      model: msg.model,
      mistralEntryId: msg.mistralEntryId,
      meta:
        msg.mistralPayload && typeof msg.mistralPayload === 'object'
          ? (asJsonObject(msg.mistralPayload).meta || null)
          : null,
      createdAt: msg.createdAt.toISOString(),
    })),
    plans: plans.map((plan) => ({
      id: plan.id,
      summary: plan.summary,
      status: plan.status,
      actionsJson: plan.actionsJson,
      confirmationToken: plan.confirmationToken,
      confirmedAt: toIso(plan.confirmedAt),
      executedAt: toIso(plan.executedAt),
      deniedAt: toIso(plan.deniedAt),
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      actions: plan.actions.map((action) => ({
        id: action.id,
        actionType: action.actionType,
        actionIndex: action.actionIndex,
        status: action.status,
        request: action.request,
        result: action.result,
        error: action.error,
        executedAt: toIso(action.executedAt),
      })),
    })),
    pendingIdentities: pendingIdentities.map((row) => ({
      id: row.id,
      status: row.status,
      reason: row.reason,
      governorIdRaw: row.governorIdRaw,
      governorNameRaw: row.governorNameRaw,
      eventId: row.eventId,
      payload: row.payload,
      candidateGovernorIds: row.candidateGovernorIds,
      resolvedGovernorId: row.resolvedGovernorId,
      resolvedByLinkId: row.resolvedByLinkId,
      resolutionNote: row.resolutionNote,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      resolvedAt: toIso(row.resolvedAt),
    })),
  };
}

export async function postAssistantMessage(args: {
  workspaceId: string;
  conversationId: string;
  accessLink: AccessLink;
  text: string;
  attachments: AssistantAttachmentInput[];
}) {
  if (!sanitizePrintable(args.text, 8000) && args.attachments.length === 0) {
    throw new ApiHttpError('VALIDATION_ERROR', 'Message text or at least one image is required.', 400);
  }

  const conversation = await assertConversationAccess({
    workspaceId: args.workspaceId,
    conversationId: args.conversationId,
    accessLink: args.accessLink,
  });
  const settings = await readAssistantSettings(args.workspaceId);

  const userText = sanitizePrintable(args.text, 8000);
  const stageStartedAt = Date.now();
  const evidence = await extractAttachmentEvidence({
    settings,
    attachments: args.attachments,
  });
  const ocrMarkdownByImage = evidence.evidence
    .map((row) => ({
      fileName: row.fileName,
      markdown: row.markdown,
    }))
    .filter((row) => row.markdown);

  const userMessageAttachments = args.attachments.map((attachment) => ({
    artifactId: attachment.artifactId,
    url: attachment.url,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  }));

  const userMessage = await prisma.assistantMessage.create({
    data: {
      conversationId: conversation.id,
      workspaceId: args.workspaceId,
      role: AssistantMessageRole.USER,
      content: userText || '[image message]',
      attachments: userMessageAttachments as Prisma.InputJsonValue,
      mistralPayload: {
        stage: 'user_input',
        evidenceDiagnostics: evidence.diagnostics,
      } as Prisma.InputJsonValue,
    },
  });

  const conversationInputs = buildConversationInputs({
    userText,
    attachments: args.attachments,
    ocrMarkdownByImage,
  });

  let mistralConversationId = conversation.mistralConversationId || null;
  let initialResponse: MistralConversationResponse;

  if (mistralConversationId) {
    initialResponse = await appendMistralConversation({
      conversationId: mistralConversationId,
      inputs: conversationInputs,
      store: true,
    });
  } else {
    initialResponse = await startMistralConversation({
      model: settings.assistantModel,
      instructions: [
        'You are the assistant for a Rise of Kingdoms workspace.',
        'Execute read actions immediately when helpful and use the results in your response.',
        'You can propose typed actions that mutate workspace data.',
        'Return concise text guidance and function calls for actionable steps.',
        'Do not execute actions directly; they require explicit plan confirmation.',
      ].join(' '),
      inputs: conversationInputs,
      tools: mistralReadTools(),
      store: true,
    });
    mistralConversationId = initialResponse.conversation_id;
  }
  mistralConversationId = mistralConversationId || initialResponse.conversation_id;

  let planningResponse = initialResponse;
  let functionCallPlan = parseActionsFromFunctionCalls(planningResponse);
  const readExecutions: AssistantReadExecution[] = [];
  const resolvedToolCallIds = new Set<string>();

  if (mistralConversationId) {
    for (let loopIndex = 0; loopIndex < MAX_READ_TOOL_LOOPS; loopIndex += 1) {
      const pendingReadCalls = functionCallPlan.readCalls.filter(
        (call) => call.toolCallId && !resolvedToolCallIds.has(call.toolCallId)
      );
      if (pendingReadCalls.length === 0) {
        break;
      }

      const executed = await executeReadActions({
        workspaceId: args.workspaceId,
        calls: pendingReadCalls,
      });
      readExecutions.push(...executed);

      const functionResults = executed
        .filter((entry) => typeof entry.toolCallId === 'string' && entry.toolCallId.length > 0)
        .map((entry) => {
          const toolCallId = String(entry.toolCallId);
          resolvedToolCallIds.add(toolCallId);
          return {
            type: 'function.result',
            tool_call_id: toolCallId,
            result: safeJsonText(
              {
                actionType: entry.actionType,
                summary: entry.summary,
                error: entry.error || null,
                result: entry.result,
              },
              16_000
            ),
          };
        });

      if (functionResults.length === 0) {
        break;
      }

      planningResponse = await appendMistralConversation({
        conversationId: mistralConversationId,
        inputs: functionResults,
        store: true,
      });
      functionCallPlan = parseActionsFromFunctionCalls(planningResponse);
    }
  }

  let assistantText =
    pickConversationAssistantText(planningResponse) ||
    pickConversationAssistantText(initialResponse);
  let plannedActions = functionCallPlan.writeActions;
  let fallbackPlan: AssistantPlanOutput | null = null;
  let planningSource: 'tool_calls' | 'structured_output' = 'tool_calls';
  const readContextText = buildReadResultsPrompt(readExecutions);

  if (plannedActions.length === 0) {
    const workspaceContext = await buildWorkspaceContext(args.workspaceId);
    const fallbackPrompt = buildFallbackPlanningPrompt({
      userText,
      ocrMarkdownByImage,
      governors: workspaceContext.governors,
      events: workspaceContext.events,
      readContextText,
    });

    const structured = await runMistralStructuredOutput<AssistantPlanOutput>({
      instructions:
        'Produce assistantResponse, summary, and actions for workspace mutation planning. Output must follow schema exactly.',
      input: fallbackPrompt,
      schemaName: 'assistant_action_plan',
      schema: assistantActionOutputJsonSchema,
      model: settings.assistantModel,
      store: false,
    });

    fallbackPlan = assistantPlanOutputSchema.parse(structured.parsed);
    plannedActions = normalizePlannedActions(fallbackPlan.actions);
    planningSource = 'structured_output';

    if (!assistantText) {
      assistantText = sanitizePrintable(fallbackPlan.assistantResponse, 5000);
    }
  }

  const preflight = preflightWriteActions(plannedActions);
  plannedActions = preflight.accepted;
  const droppedActions = [
    ...preflight.dropped,
    ...functionCallPlan.droppedCalls.map((row, index) => ({
      index,
      type: row.name,
      reason: row.reason,
    })),
  ];

  if (!assistantText) {
    assistantText =
      plannedActions.length > 0
        ? `I prepared a ${plannedActions.length}-action plan. Review and confirm to execute.`
        : readExecutions.length > 0
          ? 'I completed the requested read actions. No write actions were proposed.'
          : 'I analyzed the message and screenshots. No write actions were proposed.';
  }

  if (droppedActions.length > 0) {
    assistantText = [
      assistantText,
      `Dropped ${droppedActions.length} unsupported/underspecified action(s) during preflight.`,
    ].join('\n\n');
  }

  const summary =
    sanitizePrintable(fallbackPlan?.summary || '', 500) ||
    (plannedActions.length > 0
      ? `Proposed ${plannedActions.length} action${plannedActions.length === 1 ? '' : 's'} pending confirmation.`
      : 'No write actions proposed.');

  const originalConversationMetadata = asJsonObject(conversation.metadata);

  const result = await prisma.$transaction(async (tx) => {
    const updatedConversation = await tx.assistantConversation.update({
      where: { id: conversation.id },
      data: {
        mistralConversationId,
        model: settings.assistantModel,
        title:
          conversation.title ||
          sanitizePrintable(userText || args.attachments[0]?.fileName || 'Assistant Conversation', 120),
        status: AssistantConversationStatus.ACTIVE,
        metadata: {
          ...originalConversationMetadata,
          lastPlanningSource: planningSource,
          ocrImages: args.attachments.length,
          lastReadActionCount: readExecutions.length,
          lastDroppedActionCount: droppedActions.length,
        } as Prisma.InputJsonValue,
      },
    });

    const assistantMessage = await tx.assistantMessage.create({
      data: {
        conversationId: conversation.id,
        workspaceId: args.workspaceId,
        role: AssistantMessageRole.ASSISTANT,
        content: assistantText,
        model: settings.assistantModel,
        mistralPayload: {
          initialConversationResponse: initialResponse,
          planningConversationResponse: planningResponse,
          fallbackPlan,
          planningSource,
          meta: {
            readExecutions,
            droppedActions,
            evidenceDiagnostics: evidence.diagnostics,
            totalLatencyMs: Date.now() - stageStartedAt,
            sourceCallCount: functionCallPlan.rawCalls.length,
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });

    let plan:
      | {
          id: string;
          status: AssistantPlanStatus;
          summary: string;
          confirmationToken: string | null;
          actions: Array<{
            id: string;
            actionType: string;
            actionIndex: number;
            status: string;
            request: Prisma.JsonValue;
          }>;
        }
      | null = null;

    if (plannedActions.length > 0) {
      const confirmationToken = crypto.randomUUID();
      const createdPlan = await tx.assistantPlan.create({
        data: {
          conversationId: conversation.id,
          workspaceId: args.workspaceId,
          createdByLinkId: args.accessLink.id,
          summary,
          status: AssistantPlanStatus.PENDING,
          confirmationToken,
          actionsJson: {
            confirmationMode:
              functionCallPlan.pendingToolCallIds.length > 0
                ? 'mistral_tool_confirmations'
                : 'app_managed',
            pendingToolCallIds: functionCallPlan.pendingToolCallIds,
            source: planningSource,
            actions: plannedActions,
            readExecutions,
            droppedActions,
          } as Prisma.InputJsonValue,
        },
      });

      const createdActions = await Promise.all(
        plannedActions.map((action, actionIndex) =>
          tx.assistantAction.create({
            data: {
              planId: createdPlan.id,
              workspaceId: args.workspaceId,
              actionType: mapActionTypeToPrisma(action.type),
              actionIndex,
              status: AssistantActionStatus.PENDING,
              request: action as unknown as Prisma.InputJsonValue,
            },
          })
        )
      );

      plan = {
        id: createdPlan.id,
        status: createdPlan.status,
        summary: createdPlan.summary,
        confirmationToken: createdPlan.confirmationToken,
        actions: createdActions.map((action) => ({
          id: action.id,
          actionType: action.actionType,
          actionIndex: action.actionIndex,
          status: action.status,
          request: action.request,
        })),
      };

      await tx.assistantConversation.update({
        where: { id: updatedConversation.id },
        data: {
          metadata: {
            ...asJsonObject(updatedConversation.metadata),
            lastPlanId: createdPlan.id,
          } as Prisma.InputJsonValue,
        },
      });
    }

    return {
      conversation: {
        id: updatedConversation.id,
        workspaceId: updatedConversation.workspaceId,
        title: updatedConversation.title,
        status: updatedConversation.status,
        model: updatedConversation.model,
        mistralConversationId: updatedConversation.mistralConversationId,
        createdAt: updatedConversation.createdAt.toISOString(),
        updatedAt: updatedConversation.updatedAt.toISOString(),
      },
      userMessage: {
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        attachments: userMessage.attachments || [],
        createdAt: userMessage.createdAt.toISOString(),
      },
      assistantMessage: {
        id: assistantMessage.id,
        role: assistantMessage.role,
        content: assistantMessage.content,
        model: assistantMessage.model,
        createdAt: assistantMessage.createdAt.toISOString(),
        meta: {
          readExecutions,
          droppedActions,
          evidenceDiagnostics: evidence.diagnostics,
        },
      },
      readExecutions,
      plan,
    };
  });

  return result;
}

function validatePlanWorkspace(planWorkspaceId: string, workspaceId: string) {
  if (planWorkspaceId !== workspaceId) {
    throw new ApiHttpError('FORBIDDEN', 'Plan does not belong to this workspace.', 403);
  }
}

async function tryAppendToolConfirmations(args: {
  planJson: Prisma.JsonValue | null;
  conversationId: string | null;
  confirmation: 'allow' | 'deny';
}) {
  if (!args.conversationId) return;

  const metadata = parsePlanMetadata(args.planJson);
  if (metadata.confirmationMode !== 'mistral_tool_confirmations') return;
  if (metadata.pendingToolCallIds.length === 0) return;

  await appendMistralConversation({
    conversationId: args.conversationId,
    toolConfirmations: metadata.pendingToolCallIds.map((toolCallId) => ({
      tool_call_id: toolCallId,
      confirmation: args.confirmation,
    })),
    store: true,
  });
}

export async function confirmAssistantPlan(args: {
  workspaceId: string;
  planId: string;
  accessLink: AccessLink;
}) {
  const plan = await prisma.assistantPlan.findUnique({
    where: { id: args.planId },
    include: {
      conversation: {
        select: {
          id: true,
          mistralConversationId: true,
        },
      },
      actions: {
        orderBy: { actionIndex: 'asc' },
      },
    },
  });

  if (!plan) {
    throw new ApiHttpError('NOT_FOUND', 'Assistant plan not found.', 404);
  }

  validatePlanWorkspace(plan.workspaceId, args.workspaceId);
  if (args.accessLink.workspaceId !== args.workspaceId) {
    throw new ApiHttpError('FORBIDDEN', 'Access link is not valid for this workspace.', 403);
  }

  const metadata = parsePlanMetadata(plan.actionsJson);
  if (metadata.actions.length === 0) {
    throw new ApiHttpError('VALIDATION_ERROR', 'Plan has no valid actions to execute.', 400);
  }

  if (plan.status === AssistantPlanStatus.DENIED) {
    throw new ApiHttpError('CONFLICT', 'Plan was denied and cannot be executed.', 409);
  }

  if (plan.status === AssistantPlanStatus.EXECUTED) {
    return {
      idempotentReplay: true,
      plan: {
        id: plan.id,
        status: plan.status,
        summary: plan.summary,
        confirmedAt: toIso(plan.confirmedAt),
        executedAt: toIso(plan.executedAt),
      },
      actions: plan.actions.map((action) => ({
        id: action.id,
        actionType: action.actionType,
        status: action.status,
        result: action.result,
        error: action.error,
      })),
    };
  }

  for (const action of metadata.actions) {
    const requiredRole = requireRoleForAction({
      actionType: action.type,
    });
    requireRole(args.accessLink, requiredRole);
  }

  try {
    await tryAppendToolConfirmations({
      planJson: plan.actionsJson,
      conversationId: plan.conversation.mistralConversationId,
      confirmation: 'allow',
    });
  } catch (error) {
    console.warn('[assistant] failed to append tool confirmations (allow)', error);
  }

  const execution = await prisma.$transaction(async (tx) => {
    const mutablePlan = await tx.assistantPlan.findUnique({
      where: { id: args.planId },
      include: {
        actions: {
          orderBy: { actionIndex: 'asc' },
        },
      },
    });

    if (!mutablePlan) {
      throw new ApiHttpError('NOT_FOUND', 'Assistant plan not found.', 404);
    }

    if (mutablePlan.status === AssistantPlanStatus.DENIED) {
      throw new ApiHttpError('CONFLICT', 'Plan was denied and cannot be executed.', 409);
    }

    if (mutablePlan.status === AssistantPlanStatus.EXECUTED) {
      return {
        idempotentReplay: true,
        plan: mutablePlan,
        actions: mutablePlan.actions,
      };
    }

    const now = new Date();
    if (!mutablePlan.confirmedAt) {
      await tx.assistantPlan.update({
        where: { id: mutablePlan.id },
        data: {
          status: AssistantPlanStatus.CONFIRMED,
          confirmedAt: now,
        },
      });
    }

    const actionResults: Array<{
      id: string;
      actionType: string;
      status: AssistantActionStatus;
      result: Prisma.JsonValue | null;
      error: string | null;
    }> = [];

    for (const action of mutablePlan.actions) {
      if (action.status === AssistantActionStatus.EXECUTED) {
        actionResults.push({
          id: action.id,
          actionType: action.actionType,
          status: action.status,
          result: action.result,
          error: action.error,
        });
        continue;
      }

      const currentResult = asJsonObject(action.result);
      if (
        action.status === AssistantActionStatus.SKIPPED &&
        typeof currentResult.pendingIdentityId === 'string' &&
        currentResult.pendingIdentityId.trim()
      ) {
        actionResults.push({
          id: action.id,
          actionType: action.actionType,
          status: action.status,
          result: action.result,
          error: action.error,
        });
        continue;
      }

      try {
        const executionResult = await executeActionTx(tx, {
          workspaceId: args.workspaceId,
          conversationId: mutablePlan.conversationId,
          planId: mutablePlan.id,
          action,
          accessLink: args.accessLink,
        });

        if (executionResult.status === 'executed') {
          const updated = await tx.assistantAction.update({
            where: { id: action.id },
            data: {
              status: AssistantActionStatus.EXECUTED,
              result: executionResult.result as Prisma.InputJsonValue,
              error: null,
              executedAt: new Date(),
            },
          });

          actionResults.push({
            id: updated.id,
            actionType: updated.actionType,
            status: updated.status,
            result: updated.result,
            error: updated.error,
          });
        } else {
          const updated = await tx.assistantAction.update({
            where: { id: action.id },
            data: {
              status: AssistantActionStatus.SKIPPED,
              result: {
                pendingIdentityId: executionResult.pendingIdentityId,
                reason: executionResult.reason,
                candidates: executionResult.candidates,
              } as Prisma.InputJsonValue,
              error: null,
              executedAt: new Date(),
            },
          });

          actionResults.push({
            id: updated.id,
            actionType: updated.actionType,
            status: updated.status,
            result: updated.result,
            error: updated.error,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Action execution failed.';
        const updated = await tx.assistantAction.update({
          where: { id: action.id },
          data: {
            status: AssistantActionStatus.FAILED,
            error: sanitizePrintable(message, 400),
            executedAt: new Date(),
          },
        });

        actionResults.push({
          id: updated.id,
          actionType: updated.actionType,
          status: updated.status,
          result: updated.result,
          error: updated.error,
        });
      }
    }

    const pendingIdentityCount = await tx.assistantPendingIdentity.count({
      where: {
        planId: mutablePlan.id,
        status: AssistantPendingIdentityStatus.PENDING,
      },
    });

    const hasFailures = actionResults.some((entry) => entry.status === AssistantActionStatus.FAILED);
    const finalStatus =
      pendingIdentityCount > 0
        ? AssistantPlanStatus.CONFIRMED
        : hasFailures
          ? AssistantPlanStatus.FAILED
          : AssistantPlanStatus.EXECUTED;

    const updatedPlan = await tx.assistantPlan.update({
      where: { id: mutablePlan.id },
      data: {
        status: finalStatus,
        executedAt: finalStatus === AssistantPlanStatus.EXECUTED ? new Date() : mutablePlan.executedAt,
      },
    });

    await tx.assistantConversation.update({
      where: { id: mutablePlan.conversationId },
      data: {
        updatedAt: new Date(),
      },
    });

    return {
      idempotentReplay: false,
      plan: updatedPlan,
      actions: actionResults,
      pendingIdentityCount,
    };
  });

  return {
    idempotentReplay: execution.idempotentReplay,
    plan: {
      id: execution.plan.id,
      status: execution.plan.status,
      summary: execution.plan.summary,
      confirmedAt: toIso(execution.plan.confirmedAt),
      executedAt: toIso(execution.plan.executedAt),
      deniedAt: toIso(execution.plan.deniedAt),
      updatedAt: execution.plan.updatedAt.toISOString(),
    },
    actions: execution.actions.map((action) => ({
      id: action.id,
      actionType: action.actionType,
      status: action.status,
      result: action.result,
      error: action.error,
    })),
    pendingIdentityCount: execution.pendingIdentityCount || 0,
  };
}

export async function denyAssistantPlan(args: {
  workspaceId: string;
  planId: string;
  accessLink: AccessLink;
}) {
  const plan = await prisma.assistantPlan.findUnique({
    where: { id: args.planId },
    include: {
      conversation: {
        select: {
          mistralConversationId: true,
        },
      },
      actions: {
        orderBy: { actionIndex: 'asc' },
      },
    },
  });

  if (!plan) {
    throw new ApiHttpError('NOT_FOUND', 'Assistant plan not found.', 404);
  }

  validatePlanWorkspace(plan.workspaceId, args.workspaceId);
  if (args.accessLink.workspaceId !== args.workspaceId) {
    throw new ApiHttpError('FORBIDDEN', 'Access link is not valid for this workspace.', 403);
  }

  if (plan.status === AssistantPlanStatus.EXECUTED) {
    throw new ApiHttpError('CONFLICT', 'Plan already executed and cannot be denied.', 409);
  }

  try {
    await tryAppendToolConfirmations({
      planJson: plan.actionsJson,
      conversationId: plan.conversation.mistralConversationId,
      confirmation: 'deny',
    });
  } catch (error) {
    console.warn('[assistant] failed to append tool confirmations (deny)', error);
  }

  const denied = await prisma.$transaction(async (tx) => {
    const updated = await tx.assistantPlan.update({
      where: { id: plan.id },
      data: {
        status: AssistantPlanStatus.DENIED,
        deniedAt: new Date(),
      },
    });

    await tx.assistantConversation.update({
      where: { id: updated.conversationId },
      data: {
        updatedAt: new Date(),
      },
    });

    return updated;
  });

  return {
    id: denied.id,
    status: denied.status,
    summary: denied.summary,
    deniedAt: toIso(denied.deniedAt),
    updatedAt: denied.updatedAt.toISOString(),
  };
}

const pendingIdentityPayloadSchema = assistantActionSchema
  .refine((value): value is RecordProfileStatsActionInput => value.type === 'record_profile_stats')
  .transform((value) => value as RecordProfileStatsActionInput);

export async function resolveAssistantPendingIdentity(args: {
  workspaceId: string;
  pendingIdentityId: string;
  governorDbId: string;
  eventId?: string | null;
  note?: string | null;
  accessLink: AccessLink;
}) {
  if (args.accessLink.workspaceId !== args.workspaceId) {
    throw new ApiHttpError('FORBIDDEN', 'Access link is not valid for this workspace.', 403);
  }
  requireRole(args.accessLink, WorkspaceRole.EDITOR);

  const result = await prisma.$transaction(async (tx) => {
    const pending = await tx.assistantPendingIdentity.findUnique({
      where: { id: args.pendingIdentityId },
    });

    if (!pending || pending.workspaceId !== args.workspaceId) {
      throw new ApiHttpError('NOT_FOUND', 'Pending identity not found.', 404);
    }

    if (pending.status !== AssistantPendingIdentityStatus.PENDING) {
      return {
        idempotentReplay: true,
        pending,
        action: null,
      };
    }

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
      throw new ApiHttpError('NOT_FOUND', 'Governor not found in this workspace.', 404);
    }

    const payload = asJsonObject(pending.payload);
    const rawAction = asJsonObject(payload.action);
    const parsedAction = pendingIdentityPayloadSchema.parse({
      ...rawAction,
      type: 'record_profile_stats',
      governorId: payload.governorIdRaw || rawAction.governorId || null,
      governorName: payload.governorNameRaw || rawAction.governorName || null,
      eventId: payload.eventId || rawAction.eventId || null,
      power: payload.power || rawAction.power || '0',
      killPoints: payload.killPoints || rawAction.killPoints || '0',
      t4Kills: payload.t4Kills || rawAction.t4Kills || '0',
      t5Kills: payload.t5Kills || rawAction.t5Kills || '0',
      deads: payload.deads || rawAction.deads || '0',
      confidencePct: payload.confidencePct || rawAction.confidencePct || undefined,
    });

    const eventRef = await resolveEventForActionTx(tx, {
      workspaceId: args.workspaceId,
      eventId: args.eventId || parsedAction.eventId || pending.eventId,
      eventName: parsedAction.eventName || null,
    });

    const write = await writeProfileStatsTx(tx, {
      workspaceId: args.workspaceId,
      governorDbId: governor.id,
      governorName: governor.name,
      eventId: eventRef?.id || null,
      power: parseMetricBigInt(parsedAction.power, 'power'),
      killPoints: parseMetricBigInt(parsedAction.killPoints, 'killPoints'),
      t4Kills: parseMetricBigInt(parsedAction.t4Kills ?? 0, 't4Kills'),
      t5Kills: parseMetricBigInt(parsedAction.t5Kills ?? 0, 't5Kills'),
      deads: parseMetricBigInt(parsedAction.deads, 'deads'),
      confidencePct: parsedAction.confidencePct,
      changedByLinkId: args.accessLink.id,
      reason: 'Assistant pending identity resolution',
    });

    const updatedPending = await tx.assistantPendingIdentity.update({
      where: { id: pending.id },
      data: {
        status: AssistantPendingIdentityStatus.RESOLVED,
        resolvedGovernorId: governor.id,
        resolvedByLinkId: args.accessLink.id,
        resolvedAt: new Date(),
        resolutionNote: sanitizePrintable(args.note || '', 500) || null,
        eventId: eventRef?.id || pending.eventId,
      },
    });

    const actionId = String(payload.actionId || '').trim();
    let updatedAction: AssistantAction | null = null;
    if (actionId) {
      const existingAction = await tx.assistantAction.findFirst({
        where: {
          id: actionId,
          planId: pending.planId || undefined,
        },
      });

      if (existingAction) {
        updatedAction = await tx.assistantAction.update({
          where: { id: existingAction.id },
          data: {
            status: AssistantActionStatus.EXECUTED,
            result: {
              actionType: 'record_profile_stats',
              resolvedByPendingIdentityId: pending.id,
              governor: {
                id: governor.id,
                governorId: governor.governorId,
                name: governor.name,
              },
              eventId: write.eventId,
              snapshotId: write.snapshotId,
              anomalyCount: write.anomalyCount,
            } as Prisma.InputJsonValue,
            error: null,
            executedAt: new Date(),
          },
        });
      }
    }

    if (pending.planId) {
      const [remainingPending, failedCount] = await Promise.all([
        tx.assistantPendingIdentity.count({
          where: {
            planId: pending.planId,
            status: AssistantPendingIdentityStatus.PENDING,
          },
        }),
        tx.assistantAction.count({
          where: {
            planId: pending.planId,
            status: AssistantActionStatus.FAILED,
          },
        }),
      ]);

      await tx.assistantPlan.update({
        where: { id: pending.planId },
        data: {
          status:
            remainingPending > 0
              ? AssistantPlanStatus.CONFIRMED
              : failedCount > 0
                ? AssistantPlanStatus.FAILED
                : AssistantPlanStatus.EXECUTED,
          executedAt:
            remainingPending === 0 && failedCount === 0
              ? new Date()
              : undefined,
        },
      });
    }

    if (pending.conversationId) {
      await tx.assistantConversation.update({
        where: { id: pending.conversationId },
        data: {
          updatedAt: new Date(),
        },
      });
    }

    return {
      idempotentReplay: false,
      pending: updatedPending,
      action: updatedAction,
    };
  });

  return {
    idempotentReplay: result.idempotentReplay,
    pendingIdentity: {
      id: result.pending.id,
      status: result.pending.status,
      reason: result.pending.reason,
      governorIdRaw: result.pending.governorIdRaw,
      governorNameRaw: result.pending.governorNameRaw,
      eventId: result.pending.eventId,
      resolvedGovernorId: result.pending.resolvedGovernorId,
      resolvedByLinkId: result.pending.resolvedByLinkId,
      resolutionNote: result.pending.resolutionNote,
      resolvedAt: toIso(result.pending.resolvedAt),
      updatedAt: result.pending.updatedAt.toISOString(),
    },
    action: result.action
      ? {
          id: result.action.id,
          status: result.action.status,
          result: result.action.result,
          error: result.action.error,
        }
      : null,
  };
}

export async function cleanupAssistantLogs(args?: {
  workspaceId?: string;
  fallbackRetentionDays?: number;
}) {
  const fallbackRetentionDays =
    Number.isFinite(args?.fallbackRetentionDays) && Number(args?.fallbackRetentionDays) > 0
      ? Number(args?.fallbackRetentionDays)
      : 180;

  const workspaceId = args?.workspaceId?.trim() || null;

  const settingsRows = workspaceId
    ? await prisma.workspaceSettings.findMany({
        where: { workspaceId },
        select: {
          workspaceId: true,
          assistantLogRetentionDays: true,
        },
      })
    : await prisma.workspaceSettings.findMany({
        select: {
          workspaceId: true,
          assistantLogRetentionDays: true,
        },
      });

  const retentionByWorkspace = new Map<string, number>();
  for (const row of settingsRows) {
    const retentionDays =
      Number.isFinite(row.assistantLogRetentionDays) && row.assistantLogRetentionDays > 0
        ? row.assistantLogRetentionDays
        : fallbackRetentionDays;
    retentionByWorkspace.set(row.workspaceId, retentionDays);
  }

  if (workspaceId && !retentionByWorkspace.has(workspaceId)) {
    retentionByWorkspace.set(workspaceId, fallbackRetentionDays);
  }

  const workspaces = [...retentionByWorkspace.entries()];
  let deletedMessages = 0;
  let deletedPlans = 0;
  let deletedPending = 0;
  let deletedConversations = 0;

  for (const [wsId, retentionDays] of workspaces) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const [messagesResult, pendingResult, planResult, conversationResult] = await Promise.all([
      prisma.assistantMessage.deleteMany({
        where: {
          workspaceId: wsId,
          createdAt: { lt: cutoff },
        },
      }),
      prisma.assistantPendingIdentity.deleteMany({
        where: {
          workspaceId: wsId,
          updatedAt: { lt: cutoff },
          status: { in: [AssistantPendingIdentityStatus.RESOLVED, AssistantPendingIdentityStatus.DENIED] },
        },
      }),
      prisma.assistantPlan.deleteMany({
        where: {
          workspaceId: wsId,
          updatedAt: { lt: cutoff },
          status: { in: [AssistantPlanStatus.EXECUTED, AssistantPlanStatus.DENIED, AssistantPlanStatus.FAILED] },
        },
      }),
      prisma.assistantConversation.deleteMany({
        where: {
          workspaceId: wsId,
          status: AssistantConversationStatus.ARCHIVED,
          updatedAt: { lt: cutoff },
        },
      }),
    ]);

    deletedMessages += messagesResult.count;
    deletedPending += pendingResult.count;
    deletedPlans += planResult.count;
    deletedConversations += conversationResult.count;
  }

  return {
    workspaces: workspaces.length,
    deletedMessages,
    deletedPlans,
    deletedPendingIdentities: deletedPending,
    deletedConversations,
  };
}
