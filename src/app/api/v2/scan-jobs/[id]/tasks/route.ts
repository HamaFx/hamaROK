import { NextRequest } from 'next/server';
import { IngestionTaskStatus, WorkspaceRole } from '@prisma/client';
import { fail, handleApiError, ok } from '@/lib/api-response';
import { parsePagination } from '@/lib/v2';
import { prisma } from '@/lib/prisma';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { makeServerCacheKey, withServerCache } from '@/lib/server-cache';
import { scanJobCacheTag, workspaceCacheTags } from '@/lib/cache-scopes';

function parseStatuses(value: string | null): IngestionTaskStatus[] {
  if (!value) return [];
  const statuses = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const status of statuses) {
    if (!Object.values(IngestionTaskStatus).includes(status as IngestionTaskStatus)) {
      throw new Error(`Invalid ingestion task status: ${status}`);
    }
  }

  return statuses as IngestionTaskStatus[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: scanJobId } = await params;
    const url = new URL(request.url);
    const statusFilter = parseStatuses(url.searchParams.get('status'));

    const scanJob = await prisma.scanJob.findUnique({
      where: { id: scanJobId },
      select: {
        id: true,
        workspaceId: true,
      },
    });

    if (!scanJob) {
      return fail('NOT_FOUND', 'Scan job not found.', 404);
    }

    const auth = await authorizeWorkspaceAccess(request, scanJob.workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const { limit, offset } = parsePagination(request, { limit: 100, offset: 0 });

    const where = {
      scanJobId,
      ...(statusFilter.length > 0 ? { status: { in: statusFilter } } : {}),
    };

    const tags = workspaceCacheTags(scanJob.workspaceId);
    const cached = await withServerCache(
      makeServerCacheKey('api:v2:scan-job:tasks', {
        scanJobId,
        statusFilter: [...statusFilter].sort(),
        limit,
        offset,
      }),
      {
        ttlMs: 2_000,
        tags: [tags.all, tags.scanJobs, scanJobCacheTag(scanJobId)],
      },
      async () => {
        const [rows, total, summaryRows] = await Promise.all([
          prisma.ingestionTask.findMany({
            where,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: limit,
            skip: offset,
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
          }),
          prisma.ingestionTask.count({ where }),
          prisma.ingestionTask.groupBy({
            by: ['status'],
            where: { scanJobId },
            _count: { _all: true },
          }),
        ]);

        const summary: Record<string, number> = {};
        for (const row of summaryRows) {
          summary[row.status] = row._count._all;
        }

        return {
          rows: rows.map((task) => ({
            duplicate:
              task.metadata &&
              typeof task.metadata === 'object' &&
              !Array.isArray(task.metadata) &&
              ((task.metadata as Record<string, unknown>).duplicateLevel ||
                (task.metadata as Record<string, unknown>).duplicateWarning)
                ? {
                    warning: Boolean((task.metadata as Record<string, unknown>).duplicateWarning),
                    level:
                      ((task.metadata as Record<string, unknown>).duplicateLevel as string | null) ||
                      null,
                    referenceRunId:
                      ((task.metadata as Record<string, unknown>).duplicateReferenceRunId as
                        | string
                        | null) || null,
                    similarity:
                      ((task.metadata as Record<string, unknown>).duplicateSimilarity as
                        | number
                        | null) || null,
                    overrideToken:
                      ((task.metadata as Record<string, unknown>).duplicateOverrideToken as
                        | string
                        | null) || null,
                  }
                : null,
            id: task.id,
            idempotencyKey: task.idempotencyKey,
            workspaceId: task.workspaceId,
            scanJobId: task.scanJobId,
            artifactId: task.artifactId,
            eventId: task.eventId,
            status: task.status,
            archetypeHint: task.archetypeHint,
            attemptCount: task.attemptCount,
            lastError: task.lastError,
            startedAt: task.startedAt?.toISOString() || null,
            completedAt: task.completedAt?.toISOString() || null,
            createdAt: task.createdAt.toISOString(),
            updatedAt: task.updatedAt.toISOString(),
            metadata: task.metadata,
            artifact: task.artifact,
          })),
          meta: {
            total,
            limit,
            offset,
            summary,
          },
        };
      }
    );

    return ok(cached.rows, cached.meta);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid ingestion task status')) {
      return fail('VALIDATION_ERROR', error.message, 400);
    }
    return handleApiError(error);
  }
}
