import { NextRequest } from 'next/server';
import { IngestionTaskStatus } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok } from '@/lib/api-response';
import {
  getTaskWithRelations,
  mergeJson,
  syncScanJobProgress,
  toIngestionTaskResponse,
} from '@/lib/ingestion-service';
import { nextFailureStatus, MAX_INGESTION_ATTEMPTS } from '@/lib/ingestion-task';
import { assertValidServiceRequest } from '@/lib/service-auth';
import { prisma } from '@/lib/prisma';

const failSchema = z.object({
  error: z.string().min(1).max(400),
  attempt: z.number().int().min(1).max(20).optional(),
  terminal: z.boolean().optional(),
  workerId: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const rawBody = await request.text();
    assertValidServiceRequest(request, rawBody);
    const body = failSchema.parse(rawBody ? JSON.parse(rawBody) : {});

    const task = await getTaskWithRelations(taskId);
    if (!task) {
      return fail('NOT_FOUND', 'Ingestion task not found.', 404);
    }

    if (task.status === IngestionTaskStatus.COMPLETED) {
      return ok({
        task: toIngestionTaskResponse(task),
        ignored: true,
        reason: 'task-already-completed',
      });
    }

    // `start` endpoint already sets the current attempt count.
    // Failure should not increment again, otherwise retries terminate early.
    const attemptCount = Math.max(task.attemptCount, body.attempt || 0);
    const nextStatus = body.terminal
      ? IngestionTaskStatus.FAILED
      : nextFailureStatus(attemptCount, MAX_INGESTION_ATTEMPTS);

    const result = await prisma.$transaction(async (tx) => {
      const updatedTask = await tx.ingestionTask.update({
        where: { id: task.id },
        data: {
          status: nextStatus,
          attemptCount,
          startedAt: task.startedAt || new Date(),
          completedAt: nextStatus === IngestionTaskStatus.FAILED ? new Date() : null,
          lastError: body.error,
          metadata: mergeJson(task.metadata, {
            ...(body.metadata || {}),
            workerId: body.workerId || undefined,
            lastFailureAt: new Date().toISOString(),
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

      const scanJob = await syncScanJobProgress(tx, task.scanJobId);

      return {
        task: updatedTask,
        scanJob,
      };
    });

    return ok({
      task: toIngestionTaskResponse(result.task),
      terminal: nextStatus === IngestionTaskStatus.FAILED,
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
