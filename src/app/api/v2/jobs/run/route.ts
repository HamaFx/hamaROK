import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { ok, fail, handleApiError } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import {
  processDiscordDeliveries,
  processQueuedExports,
} from '@/lib/background-jobs';
import { cleanupExpiredIdempotencyKeys } from '@/lib/idempotency';

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspaceId');

    if (!workspaceId) {
      return fail('VALIDATION_ERROR', 'workspaceId is required.', 400);
    }

    const auth = await authorizeWorkspaceAccess(
      request,
      workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const [exportsResult, deliveryResult, cleanedIdempotency] = await Promise.all([
      processQueuedExports({ workspaceId, limit: 15 }),
      processDiscordDeliveries({ workspaceId, limit: 30 }),
      cleanupExpiredIdempotencyKeys(),
    ]);

    return ok({
      exports: exportsResult,
      deliveries: deliveryResult,
      idempotency: {
        cleaned: cleanedIdempotency,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
