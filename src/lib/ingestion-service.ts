import {
  IngestionTask,
  IngestionTaskStatus,
  Prisma,
  PrismaClient,
  ScanJobStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

function toTaskSummary(rows: Array<{ status: IngestionTaskStatus; _count: { _all: number } }>) {
  const summary: Record<string, number> = {};
  for (const row of rows) {
    summary[row.status] = row._count._all;
  }
  return summary;
}

export async function syncScanJobProgress(db: PrismaLike, scanJobId: string) {
  const [grouped, total, lowConfidence] = await Promise.all([
    db.ingestionTask.groupBy({
      by: ['status'],
      where: { scanJobId },
      _count: { _all: true },
    }),
    db.ingestionTask.count({ where: { scanJobId } }),
    db.ocrExtraction.count({
      where: {
        scanJobId,
        lowConfidence: true,
      },
    }),
  ]);

  const summary = toTaskSummary(grouped);
  const completed = summary.COMPLETED || 0;
  const failed = summary.FAILED || 0;
  const terminal = completed + failed;

  let status: ScanJobStatus;
  if (total === 0) {
    status = ScanJobStatus.QUEUED;
  } else if (terminal < total) {
    status = ScanJobStatus.PROCESSING;
  } else if (failed === total) {
    status = ScanJobStatus.FAILED;
  } else {
    status = ScanJobStatus.REVIEW;
  }

  const now = new Date();
  const updated = await db.scanJob.update({
    where: { id: scanJobId },
    data: {
      status,
      processedFiles: terminal,
      lowConfidenceFiles: lowConfidence,
      startedAt: status === ScanJobStatus.PROCESSING ? now : undefined,
      completedAt: terminal >= total && total > 0 ? now : null,
      error: status === ScanJobStatus.FAILED ? 'All ingestion tasks failed.' : null,
    },
    select: {
      id: true,
      status: true,
      totalFiles: true,
      processedFiles: true,
      lowConfidenceFiles: true,
      startedAt: true,
      completedAt: true,
    },
  });

  return {
    ...updated,
    summary,
    total,
  };
}

export function toIngestionTaskResponse(task: IngestionTask & { artifact?: { id: string; url: string; type: string; metadata: unknown } | null }) {
  return {
    id: task.id,
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
    idempotencyKey: task.idempotencyKey,
    metadata: task.metadata,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    artifact: task.artifact || null,
  };
}

export async function getTaskWithRelations(taskId: string) {
  return prisma.ingestionTask.findUnique({
    where: { id: taskId },
    include: {
      scanJob: {
        select: {
          id: true,
          workspaceId: true,
          eventId: true,
          source: true,
          status: true,
        },
      },
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
}

export function mergeJson(
  current: Prisma.JsonValue | null,
  next: Record<string, unknown>
): Prisma.InputJsonValue {
  const base = current && typeof current === 'object' && !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : {};
  return {
    ...base,
    ...next,
  } as Prisma.InputJsonValue;
}
