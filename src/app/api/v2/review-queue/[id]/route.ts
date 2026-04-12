import { NextRequest } from 'next/server';
import {
  AnomalySeverity,
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
  parseExtractionValues,
  parseValidation,
  toApprovedSnapshotPayload,
} from '@/lib/review-queue';

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

const reviewSchema = z.object({
  status: z.nativeEnum(OcrExtractionStatus),
  reason: z.string().max(300).optional(),
  corrected: correctedSchema.optional(),
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
    const mergedValues = applyCorrections(parsedValues, body.corrected);
    const approvedPayload = toApprovedSnapshotPayload(mergedValues);

    if (body.status === OcrExtractionStatus.APPROVED) {
      if (!extraction.scanJob.eventId) {
        throw new ApiHttpError(
          'VALIDATION_ERROR',
          'Scan job is not linked to an event. Cannot approve into snapshots.',
          400
        );
      }
      if (!/^\d{6,12}$/.test(approvedPayload.governorId)) {
        throw new ApiHttpError(
          'VALIDATION_ERROR',
          'Governor ID must be 6-12 digits before approval.',
          400
        );
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

    const result = await prisma.$transaction(async (tx) => {
      const updatedExtraction = await tx.ocrExtraction.update({
        where: { id: extraction.id },
        data: {
          status: body.status,
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
      };
    });

    return ok({
      id: result.extraction.id,
      status: result.extraction.status,
      scanJobId: result.extraction.scanJobId,
      snapshotId: result.snapshotId,
      anomalyCount: result.anomalyCount,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
