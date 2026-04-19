import { EventType, type AssistantActionType as PrismaAssistantActionType } from '@prisma/client';
import { z } from 'zod';
import {
  type AssistantAnalyzerMode,
  type AssistantConfig,
  type ThreadAssistantConfig,
} from '@/lib/assistant/config';

export const ASSISTANT_ACTION_TYPES = [
  'register_player',
  'update_player',
  'delete_player',
  'create_event',
  'delete_event',
  'record_profile_stats',
] as const;

export const ASSISTANT_READ_ACTION_TYPES = [
  'read_workspace_overview',
  'read_governors',
  'read_governor_detail',
  'read_events',
  'read_event_detail',
  'read_scan_jobs',
  'read_scan_job_tasks',
  'read_profile_review_queue',
  'read_ranking_review_queue',
  'read_ranking_runs',
  'read_ranking_run_detail',
  'read_activity_weekly',
  'read_analytics',
  'read_compare',
  'read_semantic_search',
] as const;

export type AssistantActionType = (typeof ASSISTANT_ACTION_TYPES)[number];
export type AssistantReadActionType = (typeof ASSISTANT_READ_ACTION_TYPES)[number];

export const assistantActionTypeSchema = z.enum(ASSISTANT_ACTION_TYPES);
export const assistantReadActionTypeSchema = z.enum(ASSISTANT_READ_ACTION_TYPES);

const identifierRefinement = (
  value: { governorDbId?: string | null; governorId?: string | null; governorName?: string | null },
  ctx: z.RefinementCtx
) => {
  const hasIdentifier =
    Boolean(String(value.governorDbId || '').trim()) ||
    Boolean(String(value.governorId || '').trim()) ||
    Boolean(String(value.governorName || '').trim());

  if (!hasIdentifier) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one governor identifier is required (governorDbId, governorId, governorName).',
      path: ['governorId'],
    });
  }
};

export const registerPlayerActionSchema = z.object({
  type: z.literal('register_player'),
  governorId: z.string().min(1).max(24),
  name: z.string().min(1).max(80),
  alliance: z.string().max(80).optional().nullable(),
});

export const updatePlayerActionSchema = z
  .object({
    type: z.literal('update_player'),
    governorDbId: z.string().max(60).optional().nullable(),
    governorId: z.string().max(24).optional().nullable(),
    governorName: z.string().max(80).optional().nullable(),
    name: z.string().max(80).optional().nullable(),
    alliance: z.string().max(80).optional().nullable(),
    newGovernorId: z.string().max(24).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    identifierRefinement(value, ctx);
    const hasPatch =
      value.name != null || value.alliance != null || value.newGovernorId != null;
    if (!hasPatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one update field is required (name, alliance, newGovernorId).',
        path: ['name'],
      });
    }
  });

export const deletePlayerActionSchema = z
  .object({
    type: z.literal('delete_player'),
    governorDbId: z.string().max(60).optional().nullable(),
    governorId: z.string().max(24).optional().nullable(),
    governorName: z.string().max(80).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    identifierRefinement(value, ctx);
  });

export const createEventActionSchema = z.object({
  type: z.literal('create_event'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  eventType: z.nativeEnum(EventType).optional(),
});

export const deleteEventActionSchema = z
  .object({
    type: z.literal('delete_event'),
    eventId: z.string().max(60).optional().nullable(),
    eventName: z.string().max(120).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const hasIdentifier =
      Boolean(String(value.eventId || '').trim()) ||
      Boolean(String(value.eventName || '').trim());

    if (!hasIdentifier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'eventId or eventName is required.',
        path: ['eventId'],
      });
    }
  });

const metricValueSchema = z.union([z.string(), z.number(), z.bigint()]);

export const recordProfileStatsActionSchema = z
  .object({
    type: z.literal('record_profile_stats'),
    governorDbId: z.string().max(60).optional().nullable(),
    governorId: z.string().max(24).optional().nullable(),
    governorName: z.string().max(80).optional().nullable(),
    eventId: z.string().max(60).optional().nullable(),
    eventName: z.string().max(120).optional().nullable(),
    power: metricValueSchema,
    killPoints: metricValueSchema,
    t4Kills: metricValueSchema.optional(),
    t5Kills: metricValueSchema.optional(),
    deads: metricValueSchema,
    confidencePct: z.number().min(0).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    identifierRefinement(value, ctx);
  });

export const assistantActionSchema = z.union([
  registerPlayerActionSchema,
  updatePlayerActionSchema,
  deletePlayerActionSchema,
  createEventActionSchema,
  deleteEventActionSchema,
  recordProfileStatsActionSchema,
]);

