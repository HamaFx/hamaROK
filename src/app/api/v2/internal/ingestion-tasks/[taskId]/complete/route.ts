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
import {
  normalizeGovernorAlias,
  normalizeOcrNumericDigits,
  validateStrictRankingTypeMetricPair,
} from '@/lib/rankings/normalize';

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

type RankingPayload = z.infer<typeof rankingPayloadSchema>;

const completeSchema = z.object({
  ingestionDomain: z.nativeEnum(IngestionDomain).optional(),
  screenArchetype: z.string().max(80).optional(),
  attempt: z.number().int().min(1).max(20).optional(),
  workerId: z.string().max(120).optional(),
  profile: profilePayloadSchema.optional(),
  ranking: rankingPayloadSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

interface RankingGuardRule {
  minMetricDigits: number;
  minRows: number;
  uniformDominanceRatio: number;
  uniformDominanceMinCount: number;
}

const RANKING_GUARD_RULES: Record<string, RankingGuardRule> = {
  individual_power: {
    minMetricDigits: 5,
    minRows: 3,
    uniformDominanceRatio: 0.8,
    uniformDominanceMinCount: 4,
  },
  mad_scientist: {
    minMetricDigits: 2,
    minRows: 3,
    uniformDominanceRatio: 0.8,
    uniformDominanceMinCount: 4,
  },
  fort_destroyer: {
    minMetricDigits: 1,
    minRows: 3,
    uniformDominanceRatio: 0.8,
    uniformDominanceMinCount: 4,
  },
  kill_point: {
    minMetricDigits: 4,
    minRows: 3,
    uniformDominanceRatio: 0.8,
    uniformDominanceMinCount: 4,
  },
};

const RANKING_NAME_HEADER_TOKENS = new Set([
  'NAME',
  'RANK',
  'RANKING',
  'RANKINGS',
  'POWER',
  'CONTRIBUTION',
  'CONTRIBUTIONPOINTS',
  'FORT',
  'FORTS',
  'FORTDESTROYED',
  'FORTSDESTROYED',
  'KILLPOINT',
  'KILLPOINTS',
  'METRIC',
  'GOVERNORPROFILE',
]);

const RANKING_METRIC_HEADER_TOKENS: Record<string, string[]> = {
  power: ['POWER'],
  contribution_points: ['CONTRIBUTION', 'CONTRIBUTIONPOINTS', 'TECHCONTRIBUTION'],
  fort_destroying: ['FORT', 'FORTDESTROYED', 'FORTSDESTROYED', 'FORTDESTROYING'],
  kill_points: ['KILLPOINT', 'KILLPOINTS'],
};

function normalizeArtifactToken(value: string): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function isRankingHeaderNameToken(value: string): boolean {
  const token = normalizeArtifactToken(value);
  if (!token) return true;
  return RANKING_NAME_HEADER_TOKENS.has(token);
}

function detectBoardTokens(value: string): string[] {
  const normalized = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];
  const compact = normalized.replace(/\s+/g, '');
  const known = [
    'INDIVIDUAL POWER',
    'MAD SCIENTIST',
    'FORT DESTROYER',
    'KILL POINT',
    'KILL POINTS',
  ];
  const detected = known.filter((token) => {
    const compactToken = token.replace(/\s+/g, '');
    return normalized.includes(token) || compact.includes(compactToken);
  });
  return [...new Set(detected)];
}

function isMetricHeaderArtifact(metricRaw: string, metricKey: string, headerText?: string | null): boolean {
  const rawToken = normalizeArtifactToken(metricRaw);
  if (!rawToken) return true;

  const expectedTokens = RANKING_METRIC_HEADER_TOKENS[metricKey] || [];
  if (expectedTokens.includes(rawToken)) return true;
  if (expectedTokens.some((token) => token.includes(rawToken) || rawToken.includes(token))) {
    return true;
  }

  const headerToken = normalizeArtifactToken(headerText || '');
  if (headerToken && (headerToken.includes(rawToken) || rawToken.includes(headerToken))) {
    return true;
  }

  return RANKING_NAME_HEADER_TOKENS.has(rawToken);
}

function evaluateMetricUniformity(
  metricValues: string[],
  rule: RankingGuardRule
): {
  suspicious: boolean;
  dominantValue: string | null;
  dominantCount: number;
  dominantRatio: number;
} {
  const cleaned = metricValues.map((value) => String(value || '').trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return {
      suspicious: false,
      dominantValue: null,
      dominantCount: 0,
      dominantRatio: 0,
    };
  }

  const counts = new Map<string, number>();
  for (const value of cleaned) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const [dominantValue, dominantCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const dominantRatio = dominantCount / cleaned.length;
  const suspicious =
    cleaned.length >= rule.uniformDominanceMinCount &&
    dominantCount >= rule.uniformDominanceMinCount &&
    dominantRatio >= rule.uniformDominanceRatio;

  return {
    suspicious,
    dominantValue,
    dominantCount,
    dominantRatio,
  };
}

function sanitizeRankingPayload(args: {
  ranking: RankingPayload;
  rankingType: string;
  metricKey: string;
}) {
  const rule =
    RANKING_GUARD_RULES[args.rankingType] || {
      minMetricDigits: 1,
      minRows: 3,
      uniformDominanceRatio: 0.8,
      uniformDominanceMinCount: 4,
    };
  const rows: Array<z.infer<typeof rowSchema>> = [];
  const dedupe = new Set<string>();
  const droppedReasonCount: Record<string, number> = {};
  let droppedRowCount = 0;

  for (const row of args.ranking.rows) {
    const split = splitGovernorNameAndAlliance({
      governorNameRaw: row.governorNameRaw,
      allianceRaw: row.allianceRaw || null,
      subtitleRaw: row.titleRaw || null,
    });
    const governorNameRaw = String(split.governorNameRaw || row.governorNameRaw || '')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    const governorNameNormalized = normalizeGovernorAlias(governorNameRaw);

    const metricRaw = String(row.metricRaw ?? row.metricValue ?? '')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    const hasRawDigit = /[0-9]/.test(metricRaw);
    const metricValueFromRaw = hasRawDigit ? normalizeOcrNumericDigits(metricRaw) : '';
    const metricValue =
      metricValueFromRaw ||
      (hasRawDigit ? normalizeOcrNumericDigits(row.metricValue) : '');
    const metricHeaderArtifact =
      !hasRawDigit && isMetricHeaderArtifact(metricRaw, args.metricKey, args.ranking.headerText);

    let dropReason: string | null = null;
    if (!governorNameRaw || !governorNameNormalized || isRankingHeaderNameToken(governorNameRaw)) {
      dropReason = 'header-row-artifact';
    } else if (!hasRawDigit) {
      dropReason = metricHeaderArtifact ? 'header-row-artifact' : 'metric-no-raw-digit';
    } else if (!metricValue || metricValue.length < rule.minMetricDigits) {
      dropReason = 'metric-too-short';
    }

    if (dropReason) {
      droppedRowCount += 1;
      droppedReasonCount[dropReason] = (droppedReasonCount[dropReason] || 0) + 1;
      continue;
    }

    const sourceRank =
      typeof row.sourceRank === 'number' && Number.isFinite(row.sourceRank)
        ? Math.max(1, Math.min(5000, Math.floor(row.sourceRank)))
        : null;
    const dedupeKey = `${sourceRank || 0}:${governorNameNormalized}:${metricValue}`;
    if (dedupe.has(dedupeKey)) {
      droppedRowCount += 1;
      droppedReasonCount.duplicate = (droppedReasonCount.duplicate || 0) + 1;
      continue;
    }
    dedupe.add(dedupeKey);

    rows.push({
      sourceRank,
      governorNameRaw,
      allianceRaw: split.allianceRaw || row.allianceRaw || null,
      titleRaw: row.titleRaw || null,
      metricRaw: metricRaw || metricValue,
      metricValue,
      confidence:
        typeof row.confidence === 'number' && Number.isFinite(row.confidence)
          ? Math.max(0, Math.min(100, row.confidence))
          : undefined,
      ocrTrace: row.ocrTrace,
      candidates: row.candidates,
    });
  }

  const guardFailures = new Set<string>();
  if (rows.length < rule.minRows) {
    guardFailures.add('insufficient-valid-rows');
    if ((droppedReasonCount['header-row-artifact'] || 0) > 0) {
      guardFailures.add('header-row-artifact');
    }
  }

  const uniformity = evaluateMetricUniformity(
    rows.map((row) => normalizeOcrNumericDigits(row.metricValue)),
    rule
  );
  if (rows.length >= rule.minRows && uniformity.suspicious) {
    guardFailures.add('uniform-metric-suspect');
  }

  const metadataRecord =
    args.ranking.metadata && typeof args.ranking.metadata === 'object'
      ? ({ ...args.ranking.metadata } as Record<string, unknown>)
      : {};
  const classificationConfidence =
    typeof metadataRecord.classificationConfidence === 'number' &&
    Number.isFinite(metadataRecord.classificationConfidence)
      ? metadataRecord.classificationConfidence
      : null;
  const detectedBoardTokens = detectBoardTokens(args.ranking.headerText || '');

  return {
    rows,
    diagnostics: {
      classificationConfidence,
      droppedRowCount,
      droppedReasonCount,
      guardFailures: [...guardFailures],
      detectedBoardTokens,
      uniformity,
    },
  };
}

type ProfilePayload = z.infer<typeof profilePayloadSchema>;

function normalizeDigits(value: unknown): string {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

function extractFieldValue(fields: Record<string, unknown>, key: string): string {
  const entry = fields[key];
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const value = (entry as Record<string, unknown>).value;
    return String(value ?? '');
  }
  return '';
}

function sanitizeProfilePayload(profile: ProfilePayload): {
  fields: Record<string, unknown>;
  normalized: Record<string, unknown>;
  lowConfidence: boolean;
  failureReasons: string[];
  artifactGuards: string[];
} {
  const fields =
    profile.fields && typeof profile.fields === 'object' && !Array.isArray(profile.fields)
      ? ({ ...(profile.fields as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const normalized =
    profile.normalized && typeof profile.normalized === 'object' && !Array.isArray(profile.normalized)
      ? ({ ...(profile.normalized as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const failureReasons = Array.isArray(profile.failureReasons) ? [...profile.failureReasons] : [];
  const artifactGuards: string[] = [];

  let lowConfidence = profile.lowConfidence ?? normalizeConfidence(profile.confidence) < 0.85;

  const powerRaw =
    typeof normalized.power === 'string' ? normalized.power : extractFieldValue(fields, 'power');
  const killPointsRaw =
    typeof normalized.killPoints === 'string'
      ? normalized.killPoints
      : extractFieldValue(fields, 'killPoints');

  const powerDigits = normalizeDigits(powerRaw);
  const killPointsDigits = normalizeDigits(killPointsRaw);
  const powerValue = powerDigits ? BigInt(powerDigits) : BigInt(0);

  if (killPointsDigits === '111015' && powerValue >= BigInt(1_000_000)) {
    const killPointsField =
      fields.killPoints && typeof fields.killPoints === 'object' && !Array.isArray(fields.killPoints)
        ? (fields.killPoints as Record<string, unknown>)
        : {};

    fields.killPoints = {
      ...killPointsField,
      value: '',
      confidence:
        typeof killPointsField.confidence === 'number'
          ? Math.min(Math.max(killPointsField.confidence, 0), 20)
          : 0,
      artifactGuard: 'kill-points-known-artifact-111015',
    };

    normalized.killPoints = '';
    lowConfidence = true;
    artifactGuards.push('kill-points-known-artifact-111015');
    failureReasons.push('kill-points-known-artifact-111015');
  }

  return {
    fields,
    normalized,
    lowConfidence,
    failureReasons: [...new Set(failureReasons)],
    artifactGuards,
  };
}

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
  if (normalized === OcrProvider.MISTRAL) return OcrProvider.MISTRAL;
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
      const sanitizedProfile = sanitizeProfilePayload(profile);

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
              lowConfidence: sanitizedProfile.lowConfidence,
              failureReasons: sanitizedProfile.failureReasons.length > 0
                ? (sanitizedProfile.failureReasons as unknown as Prisma.InputJsonValue)
                : undefined,
              fields: sanitizedProfile.fields as Prisma.InputJsonValue,
              normalized: Object.keys(sanitizedProfile.normalized).length > 0
                ? (sanitizedProfile.normalized as Prisma.InputJsonValue)
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
          normalized: sanitizedProfile.normalized,
          fields: sanitizedProfile.fields,
        });

        if (profileAlliance) {
          await tx.ocrExtraction.update({
            where: { id: extraction.id },
            data: {
              normalized: {
                ...sanitizedProfile.normalized,
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
              artifactGuards:
                sanitizedProfile.artifactGuards.length > 0
                  ? sanitizedProfile.artifactGuards
                  : undefined,
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
        `unsupported-header: ${strictPair.reason || 'Unsupported rankingType/metricKey pair.'}`,
        400,
        {
          guardFailures: ['unsupported-header'],
          rankingType: strictPair.rankingType,
          metricKey: strictPair.metricKey,
          expectedMetricKey: strictPair.expectedMetricKey,
        }
      );
    }

    const sanitizedRanking = sanitizeRankingPayload({
      ranking,
      rankingType: strictPair.rankingType,
      metricKey: strictPair.metricKey,
    });
    if (sanitizedRanking.diagnostics.guardFailures.length > 0) {
      return fail(
        'VALIDATION_ERROR',
        `ranking-guard-failure: ${sanitizedRanking.diagnostics.guardFailures.join(', ')}`,
        400,
        {
          rankingType: strictPair.rankingType,
          metricKey: strictPair.metricKey,
          guardFailures: sanitizedRanking.diagnostics.guardFailures,
          droppedRowCount: sanitizedRanking.diagnostics.droppedRowCount,
          droppedReasonCount: sanitizedRanking.diagnostics.droppedReasonCount,
          detectedBoardTokens: sanitizedRanking.diagnostics.detectedBoardTokens,
          uniformity: sanitizedRanking.diagnostics.uniformity,
        }
      );
    }

    const rankingRun = await createRankingRunWithRows({
      workspaceId: task.workspaceId,
      eventId: task.eventId || task.scanJob.eventId || null,
      source: task.scanJob.source,
      domain: IngestionDomain.RANKING_CAPTURE,
      rankingType: strictPair.rankingType,
      metricKey: strictPair.metricKey,
      headerText: ranking.headerText,
      artifactId: task.artifactId,
      metadata: {
        ...(ranking.metadata || {}),
        classificationConfidence: sanitizedRanking.diagnostics.classificationConfidence,
        droppedRowCount: sanitizedRanking.diagnostics.droppedRowCount,
        guardFailures: sanitizedRanking.diagnostics.guardFailures,
        detectedBoardTokens: sanitizedRanking.diagnostics.detectedBoardTokens,
        droppedReasonCount: sanitizedRanking.diagnostics.droppedReasonCount,
        uniformity: sanitizedRanking.diagnostics.uniformity,
        ...(body.metadata || {}),
        taskId: task.id,
        screenArchetype: body.screenArchetype || 'ranking_board',
        kingdomNumber: '4057',
      } as Prisma.InputJsonValue,
      notes: `Ingestion task completion ${task.id}`,
      idempotencyKey: `ingestion-task:${task.id}:ranking-run`,
      rows: sanitizedRanking.rows,
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
            droppedRowCount: sanitizedRanking.diagnostics.droppedRowCount,
            guardFailures:
              sanitizedRanking.diagnostics.guardFailures.length > 0
                ? sanitizedRanking.diagnostics.guardFailures
                : undefined,
            detectedBoardTokens: sanitizedRanking.diagnostics.detectedBoardTokens,
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
