import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { fail, handleApiError, ok, parseIntQuery, requireParam } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { getRankingSummary } from '@/lib/rankings/service';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const eventId = url.searchParams.get('eventId')?.trim() || null;
    const rankingType = url.searchParams.get('rankingType')?.trim() || null;
    const topN = parseIntQuery(url.searchParams.get('topN'), 20, 1, 100);

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const summary = await getRankingSummary({
      workspaceId,
      eventId,
      rankingType,
      topN,
    });

    return ok(summary);
  } catch (error) {
    return handleApiError(error);
  }
}