const boundedLimitSchema = z.number().int().min(1).max(200).optional().nullable();
const boundedOffsetSchema = z.number().int().min(0).max(20_000).optional().nullable();

export const readWorkspaceOverviewActionSchema = z.object({
  type: z.literal('read_workspace_overview'),
  includeWeekly: z.boolean().optional().nullable(),
});

export const readGovernorsActionSchema = z.object({
  type: z.literal('read_governors'),
  search: z.string().max(80).optional().nullable(),
  includeWeekly: z.boolean().optional().nullable(),
  limit: boundedLimitSchema,
  offset: boundedOffsetSchema,
});

export const readGovernorDetailActionSchema = z
  .object({
    type: z.literal('read_governor_detail'),
    governorDbId: z.string().max(60).optional().nullable(),
    governorId: z.string().max(24).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const hasIdentifier =
      Boolean(String(value.governorDbId || '').trim()) ||
      Boolean(String(value.governorId || '').trim());
    if (!hasIdentifier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'governorDbId or governorId is required.',
        path: ['governorId'],
      });
    }
  });

export const readEventsActionSchema = z.object({
  type: z.literal('read_events'),
  search: z.string().max(120).optional().nullable(),
  includeClosed: z.boolean().optional().nullable(),
  limit: boundedLimitSchema,
  offset: boundedOffsetSchema,
});

export const readEventDetailActionSchema = z
  .object({
    type: z.literal('read_event_detail'),
    eventId: z.string().max(60).optional().nullable(),
    eventName: z.string().max(120).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const hasIdentifier =
      Boolean(String(value.eventId || '').trim()) ||
      Boolean(String(value.eventName || '').trim());
    if (!hasIdentifier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'eventId or eventName is required.',
        path: ['eventId'],
      });
    }
  });

export const readScanJobsActionSchema = z.object({
  type: z.literal('read_scan_jobs'),
  status: z.string().max(32).optional().nullable(),
  limit: boundedLimitSchema,
  offset: boundedOffsetSchema,
});

export const readScanJobTasksActionSchema = z.object({
  type: z.literal('read_scan_job_tasks'),
  scanJobId: z.string().min(1).max(60),
  status: z.string().max(120).optional().nullable(),
  limit: boundedLimitSchema,
  offset: boundedOffsetSchema,
});

export const readProfileReviewQueueActionSchema = z.object({
  type: z.literal('read_profile_review_queue'),
  status: z.string().max(120).optional().nullable(),
  severity: z.string().max(20).optional().nullable(),
  limit: boundedLimitSchema,
  offset: boundedOffsetSchema,
});

export const readRankingReviewQueueActionSchema = z.object({
  type: z.literal('read_ranking_review_queue'),
  status: z.string().max(120).optional().nullable(),
  rankingType: z.string().max(80).optional().nullable(),
  metricKey: z.string().max(80).optional().nullable(),
  limit: boundedLimitSchema,
  offset: boundedOffsetSchema,
});

export const readRankingRunsActionSchema = z.object({
  type: z.literal('read_ranking_runs'),
  eventId: z.string().max(60).optional().nullable(),
  rankingType: z.string().max(80).optional().nullable(),
  status: z.string().max(32).optional().nullable(),
  limit: boundedLimitSchema,
  offset: boundedOffsetSchema,
});

export const readRankingRunDetailActionSchema = z.object({
  type: z.literal('read_ranking_run_detail'),
  runId: z.string().min(1).max(60),
});

export const readActivityWeeklyActionSchema = z.object({
  type: z.literal('read_activity_weekly'),
  weekKey: z.string().max(24).optional().nullable(),
  alliances: z.array(z.string().max(20)).max(8).optional().nullable(),
});

export const readAnalyticsActionSchema = z.object({
  type: z.literal('read_analytics'),
  eventA: z.string().max(60).optional().nullable(),
  eventB: z.string().max(60).optional().nullable(),
  topN: z.number().int().min(3).max(50).optional().nullable(),
});

export const readCompareActionSchema = z.object({
  type: z.literal('read_compare'),
  eventA: z.string().min(1).max(60),
  eventB: z.string().min(1).max(60),
  topN: z.number().int().min(3).max(50).optional().nullable(),
});

export const readSemanticSearchActionSchema = z.object({
  type: z.literal('read_semantic_search'),
  query: z.string().min(1).max(320),
  corpora: z
    .array(
      z.enum(['GOVERNOR_IDENTITY', 'EVENTS', 'OCR_EXTRACTIONS', 'RANKING', 'ASSISTANT_AUDIT'])
    )
    .max(5)
    .optional()
    .nullable(),
  mode: z.enum(['hybrid', 'semantic', 'lexical']).optional().nullable(),
  limit: boundedLimitSchema,
});

