import { NextRequest } from 'next/server';
import {
  IngestionDomain,
  IngestionTaskStatus,
  OcrExtractionStatus,
  OcrProvider,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok } from '@/lib/api-response';
import { createRankingRunWithRows } from '@/lib/rankings/service';
import {
  getTaskWithRelations,
  mergeJson,
  syncScanJobProgressWithOptions,
  toIngestionTaskResponse,
} from '@/lib/ingestion-service';
import { assertValidServiceRequest } from '@/lib/service-auth';
import { prisma } from '@/lib/prisma';
import { invalidateServerCacheTags } from '@/lib/server-cache';
import { scanJobCacheTag, workspaceCacheTags } from '@/lib/cache-scopes';
import { splitGovernorNameAndAlliance } from '@/lib/alliances';
import { validateStrictRankingTypeMetricPair } from '@/lib/rankings/normalize';

const rowSchema = z.object({
  sourceRank: z.number().int().min(1).max(5000).optional().nullable(),
  governorNameRaw: z.string().min(1).max(80),
  allianceRaw: z.string().max(80).optional().nullable(),
  titleRaw: z.string().max(80).optional().nullable(),
  metricRaw: z.string().min(1).max(80),
  metricValue: z.union([z.string(), z.number(), z.bigint()]).optional().nullable(),
  confidence: z.number().min(0).max(100).optional(),
  ocrTrace: z.unknown().optional(),
  candidates: z.unknown().optional(),
});

const profilePayloadSchema = z.object({
  provider: z.string().optional(),
  status: z.nativeEnum(OcrExtractionStatus).optional(),
  governorIdRaw: z.string().max(50).optional().nullable(),
  governorNameRaw: z.string().max(80).optional().nullable(),
  confidence: z.number().min(0).max(100).optional(),
  profileId: z.string().optional().nullable(),
  engineVersion: z.string().max(80).optional(),
  lowConfidence: z.boolean().optional(),
  failureReasons: z.array(z.string().max(220)).optional(),
  fields: z.record(z.string(), z.unknown()),
  normalized: z.record(z.string(), z.unknown()).optional(),
  validation: z.array(z.record(z.string(), z.unknown())).optional(),
  preprocessingTrace: z.record(z.string(), z.unknown()).optional(),
  candidates: z.record(z.string(), z.unknown()).optional(),
  fusionDecision: z.record(z.string(), z.unknown()).optional(),
});

