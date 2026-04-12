import { NextRequest } from 'next/server';
import {
  ArtifactType,
  OcrExtractionStatus,
  OcrProvider,
  Prisma,
  ScanJobStatus,
  WorkspaceRole,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, handleApiError, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { getFallbackOcrDailyLimit, isFallbackOcrEnabled } from '@/lib/env';

const extractionSchema = z.object({
  provider: z.nativeEnum(OcrProvider).default(OcrProvider.TESSERACT),
  status: z.nativeEnum(OcrExtractionStatus).default(OcrExtractionStatus.RAW),
  governorIdRaw: z.string().max(50).optional(),
  governorNameRaw: z.string().max(80).optional(),
  confidence: z.number().min(0).max(1),
  fields: z.record(z.string(), z.unknown()),
  normalized: z.record(z.string(), z.unknown()).optional(),
  validation: z.record(z.string(), z.unknown()).optional(),
  artifactUrl: z.string().url().optional(),
  artifactType: z.nativeEnum(ArtifactType).optional(),
});

function startOfDayUtc() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = await prisma.scanJob.findUnique({
      where: { id },
      select: { id: true, workspaceId: true },
    });

    if (!job) {
      return fail('NOT_FOUND', 'Scan job not found.', 404);
    }

    const auth = await authorizeWorkspaceAccess(
      request,
      job.workspaceId,
      WorkspaceRole.VIEWER
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const extractions = await prisma.ocrExtraction.findMany({
      where: { scanJobId: id },
      orderBy: { createdAt: 'asc' },
    });

    return ok(
      extractions.map((entry) => ({
        id: entry.id,
        scanJobId: entry.scanJobId,
        provider: entry.provider,
        status: entry.status,
        governorIdRaw: entry.governorIdRaw,
        governorNameRaw: entry.governorNameRaw,
        confidence: entry.confidence,
        fields: entry.fields,
        normalized: entry.normalized,
        validation: entry.validation,
        createdAt: entry.createdAt.toISOString(),
      }))
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = await prisma.scanJob.findUnique({
      where: { id },
      include: { workspace: { include: { settings: true } } },
    });

    if (!job) {
      return fail('NOT_FOUND', 'Scan job not found.', 404);
    }

    const auth = await authorizeWorkspaceAccess(
      request,
      job.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const body = extractionSchema.parse(await readJson(request));

    if (body.provider === OcrProvider.FALLBACK) {
      const settings = job.workspace.settings;
      const enabled = settings?.fallbackOcrEnabled || isFallbackOcrEnabled();
      if (!enabled) {
        return fail('FORBIDDEN', 'Fallback OCR is disabled for this workspace.', 403);
      }

      const dailyLimit =
        settings?.fallbackOcrDailyLimit ??
        getFallbackOcrDailyLimit();
      const dailyCount = await prisma.ocrExtraction.count({
        where: {
          provider: OcrProvider.FALLBACK,
          scanJob: {
            workspaceId: job.workspaceId,
          },
          createdAt: {
            gte: startOfDayUtc(),
          },
        },
      });

      if (dailyCount >= dailyLimit) {
        return fail(
          'RATE_LIMITED',
          `Fallback OCR daily limit reached (${dailyLimit}).`,
          429
        );
      }
    }

    const extraction = await prisma.$transaction(async (tx) => {
      const artifact = body.artifactUrl
        ? await tx.artifact.create({
            data: {
              workspaceId: job.workspaceId,
              scanJobId: job.id,
              type: body.artifactType || ArtifactType.OCR_CROP,
              url: body.artifactUrl,
            },
          })
        : null;

      const created = await tx.ocrExtraction.create({
        data: {
          scanJobId: job.id,
          artifactId: artifact?.id ?? null,
          provider: body.provider,
          status: body.status,
          governorIdRaw: body.governorIdRaw || null,
          governorNameRaw: body.governorNameRaw || null,
          confidence: body.confidence,
          fields: body.fields as Prisma.InputJsonValue,
          normalized: body.normalized
            ? (body.normalized as Prisma.InputJsonValue)
            : undefined,
          validation: body.validation
            ? (body.validation as Prisma.InputJsonValue)
            : undefined,
        },
      });

      await tx.scanJob.update({
        where: { id: job.id },
        data: {
          status:
            OcrExtractionStatus.APPROVED === body.status
              ? ScanJobStatus.REVIEW
              : undefined,
          processedFiles: { increment: 1 },
          lowConfidenceFiles: body.confidence < 0.85 ? { increment: 1 } : undefined,
        },
      });

      return created;
    });

    return ok(
      {
        id: extraction.id,
        scanJobId: extraction.scanJobId,
        provider: extraction.provider,
        status: extraction.status,
        confidence: extraction.confidence,
        fields: extraction.fields,
        normalized: extraction.normalized,
        validation: extraction.validation,
        createdAt: extraction.createdAt.toISOString(),
      },
      null,
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