export const assistantReadActionSchema = z.union([
  readWorkspaceOverviewActionSchema,
  readGovernorsActionSchema,
  readGovernorDetailActionSchema,
  readEventsActionSchema,
  readEventDetailActionSchema,
  readScanJobsActionSchema,
  readScanJobTasksActionSchema,
  readProfileReviewQueueActionSchema,
  readRankingReviewQueueActionSchema,
  readRankingRunsActionSchema,
  readRankingRunDetailActionSchema,
  readActivityWeeklyActionSchema,
  readAnalyticsActionSchema,
  readCompareActionSchema,
  readSemanticSearchActionSchema,
]);

export const assistantToolActionSchema = z.union([
  assistantReadActionSchema,
  assistantActionSchema,
]);

export type RegisterPlayerActionInput = z.infer<typeof registerPlayerActionSchema>;
export type UpdatePlayerActionInput = z.infer<typeof updatePlayerActionSchema>;
export type DeletePlayerActionInput = z.infer<typeof deletePlayerActionSchema>;
export type CreateEventActionInput = z.infer<typeof createEventActionSchema>;
export type DeleteEventActionInput = z.infer<typeof deleteEventActionSchema>;
export type RecordProfileStatsActionInput = z.infer<typeof recordProfileStatsActionSchema>;
export type AssistantActionInput = z.infer<typeof assistantActionSchema>;
export type AssistantReadActionInput = z.infer<typeof assistantReadActionSchema>;
export type AssistantToolActionInput = z.infer<typeof assistantToolActionSchema>;

export const assistantPlanOutputSchema = z.object({
  assistantResponse: z.string().default(''),
  summary: z.string().default('No actions proposed.'),
  actions: z.array(assistantActionSchema).default([]),
});

export type AssistantPlanOutput = z.infer<typeof assistantPlanOutputSchema>;

export type { AssistantAnalyzerMode, AssistantConfig, ThreadAssistantConfig };

export interface SuggestionCard {
  key: string;
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ExtractionStrategyResult {
  mode: AssistantAnalyzerMode;
  usedFallback: boolean;
  diagnostics: Array<Record<string, unknown>>;
}

export function mapActionTypeToPrisma(type: AssistantActionType): PrismaAssistantActionType {
  switch (type) {
    case 'register_player':
      return 'REGISTER_PLAYER';
    case 'update_player':
      return 'UPDATE_PLAYER';
    case 'delete_player':
      return 'DELETE_PLAYER';
    case 'create_event':
      return 'CREATE_EVENT';
    case 'delete_event':
      return 'DELETE_EVENT';
    case 'record_profile_stats':
      return 'RECORD_PROFILE_STATS';
    default:
      return 'REGISTER_PLAYER';
  }
}

export const assistantActionOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['assistantResponse', 'summary', 'actions'],
  properties: {
    assistantResponse: { type: 'string' },
    summary: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'governorId', 'name'],
            properties: {
              type: { const: 'register_player' },
              governorId: { type: 'string' },
              name: { type: 'string' },
              alliance: { type: ['string', 'null'] },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: {
              type: { const: 'update_player' },
              governorDbId: { type: ['string', 'null'] },
              governorId: { type: ['string', 'null'] },
              governorName: { type: ['string', 'null'] },
              name: { type: ['string', 'null'] },
              alliance: { type: ['string', 'null'] },
              newGovernorId: { type: ['string', 'null'] },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: {
              type: { const: 'delete_player' },
              governorDbId: { type: ['string', 'null'] },
              governorId: { type: ['string', 'null'] },
              governorName: { type: ['string', 'null'] },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'name'],
            properties: {
              type: { const: 'create_event' },
              name: { type: 'string' },
              description: { type: ['string', 'null'] },
              eventType: {
                type: 'string',
                enum: ['KVK_START', 'KVK_END', 'MGE', 'OSIRIS', 'WEEKLY', 'CUSTOM'],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: {
              type: { const: 'delete_event' },
              eventId: { type: ['string', 'null'] },
              eventName: { type: ['string', 'null'] },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'power', 'killPoints', 'deads'],
            properties: {
              type: { const: 'record_profile_stats' },
              governorDbId: { type: ['string', 'null'] },
              governorId: { type: ['string', 'null'] },
              governorName: { type: ['string', 'null'] },
              eventId: { type: ['string', 'null'] },
              eventName: { type: ['string', 'null'] },
              power: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'integer' }] },
              killPoints: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'integer' }] },
              t4Kills: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'integer' }, { type: 'null' }] },
              t5Kills: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'integer' }, { type: 'null' }] },
              deads: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'integer' }] },
              confidencePct: { type: 'number' },
            },
          },
        ],
      },
    },
  },
};
