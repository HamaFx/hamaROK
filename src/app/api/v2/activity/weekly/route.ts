import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { fail, handleApiError, ok, requireParam } from '@/lib/api-response';
import { parseCommaValues } from '@/lib/v2';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { getWeeklyActivityReport } from '@/lib/activity/service';
import { makeServerCacheKey, withServerCache } from '@/lib/server-cache';
import { workspaceCacheTags } from '@/lib/cache-scopes';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const weekKey = url.searchParams.get('weekKey')?.trim() || null;
    const alliances = [...new Set(parseCommaValues(url.searchParams.get('alliance')))];
    const sortedAlliances = [...alliances].sort();

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const tags = workspaceCacheTags(workspaceId);
    const result = await withServerCache(
      makeServerCacheKey('api:v2:activity:weekly', {
        workspaceId,
        weekKey,
        alliances: sortedAlliances,
      }),
      {
        ttlMs: 8_000,
        tags: [tags.all, tags.rankings],
      },
      () =>
        getWeeklyActivityReport({
          workspaceId,
          weekKey,
          alliances,
        })
    );

    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}
