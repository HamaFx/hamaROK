import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { ok, fail, handleApiError, parseIntQuery, requireParam } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { buildWorkspaceAnalytics } from '@/lib/analytics';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const eventA = url.searchParams.get('eventA');
    const eventB = url.searchParams.get('eventB');
    const topN = parseIntQuery(url.searchParams.get('topN'), 10, 3, 50);

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const analytics = await buildWorkspaceAnalytics({
      workspaceId,
      eventAId: eventA,
      eventBId: eventB,
      topN,
    });

    return ok(analytics);
  } catch (error) {
    return handleApiError(error);
  }
}
