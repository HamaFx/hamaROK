import { NextRequest } from 'next/server';
import { IngestionTaskStatus, WorkspaceRole } from '@prisma/client';
import { ApiHttpError, fail, handleApiError, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { makeServerCacheKey, withServerCache } from '@/lib/server-cache';
import { scanJobCacheTag, workspaceCacheTags } from '@/lib/cache-scopes';

function summarizeTasks(rows: Array<{ status: IngestionTaskStatus; _count: { _all: number } }>) {
  const summary: Record<string, number> = {};
  for (const row of rows) {
    summary[row.status] = row._count._all;
  }
  return summary;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: scanJobId } = await params;

    const baseScanJob = await prisma.scanJob.findUnique({
      where: { id: scanJobId },
      select: {
        id: true,
        workspaceId: true,
      },
    });

    if (!baseScanJob) {
      return fail('NOT_FOUND', 'Scan job not found.', 404);
    }

    const auth = await authorizeWorkspaceAccess(request, baseScanJob.workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const tags = workspaceCacheTags(baseScanJob.workspaceId);
    const payload = await withServerCache(
      makeServerCacheKey('api:v2:scan-job:detail', {
        scanJobId,
      }),
      {
        ttlMs: 2_000,
        tags: [tags.all, tags.scanJobs, scanJobCacheTag(scanJobId)],
      },
      async () => {
        const [scanJob, taskSummaryRows, taskCount] = await Promise.all([
          prisma.scanJob.findUnique({
            where: { id: scanJobId },
            include: {
              _count: {
                select: {
                  ingestionTasks: true,
                  artifacts: true,
                  ocrExtractions: true,
                },
              },
            },
          }),
          prisma.ingestionTask.groupBy({
            by: ['status'],
            where: {
              scanJobId,
            },
            _count: { _all: true },
          }),
          prisma.ingestionTask.count({
            where: {
              scanJobId,
            },
          }),
        ]);

        if (!scanJob) {
          throw new ApiHttpError('NOT_FOUND', 'Scan job not found.', 404, undefined, true, {
            source: 'api',
            category: 'not_found',
            retryable: false,
          });
        }

        return {
          id: scanJob.id,
          workspaceId: scanJob.workspaceId,
          eventId: scanJob.eventId,
          status: scanJob.status,
          source: scanJob.source,
          idempotencyKey: scanJob.idempotencyKey,
          totalFiles: scanJob.totalFiles,
          processedFiles: scanJob.processedFiles,
          lowConfidenceFiles: scanJob.lowConfidenceFiles,
          notes: scanJob.notes,
          error: scanJob.error,
          createdAt: scanJob.createdAt.toISOString(),
          startedAt: scanJob.startedAt?.toISOString() || null,
          completedAt: scanJob.completedAt?.toISOString() || null,
          counts: {
            ...scanJob._count,
            tasks: taskCount,
          },
          taskSummary: summarizeTasks(taskSummaryRows),
        };
      }
    );

    return ok(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
