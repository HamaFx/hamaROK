import { NextRequest } from 'next/server';
import {
  AnomalySeverity,
  EmbeddingCorpus,
  EmbeddingTaskOperation,
  MetricObservationSourceType,
  OcrExtractionStatus,
  Prisma,
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
  assessProfileMetricSyncSafety,
  parseExtractionValues,
  parseValidation,
  toApprovedSnapshotPayload,
} from '@/lib/review-queue';
import { invalidateServerCacheTags } from '@/lib/server-cache';
import { scanJobCacheTag, workspaceCacheTags } from '@/lib/cache-scopes';
import { splitGovernorNameAndAlliance } from '@/lib/alliances';
import { ensureWeeklyEventForWorkspace } from '@/lib/weekly-events';
import { assertWeeklySchemaCapability, isWeeklySchemaCapabilityError } from '@/lib/weekly-schema-guard';
import { enqueueEmbeddingTaskSafe } from '@/lib/embeddings/service';
import {
  METRIC_KEY_KILL_POINTS,
  METRIC_KEY_POWER,
  enqueueMetricSyncBacklogTx,
  recordMetricObservationTx,
  upsertProfileSnapshotForEventTx,
} from '@/lib/metric-sync';
import { validateGovernorData } from '@/lib/ocr/validators';
import { normalizeGovernorAlias } from '@/lib/rankings/normalize';

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

function extractAllianceFromExtraction(extraction: {
  normalized: Prisma.JsonValue | null;
  fields: Prisma.JsonValue;
  governorNameRaw: string | null;
}) {
  const normalizedObject =
    extraction.normalized && typeof extraction.normalized === 'object'
      ? (extraction.normalized as Record<string, unknown>)
      : {};

  const fieldsObject =
    extraction.fields && typeof extraction.fields === 'object'
      ? (extraction.fields as Record<string, unknown>)
      : {};

  const normalizedAlliance =
    typeof normalizedObject.alliance === 'string' ? normalizedObject.alliance : null;

  const fieldAlliance =
    fieldsObject.alliance &&
    typeof fieldsObject.alliance === 'object' &&
    typeof (fieldsObject.alliance as Record<string, unknown>).value === 'string'
      ? ((fieldsObject.alliance as Record<string, unknown>).value as string)
      : null;

  const split = splitGovernorNameAndAlliance({
    governorNameRaw: extraction.governorNameRaw || '',
    allianceRaw: normalizedAlliance || fieldAlliance,
  });

  return split.allianceRaw;
}

function extractNormalizedNumericField(
  normalized: Prisma.JsonValue | null,
  fieldKey: 'power' | 'killPoints'
): string {
  if (!normalized || typeof normalized !== 'object') return '';
  const record = normalized as Record<string, unknown>;
  const entry = record[fieldKey];
  if (typeof entry === 'string') return entry.replace(/[^0-9]/g, '');
  if (entry && typeof entry === 'object') {
    const value = (entry as Record<string, unknown>).value;
    return String(value ?? '').replace(/[^0-9]/g, '');
  }
  return '';
}

function sanitizeApprovedGovernorName(raw: string): string {
  let cleaned = String(raw || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\bGOVERNOR\b/gi, ' ')
    .replace(/\(\s*ID\s*[: ]*\d{4,14}\s*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) cleaned = 'Unknown';
  return cleaned.slice(0, 64);
}

async function seedGovernorAliasConflictSafeTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    governorDbId: string;
    aliasRaw: string;
  }
): Promise<'seeded' | 'conflict' | 'skipped'> {
  const aliasRaw = sanitizeApprovedGovernorName(args.aliasRaw);
  const aliasNormalized = normalizeGovernorAlias(aliasRaw);
  if (!aliasRaw || !aliasNormalized || aliasNormalized === 'unknown') {
    return 'skipped';
  }

  const existing = await tx.governorAlias.findUnique({
    where: {
      workspaceId_aliasNormalized: {
        workspaceId: args.workspaceId,
        aliasNormalized,
      },
    },
    select: {
      id: true,
      governorId: true,
    },
  });

  if (existing && existing.governorId !== args.governorDbId) {
    return 'conflict';
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
      governorId: args.governorDbId,
      aliasRaw,
      aliasNormalized,
      confidence: 1,
      source: 'profile-approval',
    },
    update: {
      governorId: args.governorDbId,
      aliasRaw,
      confidence: 1,
      source: 'profile-approval',
    },
  });

  return 'seeded';
}

