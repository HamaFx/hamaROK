import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { ok, fail, handleApiError } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { cleanupExpiredIdempotencyKeys } from '@/lib/idempotency';
import { archiveStaleRankingRuns } from '@/lib/rankings/service';
import { cleanupAssistantLogs } from '@/lib/assistant/service';
import { processEmbeddingTasks } from '@/lib/embeddings/service';
import { cleanupBlobRetention } from '@/lib/blob-retention';

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

    const [cleanedIdempotency, archivedRankings, cleanedAssistant, embeddingResult, blobCleanup] =
      await Promise.all([
        cleanupExpiredIdempotencyKeys(),
        archiveStaleRankingRuns({ workspaceId, olderThanDays: 45, limit: 300 }),
        cleanupAssistantLogs({ workspaceId, fallbackRetentionDays: 180 }),
        processEmbeddingTasks({ workspaceId, limit: 36 }),
        cleanupBlobRetention({ retentionDays: 14, maxScanned: 3000 }),
      ]);

    return ok({
      idempotency: {
        cleaned: cleanedIdempotency,
      },
      rankings: archivedRankings,
      assistant: cleanedAssistant,
      embeddings: embeddingResult,
      blobCleanup,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
