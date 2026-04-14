import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { fail, handleApiError, ok } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { getRankingRunById } from '@/lib/rankings/service';
import { makeServerCacheKey, withServerCache } from '@/lib/server-cache';
import { rankingRunCacheTag, workspaceCacheTags } from '@/lib/cache-scopes';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const workspaceId = new URL(request.url).searchParams.get('workspaceId')?.trim();
    if (!workspaceId) {
      return fail('VALIDATION_ERROR', 'workspaceId is required.', 400);
    }

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const tags = workspaceCacheTags(workspaceId);
    const run = await withServerCache(
      makeServerCacheKey('api:v2:rankings:run', {
        workspaceId,
        runId: id,
      }),
      {
        ttlMs: 8_000,
        tags: [tags.all, tags.rankings, tags.rankingRuns, rankingRunCacheTag(id)],
      },
      () =>
        getRankingRunById({
          workspaceId,
          runId: id,
        })
    );

    return ok(run);
  } catch (error) {
    return handleApiError(error);
  }
}
