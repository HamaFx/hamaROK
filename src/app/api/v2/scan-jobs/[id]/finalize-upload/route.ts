import { NextRequest } from 'next/server';
import { IngestionTaskStatus, ScanJobStatus, WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { invalidateServerCacheTags } from '@/lib/server-cache';
import { scanJobCacheTag, workspaceCacheTags } from '@/lib/cache-scopes';

const finalizeManifestEntrySchema = z.object({
  rowId: z.string().min(1),
  fileName: z.string().max(220).optional(),
  status: z.string().max(40).optional(),
  taskId: z.string().optional(),
  artifactId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  error: z.string().max(500).optional(),
});

const finalizeSchema = z.object({
  workspaceId: z.string().min(1),
  expectedTotal: z.number().int().min(0).max(5000),
  manifest: z.array(finalizeManifestEntrySchema).max(5000).default([]),
});

function summarizeTaskRows(rows: Array<{ status: IngestionTaskStatus; _count: { _all: number } }>) {
  const summary: Record<string, number> = {};
  for (const row of rows) {
    summary[row.status] = row._count._all;
  }
  return summary;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: scanJobId } = await params;
    const body = finalizeSchema.parse(await readJson(request));

    const scanJob = await prisma.scanJob.findUnique({
      where: { id: scanJobId },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        totalFiles: true,
        processedFiles: true,
      },
    });

    if (!scanJob) {
      return fail('NOT_FOUND', 'Scan job not found.', 404);
    }

    if (scanJob.workspaceId !== body.workspaceId) {
      return fail('FORBIDDEN', 'scan job does not belong to workspaceId.', 403);
    }

    const auth = await authorizeWorkspaceAccess(request, body.workspaceId, WorkspaceRole.EDITOR);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const [taskCount, taskSummaryRows] = await Promise.all([
      prisma.ingestionTask.count({ where: { scanJobId } }),
      prisma.ingestionTask.groupBy({
        by: ['status'],
        where: { scanJobId },
        _count: { _all: true },
      }),
    ]);

    const expectedTotal = Math.max(scanJob.totalFiles, body.expectedTotal);
    const manifestMissing = body.manifest.filter(
      (entry) =>
        !entry.taskId &&
        (String(entry.status || '').toLowerCase() === 'failed' || Boolean(entry.error))
    );
    const shortfall = Math.max(0, expectedTotal - taskCount);
    const missingCount = shortfall > 0 ? Math.max(shortfall, manifestMissing.length) : 0;
    const missing =
      missingCount > 0
        ? manifestMissing.slice(0, 200).map((entry) => ({
            rowId: entry.rowId,
            fileName: entry.fileName || null,
            status: entry.status || 'failed',
            reason: entry.error || 'not-enqueued',
          }))
        : [];

    let updatedStatus = scanJob.status;
    let updatedError: string | null = null;

    if (missingCount > 0) {
      updatedStatus = ScanJobStatus.FAILED;
      updatedError = `Upload finalize mismatch: expected ${expectedTotal} files but enqueued ${taskCount} ingestion tasks.`;
      await prisma.scanJob.update({
        where: { id: scanJobId },
        data: {
          status: ScanJobStatus.FAILED,
          error: updatedError,
          totalFiles: expectedTotal,
        },
      });
    } else if (scanJob.totalFiles !== expectedTotal) {
      await prisma.scanJob.update({
        where: { id: scanJobId },
        data: {
          totalFiles: expectedTotal,
        },
      });
    }

    invalidateServerCacheTags([
      ...Object.values(workspaceCacheTags(body.workspaceId)),
      scanJobCacheTag(scanJobId),
    ]);

    return ok({
      scanJobId,
      expectedTotal,
      enqueuedCount: taskCount,
      missingCount,
      missing,
      finalized: missingCount === 0,
      status: updatedStatus,
      error: updatedError,
      taskSummary: summarizeTaskRows(taskSummaryRows),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
