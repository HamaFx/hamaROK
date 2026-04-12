import { NextRequest } from 'next/server';
import { ExportJobStatus, WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, handleApiError, readJson } from '@/lib/api-response';
import { parsePagination, getQueryParam } from '@/lib/v2';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { withIdempotency } from '@/lib/idempotency';
import { processSingleExportJob } from '@/lib/background-jobs';

const createExportSchema = z.object({
  workspaceId: z.string().min(1),
  eventA: z.string().min(1),
  eventB: z.string().min(1),
  format: z.enum(['csv', 'xlsx', 'json', 'pack']).default('xlsx'),
  mode: z.enum(['sync', 'queued']).default('sync'),
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

    const { limit, offset } = parsePagination(request, { limit: 25, offset: 0 });
    const [jobs, total] = await Promise.all([
      prisma.exportJob.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.exportJob.count({ where: { workspaceId } }),
    ]);

    return ok(
      jobs.map((job) => ({
        id: job.id,
        status: job.status,
        format: job.format,
        workspaceId: job.workspaceId,
        eventAId: job.eventAId,
        eventBId: job.eventBId,
        resultArtifactId: job.resultArtifactId,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        error: job.error,
      })),
      { total, limit, offset }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createExportSchema.parse(await readJson(request));
    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.VIEWER
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const idempotent = await withIdempotency({
      workspaceId: body.workspaceId,
      scope: 'export-job',
      key: body.idempotencyKey,
      request: {
        eventA: body.eventA,
        eventB: body.eventB,
        format: body.format,
        mode: body.mode,
      },
      execute: async () => {
        const created = await prisma.exportJob.create({
          data: {
            workspaceId: body.workspaceId,
            eventAId: body.eventA,
            eventBId: body.eventB,
            format: body.format,
            status:
              body.mode === 'sync'
                ? ExportJobStatus.PROCESSING
                : ExportJobStatus.QUEUED,
            idempotencyKey: body.idempotencyKey || null,
            request: {
              eventA: body.eventA,
              eventB: body.eventB,
              format: body.format,
              mode: body.mode,
            },
            startedAt: body.mode === 'sync' ? new Date() : null,
          },
        });

        if (body.mode === 'sync') {
          await processSingleExportJob(created.id);
        }

        const refreshed = await prisma.exportJob.findUnique({
          where: { id: created.id },
          include: {
            resultArtifact: {
              select: {
                id: true,
                url: true,
                bytes: true,
              },
            },
          },
        });

        if (!refreshed) {
          throw new Error('Export job was not found after creation.');
        }

        return {
          id: refreshed.id,
          status: refreshed.status,
          format: refreshed.format,
          workspaceId: refreshed.workspaceId,
          resultArtifactId: refreshed.resultArtifactId,
          artifact: refreshed.resultArtifact,
          createdAt: refreshed.createdAt.toISOString(),
          startedAt: refreshed.startedAt?.toISOString() ?? null,
          completedAt: refreshed.completedAt?.toISOString() ?? null,
          error: refreshed.error,
        };
      },
    });

    const status =
      idempotent.value.status === ExportJobStatus.QUEUED
        ? 202
        : idempotent.replayed
          ? 200
          : 201;

    return ok(
      idempotent.value,
      idempotent.replayed ? { idempotentReplay: true } : null,
      status
    );
  } catch (error) {
    return handleApiError(error);
  }
}
