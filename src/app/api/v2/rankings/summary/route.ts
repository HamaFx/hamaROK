import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { fail, handleApiError, ok, parseIntQuery, requireParam } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { getRankingSummary } from '@/lib/rankings/service';
import { makeServerCacheKey, withServerCache } from '@/lib/server-cache';
import { workspaceCacheTags } from '@/lib/cache-scopes';
import { parseCommaValues } from '@/lib/v2';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const eventId = url.searchParams.get('eventId')?.trim() || null;
    const rankingType = url.searchParams.get('rankingType')?.trim() || null;
    const metricKey = url.searchParams.get('metricKey')?.trim() || null;
    const alliances = [...new Set(parseCommaValues(url.searchParams.get('alliance')))];
    const sortedAlliances = [...alliances].sort();
    const topN = parseIntQuery(url.searchParams.get('topN'), 20, 1, 100);

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const tags = workspaceCacheTags(workspaceId);
    const summary = await withServerCache(
      makeServerCacheKey('api:v2:rankings:summary', {
        workspaceId,
        eventId,
        rankingType,
        metricKey,
        alliances: sortedAlliances,
        topN,
      }),
      {
        ttlMs: 12_000,
        tags: [tags.all, tags.rankings],
      },
      () =>
        getRankingSummary({
          workspaceId,
          eventId,
          rankingType,
          metricKey,
          alliances,
          topN,
        })
    );

    return ok(summary);
  } catch (error) {
    return handleApiError(error);
  }
}
