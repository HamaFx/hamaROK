import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import {
  getAwsOcrControlStatus,
  invokeAwsOcrControlAction,
} from '@/lib/aws/ocr-control';
import { getEnv, getUploadMode } from '@/lib/env';
import {
  invalidateServerCacheTags,
  makeServerCacheKey,
  withServerCache,
} from '@/lib/server-cache';
import { workspaceCacheTags } from '@/lib/cache-scopes';
import { prisma } from '@/lib/prisma';
import { resolveOcrEnginePolicy } from '@/lib/ocr/engine-policy';

const controlSchema = z.object({
  workspaceId: z.string().min(1),
  action: z.enum(['START', 'STOP']),
  force: z.boolean().optional(),
});

async function resolveWorkspaceOcrPolicy(workspaceId: string) {
  const env = getEnv();
  const settings = await prisma.workspaceSettings.findUnique({
    where: { workspaceId },
    select: { ocrEngine: true },
  });
  return resolveOcrEnginePolicy({
    envRequested: env.OCR_ENGINE,
    allowLegacy: env.ALLOW_LEGACY_OCR,
    workspaceRequested: settings?.ocrEngine || null,
  });
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspaceId')?.trim() || '';
    if (!workspaceId) {
      return fail('VALIDATION_ERROR', 'workspaceId is required.', 400);
    }

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.EDITOR);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const tags = workspaceCacheTags(workspaceId);
    const status = await withServerCache(
      makeServerCacheKey('api:v2:infra:aws-ocr', { workspaceId }),
      {
        ttlMs: 3_000,
        tags: [tags.all, tags.awsOcr],
      },
      getAwsOcrControlStatus
    );
    const ocrPolicy = await resolveWorkspaceOcrPolicy(workspaceId);
    return ok({
      ...status,
      uploadMode: getUploadMode(),
      ocrPolicy,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = controlSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(request, body.workspaceId, WorkspaceRole.EDITOR);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    try {
      const result = await invokeAwsOcrControlAction(body.action, {
        force: body.force,
        source: 'manual',
      });
      invalidateServerCacheTags([
        ...Object.values(workspaceCacheTags(body.workspaceId)),
      ]);
      const status = await getAwsOcrControlStatus();
      const ocrPolicy = await resolveWorkspaceOcrPolicy(body.workspaceId);
      return ok({
        action: body.action,
        force: Boolean(body.force),
        result,
        status: {
          ...status,
          uploadMode: getUploadMode(),
          ocrPolicy,
        },
      });
    } catch (error) {
      return fail(
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Failed to invoke AWS OCR control action.',
        502
      );
    }
  } catch (error) {
    return handleApiError(error);
  }
}
