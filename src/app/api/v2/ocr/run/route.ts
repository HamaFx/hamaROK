import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { validateGovernorData } from '@/lib/ocr/validators';
import { listWorkspaceRuntimeProfiles } from '@/lib/ocr/profile-store';
import { normalizeFieldValue } from '@/lib/ocr/field-config';
import { selectBestRuntimeProfile } from '@/lib/ocr/profiles';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { splitGovernorNameAndAlliance } from '@/lib/alliances';

const fieldSchema = z.object({
  value: z.string().default(''),
  confidence: z.number().min(0).max(100).default(0),
  croppedImage: z.string().optional(),
  trace: z.unknown().optional(),
});

const extractionSchema = z.object({
  engineVersion: z.string().optional(),
  templateId: z.string().optional(),
  profileId: z.string().optional(),
  screenArchetype: z.enum(['governor-profile', 'rankboard']).optional(),
  rankingType: z.string().optional(),
  metricKey: z.string().optional(),
  rowCandidates: z.record(z.string(), z.unknown()).optional(),
  rows: z
    .array(
      z.object({
        rowIndex: z.number().int().min(0).max(200),
        sourceRank: z.number().int().min(1).max(5000).nullable().optional(),
        governorNameRaw: z.string().default(''),
        governorNameNormalized: z.string().optional(),
        allianceRaw: z.string().optional().nullable(),
        titleRaw: z.string().optional().nullable(),
        metricRaw: z.string().default(''),
        metricValue: z.string().default(''),
        confidence: z.number().min(0).max(100).default(0),
        identityStatus: z.string().optional(),
        candidates: z.record(z.string(), z.unknown()).optional(),
        failureReasons: z.array(z.string()).optional(),
        ocrTrace: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .optional(),
  averageConfidence: z.number().optional(),
  lowConfidence: z.boolean().optional(),
  failureReasons: z.array(z.string()).optional(),
  metadata: z
    .object({
      classificationConfidence: z.number().optional(),
      droppedRowCount: z.number().int().min(0).optional(),
      guardFailures: z.array(z.string()).optional(),
      detectedBoardTokens: z.array(z.string()).optional(),
    })
    .optional(),
  governorId: fieldSchema.optional(),
  governorName: fieldSchema.optional(),
  power: fieldSchema.optional(),
  killPoints: fieldSchema.optional(),
  t4Kills: fieldSchema.optional(),
  t5Kills: fieldSchema.optional(),
  deads: fieldSchema.optional(),
  preprocessingTrace: z.record(z.string(), z.unknown()).optional(),
  candidates: z.record(z.string(), z.unknown()).optional(),
  fusionDecision: z.record(z.string(), z.unknown()).optional(),
});

const requestSchema = z.object({
  workspaceId: z.string().min(1),
  preferredProfileId: z.string().optional().nullable(),
  imageMeta: z
    .object({
      width: z.number().int().min(100).max(12000),
      height: z.number().int().min(100).max(12000),
      fileName: z.string().max(200).optional(),
    })
    .optional(),
  extraction: extractionSchema.optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = requestSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const profiles = await listWorkspaceRuntimeProfiles(body.workspaceId);
    const profileSelection = body.imageMeta
      ? selectBestRuntimeProfile({
          width: body.imageMeta.width,
          height: body.imageMeta.height,
          profiles,
          preferredProfileId: body.preferredProfileId ?? undefined,
          preferredArchetype:
            body.extraction?.screenArchetype === 'rankboard'
              ? 'rankboard'
              : body.extraction?.screenArchetype === 'governor-profile'
                ? 'governor-profile'
                : undefined,
        })
      : null;

    if (!body.extraction) {
      return ok({
        profileSelection,
        note: 'No extraction payload was provided. Submit client OCR output for diagnostics.',
      });
    }

    if (
      body.extraction.screenArchetype === 'rankboard' ||
      Array.isArray(body.extraction.rows)
    ) {
      const rows = body.extraction.rows || [];
      const normalizedRows = rows.map((row) => {
        const split = splitGovernorNameAndAlliance({
          governorNameRaw: row.governorNameRaw || '',
          allianceRaw: row.allianceRaw || null,
          subtitleRaw: row.titleRaw || null,
        });
        const governorNameRaw = String(split.governorNameRaw || row.governorNameRaw || '')
          .replace(/[^\x20-\x7E]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const metricValue = String(row.metricValue || row.metricRaw || '').replace(/[^0-9]/g, '');
        const sourceRank =
          typeof row.sourceRank === 'number' && Number.isFinite(row.sourceRank)
            ? Math.floor(row.sourceRank)
            : null;
        const failureReasons = [...(row.failureReasons || [])];
        if (!governorNameRaw) failureReasons.push('name:empty-name');
        if (!metricValue) failureReasons.push('metric:missing-metric-digits');
        if (sourceRank != null && (sourceRank < 1 || sourceRank > 5000)) {
          failureReasons.push('rank:rank-out-of-range');
        }
        return {
          rowIndex: row.rowIndex,
          sourceRank,
          governorNameRaw,
          governorNameNormalized:
            row.governorNameNormalized ||
            governorNameRaw.toLowerCase().replace(/[^a-z0-9]/g, ''),
          allianceRaw: split.allianceRaw ? String(split.allianceRaw).trim() : null,
          titleRaw: row.titleRaw ? String(row.titleRaw).trim() : null,
          metricRaw: String(row.metricRaw || metricValue),
          metricValue,
          confidence: row.confidence,
          identityStatus: row.identityStatus || 'UNRESOLVED',
          candidates: row.candidates || {},
          failureReasons: [...new Set(failureReasons)],
          ocrTrace: {
            ...(row.ocrTrace || {}),
            allianceDetection: {
              tag: split.allianceTag,
              trackedAlliance: split.trackedAlliance,
              detectionSource: split.detectionSource,
              confidence: split.confidence,
            },
          },
        };
      });

      const lowConfidenceRows = normalizedRows.filter(
        (row) => row.confidence < 70 || row.failureReasons.length > 0
      );
      const guardFailures = Array.isArray(body.extraction.metadata?.guardFailures)
        ? body.extraction.metadata?.guardFailures.filter((entry) => typeof entry === 'string')
        : [];
      const detectedBoardTokens = Array.isArray(body.extraction.metadata?.detectedBoardTokens)
        ? body.extraction.metadata?.detectedBoardTokens.filter((entry) => typeof entry === 'string')
        : [];
      const lowConfidence =
        body.extraction.lowConfidence ||
        normalizedRows.length === 0 ||
        lowConfidenceRows.length > 0 ||
        guardFailures.length > 0;

      return ok({
        engineVersion: body.extraction.engineVersion || 'ocr-v3',
        profileId:
          body.extraction.profileId ||
          profileSelection?.profile.id ||
          body.preferredProfileId ||
          null,
        templateId:
          body.extraction.templateId ||
          profileSelection?.profile.sourceTemplateId ||
          null,
        screenArchetype: 'rankboard',
        rankingType: body.extraction.rankingType || 'unknown',
        metricKey: body.extraction.metricKey || 'metric',
        profileSelection,
        rows: normalizedRows,
        lowConfidence,
        lowConfidenceFields: lowConfidenceRows.map((row) => `row:${row.rowIndex}`),
        guardFailures,
        detectedBoardTokens,
        failureReasons: [
          ...(body.extraction.failureReasons || []),
          ...guardFailures,
          ...lowConfidenceRows
            .flatMap((row) => row.failureReasons)
            .slice(0, 80),
        ],
        metadata: {
          classificationConfidence:
            typeof body.extraction.metadata?.classificationConfidence === 'number' &&
            Number.isFinite(body.extraction.metadata.classificationConfidence)
              ? body.extraction.metadata.classificationConfidence
              : null,
          droppedRowCount:
            typeof body.extraction.metadata?.droppedRowCount === 'number' &&
            Number.isFinite(body.extraction.metadata.droppedRowCount)
              ? body.extraction.metadata.droppedRowCount
              : null,
          guardFailures,
          detectedBoardTokens,
        },
        preprocessingTrace: body.extraction.preprocessingTrace || {},
        rowCandidates: body.extraction.rowCandidates || {},
        passthrough: {
          averageConfidence: body.extraction.averageConfidence || 0,
          rowCount: normalizedRows.length,
        },
      });
    }

    if (
      !body.extraction.governorId ||
      !body.extraction.governorName ||
      !body.extraction.power ||
      !body.extraction.killPoints ||
      !body.extraction.t4Kills ||
      !body.extraction.t5Kills ||
      !body.extraction.deads
    ) {
      return fail(
        'VALIDATION_ERROR',
        'Profile extraction payload is missing one or more governor fields.',
        400
      );
    }

    const normalized = {
      governorId: normalizeFieldValue('governorId', body.extraction.governorId.value),
      governorName: normalizeFieldValue('governorName', body.extraction.governorName.value),
      power: normalizeFieldValue('power', body.extraction.power.value),
      killPoints: normalizeFieldValue('killPoints', body.extraction.killPoints.value),
      t4Kills: normalizeFieldValue('t4Kills', body.extraction.t4Kills.value),
      t5Kills: normalizeFieldValue('t5Kills', body.extraction.t5Kills.value),
      deads: normalizeFieldValue('deads', body.extraction.deads.value),
    };
    const allianceSplit = splitGovernorNameAndAlliance({
      governorNameRaw: normalized.governorName,
      allianceRaw:
        body.extraction &&
        body.extraction.candidates &&
        typeof body.extraction.candidates.alliance === 'string'
          ? body.extraction.candidates.alliance
          : null,
    });
    const normalizedWithAlliance = {
      ...normalized,
      governorName: allianceSplit.governorNameRaw || normalized.governorName,
      alliance: allianceSplit.allianceRaw,
      kingdomNumber: '4057',
    };

    const confidences = {
      governorId: body.extraction.governorId.confidence,
      name: body.extraction.governorName.confidence,
      power: body.extraction.power.confidence,
      killPoints: body.extraction.killPoints.confidence,
      t4Kills: body.extraction.t4Kills.confidence,
      t5Kills: body.extraction.t5Kills.confidence,
      deads: body.extraction.deads.confidence,
    };

    const validation = validateGovernorData({
      governorId: normalized.governorId,
      name: normalizedWithAlliance.governorName,
      power: normalized.power,
      killPoints: normalized.killPoints,
      t4Kills: normalized.t4Kills,
      t5Kills: normalized.t5Kills,
      deads: normalized.deads,
      confidences,
    });

    const lowConfidenceFields = Object.entries(confidences)
      .filter(([, value]) => value < 70)
      .map(([key]) => key);
    const lowConfidence =
      body.extraction.lowConfidence ||
      validation.some((item) => item.severity !== 'ok') ||
      lowConfidenceFields.length > 0;

    return ok({
      engineVersion: body.extraction.engineVersion || 'ocr-v3',
      profileId:
        body.extraction.profileId ||
        profileSelection?.profile.id ||
        body.preferredProfileId ||
        null,
      templateId:
        body.extraction.templateId ||
        profileSelection?.profile.sourceTemplateId ||
        null,
      screenArchetype: body.extraction.screenArchetype || 'governor-profile',
      profileSelection,
      normalized: normalizedWithAlliance,
      validation,
      lowConfidence,
      lowConfidenceFields,
      failureReasons: [
        ...(body.extraction.failureReasons || []),
        ...validation
          .filter((entry) => entry.severity !== 'ok')
          .map((entry) => `${entry.field}:${entry.warning || 'invalid'}`),
      ],
      preprocessingTrace: body.extraction.preprocessingTrace || {},
      candidates: body.extraction.candidates || {},
      fusionDecision: body.extraction.fusionDecision || {},
      passthrough: {
        averageConfidence: body.extraction.averageConfidence || 0,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
