import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, handleApiError, ok } from '@/lib/api-response';
import { assertValidServiceRequest } from '@/lib/service-auth';
import { getTaskWithRelations } from '@/lib/ingestion-service';
import { prisma } from '@/lib/prisma';
import { runMistralIngestionExtraction } from '@/lib/ocr/mistral-extraction';
import { getOcrEngine } from '@/lib/env';

const extractSchema = z.object({
  attempt: z.number().int().min(1).max(20).optional(),
  workerId: z.string().max(120).optional(),
  archetypeHint: z.string().max(120).optional(),
});

function normalizeMimeType(value: string | null): string {
  const normalized = String(value || '').toLowerCase().trim();
  if (normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/webp') {
    return normalized;
  }
  return 'image/png';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const rawBody = await request.text();
    assertValidServiceRequest(request, rawBody);
    const body = extractSchema.parse(rawBody ? JSON.parse(rawBody) : {});

    const task = await getTaskWithRelations(taskId);
    if (!task) {
      return fail('NOT_FOUND', 'Ingestion task not found.', 404);
    }

    if (!task.artifact?.url) {
      return fail('VALIDATION_ERROR', 'Task artifact URL is missing.', 400);
    }

    if (getOcrEngine() === 'legacy') {
      return fail(
        'PRECONDITION_FAILED',
        'Internal Mistral extraction endpoint is disabled when OCR_ENGINE=legacy.',
        412
      );
    }

    const settings = await prisma.workspaceSettings.findUnique({
      where: { workspaceId: task.workspaceId },
      select: {
        ocrModel: true,
        assistantModel: true,
        assistantConfig: true,
      },
    });

    const imageRes = await fetch(task.artifact.url, {
      cache: 'no-store',
    });
    if (!imageRes.ok) {
      return fail(
        'INTERNAL_ERROR',
        `Failed to download artifact image: ${imageRes.status}.`,
        500
      );
    }

    const mimeType = normalizeMimeType(imageRes.headers.get('content-type'));
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

    const extraction = await runMistralIngestionExtraction({
      image: {
        base64: imageBuffer.toString('base64'),
        mimeType,
      },
      archetypeHint: body.archetypeHint || task.archetypeHint || undefined,
      ocrModel: settings?.ocrModel || undefined,
      extractionModel: settings?.assistantModel || undefined,
      assistantConfig: settings?.assistantConfig || undefined,
    });

    return ok({
      ingestionDomain: extraction.ingestionDomain,
      screenArchetype: extraction.screenArchetype,
      profile: extraction.ingestionDomain === 'PROFILE_SNAPSHOT' ? extraction.profile : undefined,
      ranking: extraction.ingestionDomain === 'RANKING_CAPTURE' ? extraction.ranking : undefined,
      metadata: {
        ...extraction.metadata,
        workerId: body.workerId || null,
        attempt: body.attempt || null,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
