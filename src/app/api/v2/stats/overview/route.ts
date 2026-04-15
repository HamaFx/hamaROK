import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { fail, handleApiError, ok, requireParam } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { getWorkspaceStatsOverview } from '@/lib/stats-overview';
import { assertWeeklySchemaCapability } from '@/lib/weekly-schema-guard';
import { drainMetricSyncBacklogOnRead } from '@/lib/metric-sync';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const weekKey = url.searchParams.get('weekKey')?.trim() || null;

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    await assertWeeklySchemaCapability();
    await drainMetricSyncBacklogOnRead(workspaceId, 10);

    const data = await getWorkspaceStatsOverview({
      workspaceId,
      weekKey,
    });

    return ok(data);
  } catch (error) {
    return handleApiError(error);
  }
}
