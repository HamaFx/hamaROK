import { NextRequest } from 'next/server';
import { ScanJobSource, ScanJobStatus, WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, handleApiError, readJson } from '@/lib/api-response';
import { parsePagination, getQueryParam } from '@/lib/v2';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { withIdempotency } from '@/lib/idempotency';
import { isAdbCaptureRndEnabled } from '@/lib/env';
import { dispatchOcrWork } from '@/lib/aws/ocr-dispatch';

const createScanJobSchema = z.object({
  workspaceId: z.string().min(1),
  eventId: z.string().optional(),
  source: z.nativeEnum(ScanJobSource).default(ScanJobSource.MANUAL_UPLOAD),
  totalFiles: z.number().int().min(0).max(5000).default(0),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const workspaceId = getQueryParam(request, 'workspaceId');
    if (!workspaceId) {
      return fail('VALIDATION_ERROR', 'workspaceId is required.', 400);
    }

    const auth = await authorizeWorkspaceAccess(
      request,
      workspaceId,
      WorkspaceRole.VIEWER
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const statusParam = getQueryParam(request, 'status');
    const status =
      statusParam && Object.values(ScanJobStatus).includes(statusParam as ScanJobStatus)
        ? (statusParam as ScanJobStatus)
        : null;

    const { limit, offset } = parsePagination(request, { limit: 50, offset: 0 });

    const where = {
      workspaceId,
      ...(status ? { status } : {}),
    };

    const [jobs, total] = await Promise.all([
      prisma.scanJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          _count: { select: { ocrExtractions: true, artifacts: true } },
        },
      }),
      prisma.scanJob.count({ where }),
    ]);

    return ok(
      jobs.map((job) => ({
        id: job.id,
        workspaceId: job.workspaceId,
        eventId: job.eventId,
        status: job.status,
        source: job.source,
        totalFiles: job.totalFiles,
        processedFiles: job.processedFiles,
        lowConfidenceFiles: job.lowConfidenceFiles,
        notes: job.notes,
        error: job.error,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        counts: job._count,
      })),
      { total, limit, offset }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createScanJobSchema.parse(await readJson(request));
    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    if (body.source === ScanJobSource.ADB_RND && !isAdbCaptureRndEnabled()) {
      return fail(
        'FORBIDDEN',
        'ADB-assisted capture is currently disabled (R&D-only feature flag).',
        403
      );
    }

    const idempotent = await withIdempotency({
      workspaceId: body.workspaceId,
      scope: 'scan-job',
      key: body.idempotencyKey,
      request: body,
      execute: async () => {
        const job = await prisma.scanJob.create({
          data: {
            workspaceId: body.workspaceId,
            eventId: body.eventId || null,
            source: body.source,
            status: ScanJobStatus.QUEUED,
            idempotencyKey: body.idempotencyKey || null,
            totalFiles: body.totalFiles,
            notes: body.notes?.trim() || null,
          },
        });

        return {
          id: job.id,
          workspaceId: job.workspaceId,
          eventId: job.eventId,
          status: job.status,
          source: job.source,
          totalFiles: job.totalFiles,
          processedFiles: job.processedFiles,
          lowConfidenceFiles: job.lowConfidenceFiles,
          createdAt: job.createdAt.toISOString(),
        };
      },
    });

    if (!idempotent.replayed) {
      await dispatchOcrWork({
        type: 'scan_job_created',
        workspaceId: idempotent.value.workspaceId,
        eventId: idempotent.value.eventId,
        scanJobId: idempotent.value.id,
        source: idempotent.value.source,
        payload: {
          totalFiles: idempotent.value.totalFiles,
        },
      });
    }

    return ok(
      idempotent.value,
      idempotent.replayed ? { idempotentReplay: true } : null,
      idempotent.replayed ? 200 : 201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