function normalizeOptionalCombatMetrics(args: {
  payload: ReturnType<typeof toApprovedSnapshotPayload>;
  values: ReturnType<typeof parseExtractionValues>;
}) {
  let { payload } = args;
  const notes: string[] = [];
  const lowConfidenceThreshold = 75;
  const maxOptionalDigits = 12;

  const maybeZeroOptionalField = (
    key: 't4Kills' | 't5Kills' | 'deads'
  ) => {
    const confidence = Number(args.values[key].confidence || 0);
    if (confidence < lowConfidenceThreshold && payload[key] > BigInt(0)) {
      if (key === 't4Kills') {
        payload = { ...payload, t4Kills: BigInt(0) };
      } else if (key === 't5Kills') {
        payload = { ...payload, t5Kills: BigInt(0) };
      } else {
        payload = { ...payload, deads: BigInt(0) };
      }
      notes.push(`${key} reset to 0 (low confidence ${Math.round(confidence)}%)`);
    }
  };

  maybeZeroOptionalField('t4Kills');
  maybeZeroOptionalField('t5Kills');
  maybeZeroOptionalField('deads');

  const maybeClampOptionalDigits = (key: 't4Kills' | 't5Kills' | 'deads') => {
    const value = payload[key];
    if (value <= BigInt(0)) return;
    if (value.toString().length <= maxOptionalDigits) return;
    if (key === 't4Kills') {
      payload = { ...payload, t4Kills: BigInt(0) };
    } else if (key === 't5Kills') {
      payload = { ...payload, t5Kills: BigInt(0) };
    } else {
      payload = { ...payload, deads: BigInt(0) };
    }
    notes.push(`${key} reset to 0 (implausible digit length)`);
  };

  maybeClampOptionalDigits('t4Kills');
  maybeClampOptionalDigits('t5Kills');
  maybeClampOptionalDigits('deads');

  const tierKills = payload.t4Kills + payload.t5Kills;
  if (payload.killPoints > BigInt(0) && tierKills > payload.killPoints * BigInt(3)) {
    payload = {
      ...payload,
      t4Kills: BigInt(0),
      t5Kills: BigInt(0),
    };
    notes.push('t4/t5 reset to 0 (implausible vs kill points)');
  }

  if (payload.power > BigInt(0) && payload.deads > payload.power * BigInt(2)) {
    payload = {
      ...payload,
      deads: BigInt(0),
    };
    notes.push('deads reset to 0 (implausible vs power)');
  }

  return { payload, notes };
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
    approvedPayload = {
      ...approvedPayload,
      governorName: sanitizeApprovedGovernorName(approvedPayload.governorName),
    };
    const optionalCombatNormalization = normalizeOptionalCombatMetrics({
      payload: approvedPayload,
      values: mergedValues,
    });
    approvedPayload = optionalCombatNormalization.payload;
    let targetEventId = extraction.scanJob.eventId;
    let syncState: 'SYNCED' | 'PENDING_WEEK_LINK' = 'SYNCED';
    let syncMessage: string | null = null;

    if (body.status === OcrExtractionStatus.APPROVED) {
      if (!targetEventId) {
        try {
          await assertWeeklySchemaCapability();
          const ensured = await ensureWeeklyEventForWorkspace(extraction.scanJob.workspaceId);
          targetEventId = ensured.event.id;
        } catch (error) {
          if (
            (error instanceof ApiHttpError && error.code === 'PRECONDITION_FAILED') ||
            isWeeklySchemaCapabilityError(error)
          ) {
            syncState = 'PENDING_WEEK_LINK';
            syncMessage =
              'Approved, but weekly linkage is pending because the database schema is behind. Apply latest migrations, then run metric sync.';
          } else {
            syncState = 'PENDING_WEEK_LINK';
            syncMessage =
              'Approved, but weekly linkage is pending due to event resolution failure. Run metric sync after weekly events recover.';
          }
        }
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

      const normalizedApprovedName = normalizeGovernorAlias(approvedPayload.governorName);
      if (normalizedApprovedName && normalizedApprovedName !== 'unknown') {
        const governorById = await prisma.governor.findFirst({
          where: {
            workspaceId: extraction.scanJob.workspaceId,
            governorId: approvedPayload.governorId,
          },
          select: { id: true },
        });

        if (!governorById) {
          const sameNameCandidates = await prisma.governor.findMany({
            where: {
              workspaceId: extraction.scanJob.workspaceId,
              name: {
                equals: approvedPayload.governorName,
                mode: 'insensitive',
              },
            },
            select: {
              governorId: true,
              name: true,
            },
          });

          const exactNormalizedMatches = sameNameCandidates.filter(
            (entry) => normalizeGovernorAlias(entry.name) === normalizedApprovedName
          );

          if (
            exactNormalizedMatches.length === 1 &&
            /^\d{6,12}$/.test(exactNormalizedMatches[0].governorId)
          ) {
            approvedPayload = {
              ...approvedPayload,
              governorId: exactNormalizedMatches[0].governorId,
            };
          }
        }
      }
    }

    const persistedValidation = body.validation ?? parseValidation(extraction.validation);
    const computedValidation = validateGovernorData({
      governorId: approvedPayload.governorId,
      name: approvedPayload.governorName,
      power: approvedPayload.power.toString(),
      killPoints: approvedPayload.killPoints.toString(),
      t4Kills: approvedPayload.t4Kills.toString(),
      t5Kills: approvedPayload.t5Kills.toString(),
      deads: approvedPayload.deads.toString(),
      confidences: {
        governorId: mergedValues.governorId.confidence,
        name: mergedValues.governorName.confidence,
        power: mergedValues.power.confidence,
        killPoints: mergedValues.killPoints.confidence,
        t4Kills: mergedValues.t4Kills.confidence,
        t5Kills: mergedValues.t5Kills.confidence,
        deads: mergedValues.deads.confidence,
      },
    });
    const validation = persistedValidation.length > 0 ? persistedValidation : computedValidation;
    const profileMetricAssessment = assessProfileMetricSyncSafety(approvedPayload);
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
    let metricSyncSkippedReason: string | null = null;

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
      let linkedEventId: string | null = null;
      if (body.status === OcrExtractionStatus.APPROVED) {
        const allianceDetection = splitGovernorNameAndAlliance({
          governorNameRaw: approvedPayload.governorName,
          allianceRaw: extractAllianceFromExtraction(extraction),
        });
        const approvedGovernorName =
          allianceDetection.governorNameRaw || approvedPayload.governorName;

        const governor = await tx.governor.upsert({
          where: { governorId: approvedPayload.governorId },
          update: {
            name: approvedGovernorName,
            workspaceId: extraction.scanJob.workspaceId,
            ...(allianceDetection.allianceRaw
              ? {
                  alliance: allianceDetection.allianceRaw,
                }
              : {}),
          },
          create: {
            governorId: approvedPayload.governorId,
            name: approvedGovernorName,
            workspaceId: extraction.scanJob.workspaceId,
            alliance: allianceDetection.allianceRaw || '',
          },
        });

        const aliasCandidates = [approvedGovernorName];
        if (allianceDetection.trackedAlliance && allianceDetection.allianceTag) {
          aliasCandidates.push(`[${allianceDetection.allianceTag}] ${approvedGovernorName}`);
        }
        const seenAlias = new Set<string>();
        for (const aliasCandidate of aliasCandidates) {
          const normalizedAlias = normalizeGovernorAlias(aliasCandidate);
          if (!normalizedAlias || normalizedAlias === 'unknown' || seenAlias.has(normalizedAlias)) {
            continue;
          }
          seenAlias.add(normalizedAlias);
          await seedGovernorAliasConflictSafeTx(tx, {
            workspaceId: extraction.scanJob.workspaceId,
            governorDbId: governor.id,
            aliasRaw: aliasCandidate,
          });
        }

        let shouldSyncProfileMetrics = profileMetricAssessment.shouldSync;
        let syncSkipReason = profileMetricAssessment.shouldSync
          ? null
          : `Profile metrics were not synced: ${profileMetricAssessment.reasons.join('; ')}`;

        if (shouldSyncProfileMetrics) {
          const approvedPeers = await tx.ocrExtraction.findMany({
            where: {
              scanJobId: extraction.scanJobId,
              status: OcrExtractionStatus.APPROVED,
              id: { not: extraction.id },
            },
            select: {
              normalized: true,
            },
            take: 80,
          });

          const currentPowerDigits = approvedPayload.power.toString();
          const currentKillPointsDigits = approvedPayload.killPoints.toString();
          let samePairCount = 0;
          let sameKillPointsCount = 0;
          for (const peer of approvedPeers) {
            const peerPower = extractNormalizedNumericField(peer.normalized, 'power');
            const peerKillPoints = extractNormalizedNumericField(peer.normalized, 'killPoints');
            if (peerPower === currentPowerDigits && peerKillPoints === currentKillPointsDigits) {
              samePairCount += 1;
            }
            if (peerKillPoints && peerKillPoints === currentKillPointsDigits) {
              sameKillPointsCount += 1;
            }
          }

          if (samePairCount >= 2 && approvedPayload.power <= BigInt(0)) {
            shouldSyncProfileMetrics = false;
            syncSkipReason =
              'Profile metrics were not synced: repeated identical power/kill points were detected across this upload batch.';
          }

          if (
            shouldSyncProfileMetrics &&
            approvedPayload.killPoints > BigInt(0) &&
            currentKillPointsDigits.length >= 4 &&
            sameKillPointsCount >= 2
          ) {
            shouldSyncProfileMetrics = false;
            syncSkipReason =
              'Profile metrics were not synced: repeated identical kill points were detected across this upload batch.';
          }
        }

        if (targetEventId && shouldSyncProfileMetrics) {
          linkedEventId = targetEventId;
          if (extraction.scanJob.eventId !== targetEventId) {
            await tx.scanJob.update({
              where: { id: extraction.scanJobId },
              data: { eventId: targetEventId },
            });
          }

          const confidencePct =
            extraction.confidence <= 1 ? extraction.confidence * 100 : extraction.confidence;
          const { snapshot } = await upsertProfileSnapshotForEventTx(tx, {
            workspaceId: extraction.scanJob.workspaceId,
            eventId: targetEventId,
            governorId: governor.id,
            power: approvedPayload.power,
            killPoints: approvedPayload.killPoints,
            t4Kills: approvedPayload.t4Kills,
            t5Kills: approvedPayload.t5Kills,
            deads: approvedPayload.deads,
            confidencePct,
            changedByLinkId: auth.link.id,
            reason: body.reason || 'Manual OCR review approval',
          });

          snapshotId = snapshot.id;

          if (anomalies.length > 0) {
            await tx.anomaly.createMany({
              data: anomalies.map((anomaly) => ({
                workspaceId: extraction.scanJob.workspaceId,
                snapshotId: snapshot.id,
                governorId: governor.id,
                eventAId: targetEventId,
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
            workspaceId: extraction.scanJob.workspaceId,
            eventId: targetEventId,
            governorId: governor.id,
            metricKey: METRIC_KEY_POWER,
            metricValue: approvedPayload.power,
            sourceType: MetricObservationSourceType.PROFILE,
            sourceRank: null,
            sourceRefId: extraction.id,
            observedAt: new Date(),
            changedByLinkId: auth.link.id,
            reason: body.reason || 'Profile review approval sync (power)',
            governorNameRaw: approvedGovernorName,
          });

          await recordMetricObservationTx(tx, {
            workspaceId: extraction.scanJob.workspaceId,
            eventId: targetEventId,
            governorId: governor.id,
            metricKey: METRIC_KEY_KILL_POINTS,
            metricValue: approvedPayload.killPoints,
            sourceType: MetricObservationSourceType.PROFILE,
            sourceRank: null,
            sourceRefId: extraction.id,
            observedAt: new Date(),
            changedByLinkId: auth.link.id,
            reason: body.reason || 'Profile review approval sync (kill points)',
            governorNameRaw: approvedGovernorName,
          });
        } else if (!targetEventId && shouldSyncProfileMetrics) {
          await enqueueMetricSyncBacklogTx(tx, {
            workspaceId: extraction.scanJob.workspaceId,
            scanJobId: extraction.scanJobId,
            extractionId: extraction.id,
            governorId: governor.id,
            governorGameId: approvedPayload.governorId,
            governorNameRaw: approvedGovernorName,
            power: approvedPayload.power,
            killPoints: approvedPayload.killPoints,
            t4Kills: approvedPayload.t4Kills,
            t5Kills: approvedPayload.t5Kills,
            deads: approvedPayload.deads,
            sourceRefId: extraction.id,
            observedAt: new Date(),
            metadata: {
              reason: body.reason || null,
              source: 'review-queue-approval',
            },
          });
        } else if (syncSkipReason) {
          metricSyncSkippedReason = syncSkipReason;
        }
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
        linkedEventId,
        metricSyncSkippedReason,
        anomalyCount: anomalies.length,
        correctionCount: correctionEntries.length,
      };
    });

    if (!syncMessage && result.metricSyncSkippedReason) {
      syncMessage = result.metricSyncSkippedReason;
    }
    if (optionalCombatNormalization.notes.length > 0) {
      const normalizationNote = `Sanitized optional combat metrics: ${optionalCombatNormalization.notes.join('; ')}.`;
      syncMessage = syncMessage ? `${syncMessage} ${normalizationNote}` : normalizationNote;
    }

    invalidateServerCacheTags([
      ...Object.values(workspaceCacheTags(extraction.scanJob.workspaceId)),
      scanJobCacheTag(extraction.scanJobId),
    ]);

    await enqueueEmbeddingTaskSafe({
      workspaceId: extraction.scanJob.workspaceId,
      corpus: EmbeddingCorpus.OCR_EXTRACTIONS,
      operation: EmbeddingTaskOperation.UPSERT,
      entityType: 'ocr_extraction',
      entityId: result.extraction.id,
      payload: {
        reason: 'review_queue_update',
      },
    });

    return ok({
      id: result.extraction.id,
      status: result.extraction.status,
      scanJobId: result.extraction.scanJobId,
      snapshotId: result.snapshotId,
      linkedEventId: result.linkedEventId,
      anomalyCount: result.anomalyCount,
      correctionCount: result.correctionCount,
      syncState,
      eventLinked: Boolean(result.linkedEventId),
      syncMessage,
      warning: syncMessage,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
