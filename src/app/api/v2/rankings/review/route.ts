import { NextRequest } from 'next/server';
import { RankingIdentityStatus, WorkspaceRole } from '@prisma/client';
import { ApiHttpError, fail, handleApiError, ok, requireParam } from '@/lib/api-response';
import { parseCommaValues, parsePagination } from '@/lib/v2';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { listRankingReviewRows } from '@/lib/rankings/service';
import { makeServerCacheKey, withServerCache } from '@/lib/server-cache';
import { workspaceCacheTags } from '@/lib/cache-scopes';

function parseStatuses(value: string | null): RankingIdentityStatus[] {
  const parts = parseCommaValues(value);
  if (parts.length === 0) {
    return [RankingIdentityStatus.UNRESOLVED];
  }

  const parsed = parts
    .map((item) => item.toUpperCase())
    .filter((item): item is RankingIdentityStatus =>
      Object.values(RankingIdentityStatus).includes(item as RankingIdentityStatus)
    );

  if (parsed.length === 0) {
    throw new ApiHttpError('VALIDATION_ERROR', 'Invalid ranking identity status filter.', 400);
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const eventId = url.searchParams.get('eventId')?.trim() || null;
    const rankingType = url.searchParams.get('rankingType')?.trim() || null;
    const statuses = parseStatuses(url.searchParams.get('status'));
    const { limit, offset } = parsePagination(request, { limit: 50, offset: 0 });

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const tags = workspaceCacheTags(workspaceId);
    const rows = await withServerCache(
      makeServerCacheKey('api:v2:rankings:review', {
        workspaceId,
        eventId,
        rankingType,
        statuses: [...statuses].sort(),
        limit,
        offset,
      }),
      {
        ttlMs: 8_000,
        tags: [tags.all, tags.rankings, tags.rankingReview],
      },
      () =>
        listRankingReviewRows({
          workspaceId,
          eventId,
          rankingType,
          status: statuses,
          limit,
          offset,
        })
    );

    return ok(rows.rows, {
      total: rows.total,
      limit,
      offset,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
