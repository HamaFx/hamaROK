import { NextRequest } from 'next/server';
import { IngestionTaskStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok } from '@/lib/api-response';
import {
  getTaskWithRelations,
  syncScanJobProgressWithOptions,
  toIngestionTaskResponse,
} from '@/lib/ingestion-service';
import { assertValidServiceRequest } from '@/lib/service-auth';
import { prisma } from '@/lib/prisma';
import { invalidateServerCacheTags } from '@/lib/server-cache';
import { scanJobCacheTag, workspaceCacheTags } from '@/lib/cache-scopes';
import { getEnv } from '@/lib/env';
import { resolveOcrEnginePolicy } from '@/lib/ocr/engine-policy';

const startSchema = z.object({
  attempt: z.number().int().min(1).max(20).optional(),
  workerId: z.string().max(120).optional(),
  queueMessageId: z.string().max(200).optional(),
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
    const body = startSchema.parse(rawBody ? JSON.parse(rawBody) : {});

    const task = await getTaskWithRelations(taskId);
    if (!task) {
      return fail('NOT_FOUND', 'Ingestion task not found.', 404);
    }

    const workspaceSettings = await prisma.workspaceSettings.findUnique({
      where: { workspaceId: task.workspaceId },
      select: { ocrEngine: true },
    });
    const env = getEnv();
    const ocrPolicy = resolveOcrEnginePolicy({
      envRequested: env.OCR_ENGINE,
      allowLegacy: env.ALLOW_LEGACY_OCR,
      workspaceRequested: workspaceSettings?.ocrEngine || null,
    });

    if (task.status === IngestionTaskStatus.COMPLETED) {
      return ok({
        task: toIngestionTaskResponse(task),
        ocrEngineRequested: ocrPolicy.requested,
        ocrEngineEffective: ocrPolicy.effective,
        ocrEngineLocked: ocrPolicy.locked,
        ocrEnginePolicyReason: ocrPolicy.reason,
        idempotentReplay: true,
      });
    }

    const attemptCount = Math.max(task.attemptCount, body.attempt || 0);
    const baseMetadata =
      task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? (task.metadata as Record<string, unknown>)
        : {};

    const updatedTask = await prisma.$transaction(async (tx) => {
      const updated = await tx.ingestionTask.update({
        where: { id: taskId },
        data: {
          status: IngestionTaskStatus.PROCESSING,
          attemptCount,
          startedAt: task.startedAt || new Date(),
          lastError: null,
          metadata: {
            ...baseMetadata,
            ...(body.metadata || {}),
            ...(body.workerId ? { workerId: body.workerId } : {}),
            ...(body.queueMessageId ? { queueMessageId: body.queueMessageId } : {}),
            ocrEngineRequested: ocrPolicy.requested,
            ocrEngineEffective: ocrPolicy.effective,
            ocrEngineLocked: ocrPolicy.locked,
            ocrEnginePolicyReason: ocrPolicy.reason,
          } as Prisma.InputJsonValue,
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
        task: updated,
        scanJob,
      };
    });

    invalidateServerCacheTags([
      ...Object.values(workspaceCacheTags(task.workspaceId)),
      scanJobCacheTag(task.scanJobId),
    ]);

    return ok({
      task: toIngestionTaskResponse(updatedTask.task),
      ocrEngineRequested: ocrPolicy.requested,
      ocrEngineEffective: ocrPolicy.effective,
      ocrEngineLocked: ocrPolicy.locked,
      ocrEnginePolicyReason: ocrPolicy.reason,
      scanJob: {
        id: updatedTask.scanJob.id,
        status: updatedTask.scanJob.status,
        processedFiles: updatedTask.scanJob.processedFiles,
        totalFiles: updatedTask.scanJob.totalFiles,
        lowConfidenceFiles: updatedTask.scanJob.lowConfidenceFiles,
        summary: updatedTask.scanJob.summary,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
