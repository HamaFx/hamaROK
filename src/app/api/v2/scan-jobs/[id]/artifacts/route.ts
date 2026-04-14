import { NextRequest } from 'next/server';
import {
  ArtifactType,
  IngestionTaskStatus,
  Prisma,
  ScanJobStatus,
  WorkspaceRole,
} from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { withIdempotency } from '@/lib/idempotency';
import { normalizeArchetypeHint } from '@/lib/ingestion-task';
import { prisma } from '@/lib/prisma';
import { dispatchOcrWork } from '@/lib/aws/ocr-dispatch';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { invalidateServerCacheTags } from '@/lib/server-cache';
import { scanJobCacheTag, workspaceCacheTags } from '@/lib/cache-scopes';

const createArtifactTaskSchema = z.object({
  workspaceId: z.string().min(1),
  eventId: z.string().optional().nullable(),
  artifactUrl: z.string().url(),
  artifactType: z.nativeEnum(ArtifactType).optional(),
  archetypeHint: z.string().max(80).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
  checksum: z.string().max(128).optional(),
  bytes: z.number().int().min(0).max(60_000_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  fileName: z.string().max(220).optional(),
});

function normalizeMetadata(body: z.infer<typeof createArtifactTaskSchema>): Prisma.InputJsonValue {
  const metadata: Record<string, unknown> = {
    ...(body.metadata || {}),
  };
  if (body.fileName) metadata.fileName = body.fileName;
  if (body.archetypeHint) metadata.archetypeHint = normalizeArchetypeHint(body.archetypeHint);
  return metadata as Prisma.InputJsonValue;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: scanJobId } = await params;
    const body = createArtifactTaskSchema.parse(await readJson(request));

    const scanJob = await prisma.scanJob.findUnique({
      where: { id: scanJobId },
      select: {
        id: true,
        workspaceId: true,
        eventId: true,
        source: true,
        totalFiles: true,
        startedAt: true,
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

    const idempotent = await withIdempotency({
      workspaceId: body.workspaceId,
      scope: 'scan-job-artifact-task',
      key: body.idempotencyKey,
      request: {
        scanJobId,
        eventId: body.eventId || scanJob.eventId || null,
        artifactUrl: body.artifactUrl,
        artifactType: body.artifactType || ArtifactType.SCREENSHOT,
        archetypeHint: normalizeArchetypeHint(body.archetypeHint),
        checksum: body.checksum || null,
        bytes: body.bytes || null,
      },
      execute: async () => {
        const created = await prisma.$transaction(async (tx) => {
          const artifact = await tx.artifact.create({
            data: {
              workspaceId: body.workspaceId,
              scanJobId,
              type: body.artifactType || ArtifactType.SCREENSHOT,
              url: body.artifactUrl,
              checksum: body.checksum || null,
              bytes: body.bytes,
              metadata: normalizeMetadata(body),
            },
            select: {
              id: true,
              type: true,
              url: true,
              createdAt: true,
            },
          });

          const task = await tx.ingestionTask.create({
            data: {
              workspaceId: body.workspaceId,
              scanJobId,
              artifactId: artifact.id,
              eventId: body.eventId || scanJob.eventId || null,
              status: IngestionTaskStatus.QUEUED,
              archetypeHint: normalizeArchetypeHint(body.archetypeHint),
              idempotencyKey: body.idempotencyKey || null,
              metadata: normalizeMetadata(body),
            },
            select: {
              id: true,
              workspaceId: true,
              scanJobId: true,
              artifactId: true,
              eventId: true,
              status: true,
              archetypeHint: true,
              attemptCount: true,
              createdAt: true,
              updatedAt: true,
            },
          });

          const scanJobPatch: Prisma.ScanJobUpdateInput = {
            status: ScanJobStatus.PROCESSING,
            startedAt: scanJob.startedAt || new Date(),
          };

          if (scanJob.totalFiles <= 0) {
            scanJobPatch.totalFiles = { increment: 1 };
          }

          await tx.scanJob.update({
            where: { id: scanJobId },
            data: scanJobPatch,
          });

          return {
            artifact: {
              ...artifact,
              createdAt: artifact.createdAt.toISOString(),
            },
            task: {
              ...task,
              createdAt: task.createdAt.toISOString(),
              updatedAt: task.updatedAt.toISOString(),
            },
          };
        });

        return created;
      },
    });

    if (!idempotent.replayed) {
      await dispatchOcrWork({
        type: 'ingestion_task',
        workspaceId: body.workspaceId,
        eventId: body.eventId || scanJob.eventId,
        scanJobId,
        taskId: idempotent.value.task.id,
        source: scanJob.source,
        payload: {
          artifactId: idempotent.value.artifact.id,
          archetypeHint: idempotent.value.task.archetypeHint,
          artifactType: idempotent.value.artifact.type,
        },
      });
    }

    invalidateServerCacheTags([
      ...Object.values(workspaceCacheTags(body.workspaceId)),
      scanJobCacheTag(scanJobId),
    ]);

    return ok(
      {
        ...idempotent.value,
        duplicate: {
          level: 'none',
          overrideToken: null,
        },
      },
      idempotent.replayed ? { idempotentReplay: true } : null,
      idempotent.replayed ? 200 : 201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
