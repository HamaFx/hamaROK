import { Buffer } from 'node:buffer';
import { put } from '@vercel/blob';
import {
  DeliveryStatus,
  ExportJobStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { compareWorkspaceEvents } from '@/lib/compare-service';
import {
  toComparisonCsv,
  toComparisonPackZip,
  toComparisonXlsx,
} from '@/lib/exporters';
import { sendDiscordWebhookWithRetry } from '@/lib/discord';
import { recordJobMetric } from '@/lib/metrics';
import { buildWorkspaceAnalytics } from '@/lib/analytics';

async function uploadArtifact(
  fileName: string,
  bytes: Buffer,
  contentType: string
): Promise<{ url: string; bytes: number; metadata?: Record<string, unknown> }> {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return {
        url: `memory://exports/${fileName}`,
        bytes: bytes.byteLength,
        metadata: {
          inlineBase64: bytes.toString('base64'),
          contentType,
        },
      };
    }

    const blob = await put(`exports/${fileName}`, bytes, {
      access: 'public',
      contentType,
    });

    return {
      url: blob.url,
      bytes: bytes.byteLength,
    };
  } catch {
    return {
      url: `memory://exports/${fileName}`,
      bytes: bytes.byteLength,
      metadata: {
        inlineBase64: bytes.toString('base64'),
        contentType,
      },
    };
  }
}

function nextRetryDelayMs(attemptCount: number) {
  const minutes = Math.min(60, 5 * Math.pow(2, Math.max(0, attemptCount - 1)));
  return minutes * 60 * 1000;
}

export async function processSingleExportJob(jobId: string) {
  const job = await prisma.exportJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    return { status: 'missing' as const };
  }

  if (job.status === ExportJobStatus.COMPLETED) {
    return { status: 'completed' as const, exportJobId: job.id };
  }

  const request = (job.request || {}) as {
    eventA?: string;
    eventB?: string;
    format?: 'csv' | 'xlsx' | 'json' | 'pack';
  };

  const eventA = request.eventA || job.eventAId;
  const eventB = request.eventB || job.eventBId;
  const format = request.format || (job.format as 'csv' | 'xlsx' | 'json' | 'pack');

  if (!eventA || !eventB) {
    await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: ExportJobStatus.FAILED,
        error: 'Export job is missing eventA/eventB identifiers.',
        completedAt: new Date(),
      },
    });
    return { status: 'failed' as const, exportJobId: job.id };
  }

  await prisma.exportJob.update({
    where: { id: job.id },
    data: {
      status: ExportJobStatus.PROCESSING,
      startedAt: job.startedAt ?? new Date(),
      error: null,
    },
  });

  try {
    const result = await compareWorkspaceEvents({
      workspaceId: job.workspaceId,
      eventAId: eventA,
      eventBId: eventB,
    });

    let bytes: Buffer;
    let contentType = 'application/json';
    let extension = 'json';

    if (format === 'csv') {
      bytes = Buffer.from(toComparisonCsv(result), 'utf8');
      contentType = 'text/csv; charset=utf-8';
      extension = 'csv';
    } else if (format === 'xlsx') {
      bytes = await toComparisonXlsx(result);
      contentType =
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      extension = 'xlsx';
    } else if (format === 'pack') {
      const analytics = await buildWorkspaceAnalytics({
        workspaceId: job.workspaceId,
        eventAId: eventA,
        eventBId: eventB,
        topN: 15,
      });
      bytes = await toComparisonPackZip({
        ...result,
        trendLines: analytics.trendLines,
      });
      contentType = 'application/zip';
      extension = 'zip';
    } else {
      bytes = Buffer.from(JSON.stringify(result, null, 2), 'utf8');
    }

    const artifactData = await uploadArtifact(
      `workspace-${job.workspaceId}-${job.id}.${extension}`,
      bytes,
      contentType
    );

    const artifact = await prisma.artifact.create({
      data: {
        workspaceId: job.workspaceId,
        type:
          format === 'xlsx'
            ? 'REPORT_XLSX'
            : format === 'csv'
              ? 'REPORT_CSV'
              : 'REPORT_JSON',
        url: artifactData.url,
        bytes: artifactData.bytes,
        metadata: (artifactData.metadata ?? {
          contentType,
          format,
          extension,
        }) as Prisma.InputJsonValue,
      },
    });

    await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: ExportJobStatus.COMPLETED,
        resultArtifactId: artifact.id,
        completedAt: new Date(),
      },
    });

    recordJobMetric('export', 'ok', {
      exportJobId: job.id,
      workspaceId: job.workspaceId,
      format,
      bytes: artifact.bytes,
    });

    return {
      status: 'completed' as const,
      exportJobId: job.id,
      artifactId: artifact.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export generation failed.';

    await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: ExportJobStatus.FAILED,
        error: message,
        completedAt: new Date(),
      },
    });

    recordJobMetric('export', 'error', {
      exportJobId: job.id,
      workspaceId: job.workspaceId,
      error: message,
    });

    return {
      status: 'failed' as const,
      exportJobId: job.id,
      error: message,
    };
  }
}

