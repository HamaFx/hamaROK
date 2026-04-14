import { NextRequest } from 'next/server';
import { EventType, RankingSnapshotStatus, WorkspaceRole } from '@prisma/client';
import { ApiHttpError, fail, handleApiError, ok, requireParam } from '@/lib/api-response';
import { parseCommaValues } from '@/lib/v2';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { listCanonicalRankings } from '@/lib/rankings/service';
import { makeServerCacheKey, withServerCache } from '@/lib/server-cache';
import { workspaceCacheTags } from '@/lib/cache-scopes';
import { prisma } from '@/lib/prisma';

function parseStatuses(
  value: string | null,
  includeUnresolved: boolean
): RankingSnapshotStatus[] {
  const parts = parseCommaValues(value);
  if (parts.length === 0) {
    return includeUnresolved
      ? [RankingSnapshotStatus.ACTIVE, RankingSnapshotStatus.UNRESOLVED]
      : [RankingSnapshotStatus.ACTIVE];
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
    const eventIdParam = url.searchParams.get('eventId')?.trim() || null;
    const weekKey = url.searchParams.get('weekKey')?.trim() || null;
    const includeUnresolved = url.searchParams.get('includeUnresolved') === 'true';
    const rankingType = url.searchParams.get('rankingType')?.trim() || null;
    const metricKey = url.searchParams.get('metricKey')?.trim() || null;
    const alliances = [...new Set(parseCommaValues(url.searchParams.get('alliance')))];
    const sortedAlliances = [...alliances].sort();
    const q = url.searchParams.get('q')?.trim() || null;
    const sort = url.searchParams.get('sort')?.trim() || null;
    const cursor = url.searchParams.get('cursor')?.trim() || null;
    const status = parseStatuses(url.searchParams.get('status'), includeUnresolved);
    const limit = parseLimit(url.searchParams.get('limit'));

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    let eventId = eventIdParam;
    if (!eventId && weekKey) {
      const weeklyEvent = await prisma.event.findFirst({
        where: {
          workspaceId,
          eventType: EventType.WEEKLY,
          weekKey,
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!weeklyEvent) {
        return fail('NOT_FOUND', `Weekly event not found for ${weekKey}.`, 404);
      }
      eventId = weeklyEvent.id;
    }

    const tags = workspaceCacheTags(workspaceId);
    const cached = await withServerCache(
      makeServerCacheKey('api:v2:rankings:list', {
        workspaceId,
        eventId,
        rankingType,
        metricKey,
        alliances: sortedAlliances,
        q,
        sort,
        status: [...status].sort(),
        includeUnresolved,
        weekKey,
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
          alliances,
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
            alliancesApplied: sortedAlliances,
            weekKeyApplied: weekKey,
            includeUnresolved,
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
      alliancesApplied: cached.meta.alliancesApplied,
      weekKeyApplied: cached.meta.weekKeyApplied,
      includeUnresolved: cached.meta.includeUnresolved,
      sortRequested: cached.meta.sortRequested,
      sortApplied: cached.meta.sortApplied,
      sort: cached.meta.sort,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
