import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { ok, fail, handleApiError } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import {
  processDiscordDeliveries,
  processQueuedExports,
} from '@/lib/background-jobs';
import { cleanupExpiredIdempotencyKeys } from '@/lib/idempotency';
import { archiveStaleRankingRuns } from '@/lib/rankings/service';
import { cleanupAssistantLogs } from '@/lib/assistant/service';
import { processEmbeddingTasks } from '@/lib/embeddings/service';

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

    const [
      exportsResult,
      deliveryResult,
      cleanedIdempotency,
      archivedRankings,
      cleanedAssistant,
      embeddingResult,
    ] = await Promise.all([
      processQueuedExports({ workspaceId, limit: 15 }),
      processDiscordDeliveries({ workspaceId, limit: 30 }),
      cleanupExpiredIdempotencyKeys(),
      archiveStaleRankingRuns({ workspaceId, olderThanDays: 45, limit: 300 }),
      cleanupAssistantLogs({ workspaceId, fallbackRetentionDays: 180 }),
      processEmbeddingTasks({ workspaceId, limit: 36 }),
    ]);

    return ok({
      exports: exportsResult,
      deliveries: deliveryResult,
      idempotency: {
        cleaned: cleanedIdempotency,
      },
      rankings: archivedRankings,
      assistant: cleanedAssistant,
      embeddings: embeddingResult,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