export async function processQueuedExports(args?: {
  workspaceId?: string;
  limit?: number;
}) {
  const limit = args?.limit ?? 10;
  const jobs = await prisma.exportJob.findMany({
    where: {
      ...(args?.workspaceId ? { workspaceId: args.workspaceId } : {}),
      status: { in: [ExportJobStatus.QUEUED, ExportJobStatus.PROCESSING] },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    const result = await processSingleExportJob(job.id);
    if (result.status === 'completed') {
      completed += 1;
    }
    if (result.status === 'failed') {
      failed += 1;
    }
  }

  return {
    scanned: jobs.length,
    completed,
    failed,
  };
}

export async function processDiscordDeliveries(args?: {
  workspaceId?: string;
  limit?: number;
}) {
  const limit = args?.limit ?? 20;
  const now = new Date();
  const candidates = await prisma.deliveryLog.findMany({
    where: {
      ...(args?.workspaceId ? { workspaceId: args.workspaceId } : {}),
      integration: 'discord',
      status: {
        in: [DeliveryStatus.PENDING, DeliveryStatus.FAILED, DeliveryStatus.RETRYING],
      },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let retried = 0;
  let sent = 0;
  let stillFailing = 0;

  for (const log of candidates) {
    const payload = (log.payload as { webhookBody?: unknown } | null)?.webhookBody;
    if (!payload) {
      await prisma.deliveryLog.update({
        where: { id: log.id },
        data: {
          status: DeliveryStatus.FAILED,
          lastError: 'Missing webhook body payload for retry.',
          attemptCount: { increment: 1 },
          nextAttemptAt: new Date(Date.now() + nextRetryDelayMs(log.attemptCount + 1)),
        },
      });
      stillFailing += 1;
      continue;
    }

    const settings = await prisma.workspaceSettings.findUnique({
      where: { workspaceId: log.workspaceId },
      select: { discordWebhook: true },
    });

    if (!settings?.discordWebhook) {
      await prisma.deliveryLog.update({
        where: { id: log.id },
        data: {
          status: DeliveryStatus.FAILED,
          lastError: 'Workspace has no discord webhook configured.',
          attemptCount: { increment: 1 },
          nextAttemptAt: new Date(Date.now() + nextRetryDelayMs(log.attemptCount + 1)),
        },
      });
      stillFailing += 1;
      continue;
    }

    retried += 1;

    const delivery = await sendDiscordWebhookWithRetry(settings.discordWebhook, payload, {
      maxAttempts: 4,
      baseDelayMs: 800,
    });

    if (delivery.success) {
      await prisma.deliveryLog.update({
        where: { id: log.id },
        data: {
          status: DeliveryStatus.SENT,
          attemptCount: { increment: delivery.attempts },
          nextAttemptAt: null,
          lastError: null,
        },
      });
      sent += 1;
      continue;
    }

    await prisma.deliveryLog.update({
      where: { id: log.id },
      data: {
        status: DeliveryStatus.RETRYING,
        attemptCount: { increment: delivery.attempts },
        nextAttemptAt: new Date(Date.now() + nextRetryDelayMs(log.attemptCount + delivery.attempts)),
        lastError: delivery.error || 'Discord retry failed.',
      },
    });
    stillFailing += 1;
  }

  recordJobMetric('discord-delivery', stillFailing === 0 ? 'ok' : 'error', {
    retried,
    sent,
    stillFailing,
    workspaceId: args?.workspaceId || null,
  });

  return {
    retried,
    sent,
    stillFailing,
  };
}