const rankingPayloadSchema = z.object({
  rankingType: z.string().min(1).max(80),
  metricKey: z.string().min(1).max(80),
  headerText: z.string().max(120).optional().nullable(),
  rows: z.array(rowSchema).min(1).max(1000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const completeSchema = z.object({
  ingestionDomain: z.nativeEnum(IngestionDomain).optional(),
  screenArchetype: z.string().max(80).optional(),
  attempt: z.number().int().min(1).max(20).optional(),
  workerId: z.string().max(120).optional(),
  profile: profilePayloadSchema.optional(),
  ranking: rankingPayloadSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function extractProfileAlliance(args: {
  governorNameRaw?: string | null;
  normalized?: Record<string, unknown>;
  fields: Record<string, unknown>;
}) {
  const normalizedAlliance =
    args.normalized && typeof args.normalized.alliance === 'string'
      ? args.normalized.alliance
      : null;
  const fieldAllianceValue =
    args.fields &&
    typeof args.fields.alliance === 'object' &&
    args.fields.alliance &&
    typeof (args.fields.alliance as Record<string, unknown>).value === 'string'
      ? ((args.fields.alliance as Record<string, unknown>).value as string)
      : null;

  const split = splitGovernorNameAndAlliance({
    governorNameRaw: args.governorNameRaw || '',
    allianceRaw: normalizedAlliance || fieldAllianceValue,
  });
  return split.allianceRaw;
}

function normalizeConfidence(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  const n = Number(value);
  if (n <= 1) return Math.max(0, Math.min(1, n));
  return Math.max(0, Math.min(1, n / 100));
}

function toProvider(value: string | undefined): OcrProvider {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  if (normalized === OcrProvider.FALLBACK) return OcrProvider.FALLBACK;
  if (normalized === OcrProvider.MANUAL) return OcrProvider.MANUAL;
  return OcrProvider.TESSERACT;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const rawBody = await request.text();
    assertValidServiceRequest(request, rawBody);
    const body = completeSchema.parse(rawBody ? JSON.parse(rawBody) : {});

    const task = await getTaskWithRelations(taskId);
    if (!task) {
      return fail('NOT_FOUND', 'Ingestion task not found.', 404);
    }

    if (task.status === IngestionTaskStatus.COMPLETED) {
      return ok({
        task: toIngestionTaskResponse(task),
        idempotentReplay: true,
      });
    }

    const inferredDomain =
      body.ingestionDomain ||
      (body.ranking ? IngestionDomain.RANKING_CAPTURE : IngestionDomain.PROFILE_SNAPSHOT);

    if (inferredDomain === IngestionDomain.PROFILE_SNAPSHOT && !body.profile) {
      return fail('VALIDATION_ERROR', 'profile payload is required for profile completion.', 400);
    }

    if (inferredDomain === IngestionDomain.RANKING_CAPTURE && !body.ranking) {
      return fail('VALIDATION_ERROR', 'ranking payload is required for ranking completion.', 400);
    }

    const attemptCount = Math.max(
      task.attemptCount,
      body.attempt || 0,
      1
    );

    if (inferredDomain === IngestionDomain.PROFILE_SNAPSHOT) {
      const profile = body.profile!;

      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.ocrExtraction.findFirst({
          where: {
            scanJobId: task.scanJobId,
            artifactId: task.artifactId,
          },
          select: {
            id: true,
            status: true,
            confidence: true,
            lowConfidence: true,
            createdAt: true,
          },
        });

        const extraction =
          existing ||
          (await tx.ocrExtraction.create({
            data: {
              scanJobId: task.scanJobId,
              artifactId: task.artifactId,
              provider: toProvider(profile.provider),
              status: profile.status && profile.status !== OcrExtractionStatus.APPROVED
                ? profile.status
                : OcrExtractionStatus.RAW,
              profileId: profile.profileId || null,
              governorIdRaw: profile.governorIdRaw || null,
              governorNameRaw: profile.governorNameRaw || null,
              confidence: normalizeConfidence(profile.confidence),
              engineVersion: profile.engineVersion || 'paddleocr-v1',
              lowConfidence: profile.lowConfidence ?? normalizeConfidence(profile.confidence) < 0.85,
              failureReasons: profile.failureReasons
                ? (profile.failureReasons as unknown as Prisma.InputJsonValue)
                : undefined,
              fields: profile.fields as Prisma.InputJsonValue,
              normalized: profile.normalized
                ? (profile.normalized as Prisma.InputJsonValue)
                : undefined,
              validation: profile.validation
                ? (profile.validation as unknown as Prisma.InputJsonValue)
                : undefined,
              preprocessingTrace: profile.preprocessingTrace
                ? (profile.preprocessingTrace as Prisma.InputJsonValue)
                : undefined,
              candidates: profile.candidates
                ? (profile.candidates as Prisma.InputJsonValue)
                : undefined,
              fusionDecision: profile.fusionDecision
                ? (profile.fusionDecision as Prisma.InputJsonValue)
                : undefined,
            },
            select: {
              id: true,
              status: true,
              confidence: true,
              lowConfidence: true,
              createdAt: true,
            },
          }));

        const profileAlliance = extractProfileAlliance({
          governorNameRaw: profile.governorNameRaw || null,
          normalized:
            profile.normalized && typeof profile.normalized === 'object'
              ? (profile.normalized as Record<string, unknown>)
              : undefined,
          fields:
            profile.fields && typeof profile.fields === 'object'
              ? (profile.fields as Record<string, unknown>)
              : {},
        });

        if (profileAlliance) {
          await tx.ocrExtraction.update({
            where: { id: extraction.id },
            data: {
              normalized: {
                ...(profile.normalized || {}),
                alliance: profileAlliance,
              } as Prisma.InputJsonValue,
            },
          });
        }

        const updatedTask = await tx.ingestionTask.update({
          where: { id: taskId },
          data: {
            status: IngestionTaskStatus.COMPLETED,
            attemptCount,
            startedAt: task.startedAt || new Date(),
            completedAt: new Date(),
            lastError: null,
            metadata: mergeJson(task.metadata, {
              ...(body.metadata || {}),
              workerId: body.workerId || undefined,
              screenArchetype: body.screenArchetype || undefined,
              ingestionDomain: inferredDomain,
              extractionId: extraction.id,
            }),
          },
          include: {
            artifact: {
              select: {
                id: true,
                type: true,
                url: true,
                metadata: true,
              },
            },
          },
        });

        const scanJob = await syncScanJobProgressWithOptions(tx, task.scanJobId, {
          recomputeLowConfidence: true,
        });

        return {
          task: updatedTask,
          extraction,
          scanJob,
        };
      });

      invalidateServerCacheTags([
        ...Object.values(workspaceCacheTags(task.workspaceId)),
        scanJobCacheTag(task.scanJobId),
      ]);

      return ok({
        task: toIngestionTaskResponse(result.task),
        ingestionDomain: inferredDomain,
        extraction: {
          id: result.extraction.id,
          status: result.extraction.status,
          confidence: result.extraction.confidence,
          lowConfidence: result.extraction.lowConfidence,
          createdAt: result.extraction.createdAt.toISOString(),
        },
        scanJob: {
          id: result.scanJob.id,
          status: result.scanJob.status,
          processedFiles: result.scanJob.processedFiles,
          totalFiles: result.scanJob.totalFiles,
          lowConfidenceFiles: result.scanJob.lowConfidenceFiles,
          summary: result.scanJob.summary,
        },
      });
    }

    const ranking = body.ranking!;
    const strictPair = validateStrictRankingTypeMetricPair(
      ranking.rankingType,
      ranking.metricKey
    );
    if (!strictPair.ok) {
      return fail(
        'VALIDATION_ERROR',
        strictPair.reason || 'Unsupported rankingType/metricKey pair.',
        400,
        {
          rankingType: strictPair.rankingType,
          metricKey: strictPair.metricKey,
          expectedMetricKey: strictPair.expectedMetricKey,
        }
      );
    }

    const enrichedRankingRows = ranking.rows.map((row) => {
      const split = splitGovernorNameAndAlliance({
        governorNameRaw: row.governorNameRaw,
        allianceRaw: row.allianceRaw || null,
        subtitleRaw: row.titleRaw || null,
      });

      return {
        ...row,
        governorNameRaw: split.governorNameRaw || row.governorNameRaw,
        allianceRaw: split.allianceRaw || row.allianceRaw || null,
      };
    });

    const rankingRun = await createRankingRunWithRows({
      workspaceId: task.workspaceId,
      eventId: task.eventId || task.scanJob.eventId || null,
      source: task.scanJob.source,
      domain: IngestionDomain.RANKING_CAPTURE,
      rankingType: ranking.rankingType,
      metricKey: ranking.metricKey,
      headerText: ranking.headerText,
      artifactId: task.artifactId,
      metadata: {
        ...(ranking.metadata || {}),
        ...(body.metadata || {}),
        taskId: task.id,
        screenArchetype: body.screenArchetype || 'ranking_board',
        kingdomNumber: '4057',
      } as Prisma.InputJsonValue,
      notes: `Ingestion task completion ${task.id}`,
      idempotencyKey: `ingestion-task:${task.id}:ranking-run`,
      rows: enrichedRankingRows,
    });

    const result = await prisma.$transaction(async (tx) => {
      const duplicateMetadata =
        rankingRun.duplicate && typeof rankingRun.duplicate === 'object'
          ? {
              duplicateLevel: (rankingRun.duplicate as Record<string, unknown>).level || null,
              duplicateReferenceRunId:
                (rankingRun.duplicate as Record<string, unknown>).referenceRunId || null,
              duplicateSimilarity:
                (rankingRun.duplicate as Record<string, unknown>).similarity || null,
              duplicateOverrideToken:
                (rankingRun.duplicate as Record<string, unknown>).overrideToken || null,
            }
          : null;

      const updatedTask = await tx.ingestionTask.update({
        where: { id: taskId },
        data: {
          status: IngestionTaskStatus.COMPLETED,
          attemptCount,
          startedAt: task.startedAt || new Date(),
          completedAt: new Date(),
          lastError: null,
          metadata: mergeJson(task.metadata, {
            ...(body.metadata || {}),
            workerId: body.workerId || undefined,
            screenArchetype: body.screenArchetype || undefined,
              ingestionDomain: inferredDomain,
              rankingRunId: rankingRun.id,
              rankingType: rankingRun.rankingType,
              metricKey: rankingRun.metricKey,
              duplicateWarning: rankingRun.deduped ? true : undefined,
              ...(duplicateMetadata || {}),
            }),
          },
          include: {
            artifact: {
            select: {
              id: true,
              type: true,
              url: true,
              metadata: true,
            },
          },
        },
      });

      const scanJob = await syncScanJobProgressWithOptions(tx, task.scanJobId, {
        recomputeLowConfidence: false,
      });

      return {
        task: updatedTask,
        scanJob,
      };
    });

    invalidateServerCacheTags([
      ...Object.values(workspaceCacheTags(task.workspaceId)),
      scanJobCacheTag(task.scanJobId),
    ]);

    return ok({
      task: toIngestionTaskResponse(result.task),
      ingestionDomain: inferredDomain,
      rankingRun,
      duplicate: rankingRun.duplicate || null,
      scanJob: {
        id: result.scanJob.id,
        status: result.scanJob.status,
        processedFiles: result.scanJob.processedFiles,
        totalFiles: result.scanJob.totalFiles,
        lowConfidenceFiles: result.scanJob.lowConfidenceFiles,
        summary: result.scanJob.summary,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
