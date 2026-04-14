import { NextRequest } from 'next/server';
import {
  AnomalySeverity,
  OcrExtractionStatus,
  Prisma,
  RankingRowReviewAction,
  RankingSnapshotStatus,
  ScanJobStatus,
  WorkspaceRole,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  ApiHttpError,
  fail,
  handleApiError,
  ok,
  readJson,
} from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import {
  detectSnapshotPayloadAnomalies,
} from '@/lib/anomalies';
import {
  parseExtractionValues,
  parseValidation,
  toApprovedSnapshotPayload,
} from '@/lib/review-queue';
import {
  computeCanonicalIdentityKey,
  normalizeGovernorAlias,
  normalizeMetricKey,
  normalizeRankingType,
} from '@/lib/rankings/normalize';
import { invalidateServerCacheTags } from '@/lib/server-cache';
import { scanJobCacheTag, workspaceCacheTags } from '@/lib/cache-scopes';

const PROFILE_POWER_RANKING_TYPE = normalizeRankingType('governor_profile_power');
const PROFILE_POWER_METRIC_KEY = normalizeMetricKey('power');

const correctedSchema = z
  .object({
    governorId: z.string().optional(),
    governorName: z.string().optional(),
    power: z.string().optional(),
    killPoints: z.string().optional(),
    t4Kills: z.string().optional(),
    t5Kills: z.string().optional(),
    deads: z.string().optional(),
  })
  .partial();

const rerunSchema = z.object({
  profileId: z.string().optional(),
  engineVersion: z.string().max(50).optional(),
  normalized: correctedSchema.optional(),
  preprocessingTrace: z.record(z.string(), z.unknown()).optional(),
  candidates: z.record(z.string(), z.unknown()).optional(),
  fusionDecision: z.record(z.string(), z.unknown()).optional(),
  failureReasons: z.array(z.string()).optional(),
  lowConfidence: z.boolean().optional(),
});

const reviewSchema = z.object({
  status: z.nativeEnum(OcrExtractionStatus),
  reason: z.string().max(300).optional(),
  corrected: correctedSchema.optional(),
  rerun: rerunSchema.optional(),
  validation: z.array(
    z.object({
      field: z.string(),
      value: z.string(),
      isValid: z.boolean(),
      confidence: z.number(),
      warning: z.string().optional(),
      severity: z.enum(['ok', 'warning', 'error']),
    })
  ).optional(),
});

function inferCorrectionReasonCode(
  field: keyof ReturnType<typeof parseExtractionValues>,
  previousValue: string,
  correctedValue: string
): string {
  if (previousValue === correctedValue) return 'no_change';
  const previousDigits = previousValue.replace(/[^0-9]/g, '');
  const correctedDigits = correctedValue.replace(/[^0-9]/g, '');

  if (field !== 'governorName') {
    if (!previousDigits && correctedDigits) return 'threshold_failure';
    if (Math.abs(previousDigits.length - correctedDigits.length) >= 2) {
      return 'crop_drift';
    }
    if (previousDigits.length === correctedDigits.length) {
      return 'digit_confusion';
    }
    return 'numeric_adjustment';
  }

  if (!previousValue.trim() && correctedValue.trim()) return 'name_empty_fix';
  if (Math.abs(previousValue.length - correctedValue.length) >= 4) return 'name_crop_drift';
  return 'name_typo_fix';
}

function applyCorrections(
  base: ReturnType<typeof parseExtractionValues>,
  corrected?: z.infer<typeof correctedSchema>
) {
  if (!corrected) return base;
  return {
    governorId: {
      ...base.governorId,
      value: corrected.governorId ?? base.governorId.value,
    },
    governorName: {
      ...base.governorName,
      value: corrected.governorName ?? base.governorName.value,
    },
    power: {
      ...base.power,
      value: corrected.power ?? base.power.value,
    },
    killPoints: {
      ...base.killPoints,
      value: corrected.killPoints ?? base.killPoints.value,
    },
    t4Kills: {
      ...base.t4Kills,
      value: corrected.t4Kills ?? base.t4Kills.value,
    },
    t5Kills: {
      ...base.t5Kills,
      value: corrected.t5Kills ?? base.t5Kills.value,
    },
    deads: {
      ...base.deads,
      value: corrected.deads ?? base.deads.value,
    },
  };
}

