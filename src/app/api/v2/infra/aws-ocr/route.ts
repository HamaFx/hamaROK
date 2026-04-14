import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import {
  getAwsOcrControlStatus,
  invokeAwsOcrControlAction,
} from '@/lib/aws/ocr-control';
import { getUploadMode } from '@/lib/env';

const controlSchema = z.object({
  workspaceId: z.string().min(1),
  action: z.enum(['START', 'STOP']),
  force: z.boolean().optional(),
});

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

    const status = await getAwsOcrControlStatus();
    return ok({
      ...status,
      uploadMode: getUploadMode(),
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
      const status = await getAwsOcrControlStatus();
      return ok({
        action: body.action,
        force: Boolean(body.force),
        result,
        status: {
          ...status,
          uploadMode: getUploadMode(),
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
