import { NextRequest } from 'next/server';
import { RankingSnapshotStatus, WorkspaceRole } from '@prisma/client';
import { ApiHttpError, fail, handleApiError, ok, requireParam } from '@/lib/api-response';
import { parseCommaValues } from '@/lib/v2';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { listCanonicalRankings } from '@/lib/rankings/service';
import { makeServerCacheKey, withServerCache } from '@/lib/server-cache';
import { workspaceCacheTags } from '@/lib/cache-scopes';

function parseStatuses(value: string | null): RankingSnapshotStatus[] {
  const parts = parseCommaValues(value);
  if (parts.length === 0) {
    return [
      RankingSnapshotStatus.ACTIVE,
      RankingSnapshotStatus.UNRESOLVED,
      RankingSnapshotStatus.REJECTED,
    ];
  }

  const parsed = parts
    .map((item) => item.toUpperCase())
    .filter((item): item is RankingSnapshotStatus =>
      Object.values(RankingSnapshotStatus).includes(item as RankingSnapshotStatus)
    );

  if (parsed.length === 0) {
    throw new ApiHttpError('VALIDATION_ERROR', 'Invalid ranking snapshot status filter.', 400);
  }

  return parsed;
}

function parseLimit(value: string | null): number {
  if (!value) return 50;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new ApiHttpError('VALIDATION_ERROR', 'Invalid limit.', 400);
  }
  return Math.max(1, Math.min(200, Math.floor(n)));
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const eventId = url.searchParams.get('eventId')?.trim() || null;
    const rankingType = url.searchParams.get('rankingType')?.trim() || null;
    const metricKey = url.searchParams.get('metricKey')?.trim() || null;
    const q = url.searchParams.get('q')?.trim() || null;
    const sort = url.searchParams.get('sort')?.trim() || null;
    const cursor = url.searchParams.get('cursor')?.trim() || null;
    const status = parseStatuses(url.searchParams.get('status'));
    const limit = parseLimit(url.searchParams.get('limit'));

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const tags = workspaceCacheTags(workspaceId);
    const cached = await withServerCache(
      makeServerCacheKey('api:v2:rankings:list', {
        workspaceId,
        eventId,
        rankingType,
        metricKey,
        q,
        sort,
        status: [...status].sort(),
        limit,
        cursor,
      }),
      {
        ttlMs: 8_000,
        tags: [tags.all, tags.rankings],
      },
      async () => {
        const result = await listCanonicalRankings({
          workspaceId,
          eventId,
          rankingType,
          metricKey,
          q,
          sort,
          status,
          limit,
          cursor,
        });

        return {
          rows: result.rows,
          meta: {
            total: result.total,
            limit,
            nextCursor: result.nextCursor,
            sortRequested: sort || null,
            sortApplied:
              'metricValue DESC, sourceRank ASC NULLS LAST, governorNameNormalized ASC, rowId ASC',
            sort: [
              'metricValue DESC',
              'sourceRank ASC NULLS LAST',
              'governorNameNormalized ASC',
              'rowId ASC',
            ],
          },
        };
      }
    );

    return ok(cached.rows, {
      total: cached.meta.total,
      limit: cached.meta.limit,
      nextCursor: cached.meta.nextCursor,
      sortRequested: cached.meta.sortRequested,
      sortApplied: cached.meta.sortApplied,
      sort: cached.meta.sort,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