function applyRerunNormalized(
  base: ReturnType<typeof parseExtractionValues>,
  rerun?: z.infer<typeof rerunSchema>
) {
  if (!rerun?.normalized) return base;
  return {
    governorId: {
      ...base.governorId,
      value: rerun.normalized.governorId ?? base.governorId.value,
    },
    governorName: {
      ...base.governorName,
      value: rerun.normalized.governorName ?? base.governorName.value,
    },
    power: {
      ...base.power,
      value: rerun.normalized.power ?? base.power.value,
    },
    killPoints: {
      ...base.killPoints,
      value: rerun.normalized.killPoints ?? base.killPoints.value,
    },
    t4Kills: {
      ...base.t4Kills,
      value: rerun.normalized.t4Kills ?? base.t4Kills.value,
    },
    t5Kills: {
      ...base.t5Kills,
      value: rerun.normalized.t5Kills ?? base.t5Kills.value,
    },
    deads: {
      ...base.deads,
      value: rerun.normalized.deads ?? base.deads.value,
    },
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const extraction = await prisma.ocrExtraction.findUnique({
      where: { id },
      include: {
        scanJob: {
          select: {
            id: true,
            eventId: true,
            workspaceId: true,
          },
        },
      },
    });

    if (!extraction) {
      throw new ApiHttpError('NOT_FOUND', 'Review queue entry not found.', 404);
    }

    const auth = await authorizeWorkspaceAccess(
      request,
      extraction.scanJob.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const body = reviewSchema.parse(await readJson(request));

    const parsedValues = parseExtractionValues({
      fields: extraction.fields,
      normalized: extraction.normalized,
      governorIdRaw: extraction.governorIdRaw,
      governorNameRaw: extraction.governorNameRaw,
      confidence: extraction.confidence,
    });
    const rerunValues = applyRerunNormalized(parsedValues, body.rerun);
    const mergedValues = applyCorrections(rerunValues, body.corrected);
    let approvedPayload = toApprovedSnapshotPayload(mergedValues);

    if (body.status === OcrExtractionStatus.APPROVED) {
      if (!extraction.scanJob.eventId) {
        throw new ApiHttpError(
          'VALIDATION_ERROR',
          'Scan job is not linked to an event. Cannot approve into snapshots.',
          400
        );
      }
      if (!/^\d{6,12}$/.test(approvedPayload.governorId)) {
        const matchedGovernor = await prisma.governor.findFirst({
          where: {
            workspaceId: extraction.scanJob.workspaceId,
            name: {
              equals: approvedPayload.governorName,
              mode: 'insensitive',
            },
          },
          select: {
            governorId: true,
          },
        });

        if (matchedGovernor?.governorId && /^\d{6,12}$/.test(matchedGovernor.governorId)) {
          approvedPayload = {
            ...approvedPayload,
            governorId: matchedGovernor.governorId,
          };
        } else {
          throw new ApiHttpError(
            'VALIDATION_ERROR',
            'Governor ID must be 6-12 digits before approval. Add an ID or use a known governor name already mapped in this workspace.',
            400
          );
        }
      }
    }

    const validation = body.validation ?? parseValidation(extraction.validation);
    const anomalies = detectSnapshotPayloadAnomalies({
      power: approvedPayload.power,
      killPoints: approvedPayload.killPoints,
      t4Kills: approvedPayload.t4Kills,
      t5Kills: approvedPayload.t5Kills,
      deads: approvedPayload.deads,
    });

    const correctionEntries = (
      Object.keys(mergedValues) as Array<keyof typeof mergedValues>
    )
      .map((fieldName) => {
        const before = rerunValues[fieldName].value;
        const after = mergedValues[fieldName].value;
        if (before === after) return null;
        return {
          fieldName,
          previousValue: before,
          correctedValue: after,
          reasonCode: inferCorrectionReasonCode(fieldName, before, after),
          confidence: rerunValues[fieldName].confidence,
        };
      })
      .filter(
        (
          item
        ): item is {
          fieldName: keyof typeof mergedValues;
          previousValue: string;
          correctedValue: string;
          reasonCode: string;
          confidence: number;
        } => Boolean(item)
      );

    const fallbackFailureReasons =
      extraction.failureReasons == null
        ? undefined
        : (extraction.failureReasons as unknown as Prisma.InputJsonValue);
    const fallbackPreprocessingTrace =
      extraction.preprocessingTrace == null
        ? undefined
        : (extraction.preprocessingTrace as unknown as Prisma.InputJsonValue);
    const fallbackCandidates =
      extraction.candidates == null
        ? undefined
        : (extraction.candidates as unknown as Prisma.InputJsonValue);
    const fallbackFusionDecision =
      extraction.fusionDecision == null
        ? undefined
        : (extraction.fusionDecision as unknown as Prisma.InputJsonValue);

    const result = await prisma.$transaction(async (tx) => {
      const updatedExtraction = await tx.ocrExtraction.update({
        where: { id: extraction.id },
        data: {
          status: body.status,
          profileId: body.rerun?.profileId || extraction.profileId,
          engineVersion: body.rerun?.engineVersion || extraction.engineVersion,
          lowConfidence:
            body.rerun?.lowConfidence ?? extraction.lowConfidence,
          failureReasons: body.rerun?.failureReasons
            ? (body.rerun.failureReasons as unknown as Prisma.InputJsonValue)
            : fallbackFailureReasons,
          preprocessingTrace: body.rerun?.preprocessingTrace
            ? (body.rerun.preprocessingTrace as unknown as Prisma.InputJsonValue)
            : fallbackPreprocessingTrace,
          candidates: body.rerun?.candidates
            ? (body.rerun.candidates as unknown as Prisma.InputJsonValue)
            : fallbackCandidates,
          fusionDecision: body.rerun?.fusionDecision
            ? (body.rerun.fusionDecision as unknown as Prisma.InputJsonValue)
            : fallbackFusionDecision,
          normalized: {
            governorId: mergedValues.governorId,
            governorName: mergedValues.governorName,
            power: mergedValues.power,
            killPoints: mergedValues.killPoints,
            t4Kills: mergedValues.t4Kills,
            t5Kills: mergedValues.t5Kills,
            deads: mergedValues.deads,
            reviewReason: body.reason || null,
            reviewedAt: new Date().toISOString(),
          } as unknown as Prisma.InputJsonValue,
          validation: validation as unknown as Prisma.InputJsonValue,
        },
      });

      if (correctionEntries.length > 0) {
        await tx.ocrCorrectionLog.createMany({
          data: correctionEntries.map((entry) => ({
            workspaceId: extraction.scanJob.workspaceId,
            extractionId: extraction.id,
            reviewedByLinkId: auth.link.id,
            fieldName: entry.fieldName,
            previousValue: entry.previousValue,
            correctedValue: entry.correctedValue,
            reasonCode: entry.reasonCode,
            confidence: entry.confidence,
          })),
        });
      }

      let snapshotId: string | null = null;

      if (body.status === OcrExtractionStatus.APPROVED && extraction.scanJob.eventId) {
        const governor = await tx.governor.upsert({
          where: { governorId: approvedPayload.governorId },
          update: {
            name: approvedPayload.governorName,
            workspaceId: extraction.scanJob.workspaceId,
          },
          create: {
            governorId: approvedPayload.governorId,
            name: approvedPayload.governorName,
            workspaceId: extraction.scanJob.workspaceId,
          },
        });

        const previous = await tx.snapshot.findUnique({
          where: {
            eventId_governorId: {
              eventId: extraction.scanJob.eventId,
              governorId: governor.id,
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
              eventId: extraction.scanJob.eventId,
              governorId: governor.id,
            },
          },
          update: {
            power: approvedPayload.power,
            killPoints: approvedPayload.killPoints,
            t4Kills: approvedPayload.t4Kills,
            t5Kills: approvedPayload.t5Kills,
            deads: approvedPayload.deads,
            workspaceId: extraction.scanJob.workspaceId,
            verified: true,
            ocrConfidence:
              extraction.confidence <= 1 ? extraction.confidence * 100 : extraction.confidence,
          },
          create: {
            eventId: extraction.scanJob.eventId,
            governorId: governor.id,
            workspaceId: extraction.scanJob.workspaceId,
            power: approvedPayload.power,
            killPoints: approvedPayload.killPoints,
            t4Kills: approvedPayload.t4Kills,
            t5Kills: approvedPayload.t5Kills,
            deads: approvedPayload.deads,
            verified: true,
            ocrConfidence:
              extraction.confidence <= 1 ? extraction.confidence * 100 : extraction.confidence,
          },
          select: {
            id: true,
            power: true,
            killPoints: true,
            t4Kills: true,
            t5Kills: true,
            deads: true,
          },
        });

        snapshotId = snapshot.id;

        if (previous) {
          await tx.snapshotRevision.create({
            data: {
              workspaceId: extraction.scanJob.workspaceId,
              snapshotId: previous.id,
              changedByLinkId: auth.link.id,
              reason: body.reason || 'Manual OCR review approval',
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
                verified: true,
                ocrConfidence:
                  extraction.confidence <= 1
                    ? extraction.confidence * 100
                    : extraction.confidence,
              },
            },
          });
        }

        if (anomalies.length > 0) {
          await tx.anomaly.createMany({
            data: anomalies.map((anomaly) => ({
              workspaceId: extraction.scanJob.workspaceId,
              snapshotId: snapshot.id,
              governorId: governor.id,
              eventAId: extraction.scanJob.eventId,
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

        // Keep ranking board in sync with approved profile reviews so players
        // appear in canonical rankings immediately after approval.
        const governorNameNormalized = normalizeGovernorAlias(approvedPayload.governorName);
        const identityKey = computeCanonicalIdentityKey({
          governorId: governor.id,
          governorNameNormalized,
        });

        const previousRankingSnapshot = await tx.rankingSnapshot.findUnique({
          where: {
            workspaceId_eventId_rankingType_identityKey: {
              workspaceId: extraction.scanJob.workspaceId,
              eventId: extraction.scanJob.eventId,
              rankingType: PROFILE_POWER_RANKING_TYPE,
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

        const nextRankingData = {
          rankingType: PROFILE_POWER_RANKING_TYPE,
          metricKey: PROFILE_POWER_METRIC_KEY,
          identityKey,
          governorId: governor.id,
          governorNameRaw: approvedPayload.governorName,
          governorNameNormalized,
          sourceRank: null,
          metricValue: approvedPayload.power.toString(),
          status: RankingSnapshotStatus.ACTIVE,
          lastRunId: null,
          lastRowId: null,
        };

        const rankingSnapshot = await tx.rankingSnapshot.upsert({
          where: {
            workspaceId_eventId_rankingType_identityKey: {
              workspaceId: extraction.scanJob.workspaceId,
              eventId: extraction.scanJob.eventId,
              rankingType: PROFILE_POWER_RANKING_TYPE,
              identityKey,
            },
          },
          create: {
            workspaceId: extraction.scanJob.workspaceId,
            eventId: extraction.scanJob.eventId,
            rankingType: PROFILE_POWER_RANKING_TYPE,
            metricKey: PROFILE_POWER_METRIC_KEY,
            identityKey,
            governorId: governor.id,
            governorNameRaw: approvedPayload.governorName,
            governorNameNormalized,
            sourceRank: null,
            metricValue: approvedPayload.power,
            status: RankingSnapshotStatus.ACTIVE,
            lastRunId: null,
            lastRowId: null,
          },
          update: {
            metricKey: PROFILE_POWER_METRIC_KEY,
            governorId: governor.id,
            governorNameRaw: approvedPayload.governorName,
            governorNameNormalized,
            sourceRank: null,
            metricValue: approvedPayload.power,
            status: RankingSnapshotStatus.ACTIVE,
            lastRunId: null,
            lastRowId: null,
          },
          select: {
            id: true,
          },
        });

        await tx.rankingRevision.create({
          data: {
            workspaceId: extraction.scanJob.workspaceId,
            snapshotId: rankingSnapshot.id,
            changedByLinkId: auth.link.id,
            action: RankingRowReviewAction.SYSTEM_MERGE,
            reason: body.reason || 'Profile review approval sync',
            previousData: previousRankingSnapshot
              ? {
                  rankingType: previousRankingSnapshot.rankingType,
                  metricKey: previousRankingSnapshot.metricKey,
                  identityKey: previousRankingSnapshot.identityKey,
                  governorId: previousRankingSnapshot.governorId,
                  governorNameRaw: previousRankingSnapshot.governorNameRaw,
                  governorNameNormalized: previousRankingSnapshot.governorNameNormalized,
                  sourceRank: previousRankingSnapshot.sourceRank,
                  metricValue: previousRankingSnapshot.metricValue.toString(),
                  status: previousRankingSnapshot.status,
                  lastRunId: previousRankingSnapshot.lastRunId,
                  lastRowId: previousRankingSnapshot.lastRowId,
                }
              : undefined,
            nextData: nextRankingData,
          },
        });
      }

      const pendingCount = await tx.ocrExtraction.count({
        where: {
          scanJobId: extraction.scanJobId,
          status: {
            in: [OcrExtractionStatus.RAW, OcrExtractionStatus.REVIEWED],
          },
        },
      });

      await tx.scanJob.update({
        where: { id: extraction.scanJobId },
        data: {
          status:
            pendingCount === 0
              ? ScanJobStatus.READY
              : ScanJobStatus.REVIEW,
        },
      });

      return {
        extraction: updatedExtraction,
        snapshotId,
        anomalyCount: anomalies.length,
        correctionCount: correctionEntries.length,
      };
    });

    invalidateServerCacheTags([
      ...Object.values(workspaceCacheTags(extraction.scanJob.workspaceId)),
      scanJobCacheTag(extraction.scanJobId),
    ]);

    return ok({
      id: result.extraction.id,
      status: result.extraction.status,
      scanJobId: result.extraction.scanJobId,
      snapshotId: result.snapshotId,
      anomalyCount: result.anomalyCount,
      correctionCount: result.correctionCount,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
