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

function parseViewMode(value: string | null): 'flat' | 'grouped' {
  if (!value) return 'flat';
  const normalized = value.trim().toLowerCase();
  return normalized === 'grouped' ? 'grouped' : 'flat';
}

function buildGroupedView<
  T extends {
    id: string;
    runId: string;
    sourceRank: number | null;
    identityStatus: RankingIdentityStatus;
    run: {
      id: string;
      rankingType: string;
      metricKey: string;
      createdAt: string;
      status: string;
      headerText: string | null;
      diagnostics?: unknown;
      artifact?: { id: string; url: string; type: string } | null;
    };
  },
>(rows: T[]) {
  const groups = new Map<
    string,
    {
      runId: string;
      rankingType: string;
      metricKey: string;
      createdAt: string;
      status: string;
      headerText: string | null;
      diagnostics: unknown;
      artifact: { id: string; url: string; type: string } | null;
      rows: T[];
      statusCounts: Record<RankingIdentityStatus, number>;
      unresolvedCount: number;
    }
  >();

  for (const row of rows) {
    const existing = groups.get(row.runId);
    if (!existing) {
      groups.set(row.runId, {
        runId: row.runId,
        rankingType: row.run.rankingType,
        metricKey: row.run.metricKey,
        createdAt: row.run.createdAt,
        status: row.run.status,
        headerText: row.run.headerText,
        diagnostics: row.run.diagnostics || null,
        artifact: row.run.artifact || null,
        rows: [row],
        statusCounts: {
          UNRESOLVED: row.identityStatus === RankingIdentityStatus.UNRESOLVED ? 1 : 0,
          AUTO_LINKED: row.identityStatus === RankingIdentityStatus.AUTO_LINKED ? 1 : 0,
          MANUAL_LINKED: row.identityStatus === RankingIdentityStatus.MANUAL_LINKED ? 1 : 0,
          REJECTED: row.identityStatus === RankingIdentityStatus.REJECTED ? 1 : 0,
        },
        unresolvedCount: row.identityStatus === RankingIdentityStatus.UNRESOLVED ? 1 : 0,
      });
      continue;
    }

    existing.rows.push(row);
    existing.statusCounts[row.identityStatus] += 1;
    if (row.identityStatus === RankingIdentityStatus.UNRESOLVED) {
      existing.unresolvedCount += 1;
    }
  }

  return [...groups.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((group) => ({
      ...group,
      totalRows: group.rows.length,
      rows: group.rows.sort((a, b) => {
        const rankA = a.sourceRank ?? Number.MAX_SAFE_INTEGER;
        const rankB = b.sourceRank ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        return a.id.localeCompare(b.id);
      }),
    }));
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const eventId = url.searchParams.get('eventId')?.trim() || null;
    const rankingType = url.searchParams.get('rankingType')?.trim() || null;
    const metricKey = url.searchParams.get('metricKey')?.trim() || null;
    const statuses = parseStatuses(url.searchParams.get('status'));
    const viewMode = parseViewMode(url.searchParams.get('view'));
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
        metricKey,
        statuses: [...statuses].sort(),
        viewMode,
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
          metricKey,
          status: statuses,
          limit,
          offset,
        })
    );
    if (viewMode === 'grouped') {
      const groups = buildGroupedView(rows.rows as Array<(typeof rows.rows)[number]>);
      return ok(
        {
          rows: rows.rows,
          groups,
        },
        {
          total: rows.total,
          totalGroups: groups.length,
          limit,
          offset,
          view: 'grouped',
        }
      );
    }

    return ok(rows.rows, {
      total: rows.total,
      limit,
      offset,
      view: 'flat',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
