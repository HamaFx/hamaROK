import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { fail, handleApiError, ok, parseIntQuery, requireParam } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { drainMetricSyncBacklog } from '@/lib/metric-sync';
import { assertWeeklySchemaCapability } from '@/lib/weekly-schema-guard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    let bodyWorkspaceId: string | null = null;
    let bodyLimit: string | null = null;
    if ((request.headers.get('content-type') || '').includes('application/json')) {
      const payload = (await request.json().catch(() => null)) as
        | { workspaceId?: unknown; limit?: unknown }
        | null;
      if (payload && typeof payload.workspaceId === 'string') {
        bodyWorkspaceId = payload.workspaceId;
      }
      if (payload && payload.limit != null) {
        bodyLimit = String(payload.limit);
      }
    }

    const workspaceId = requireParam(
      url.searchParams.get('workspaceId') || bodyWorkspaceId,
      'workspaceId'
    );
    const limit = parseIntQuery(url.searchParams.get('limit') || bodyLimit, 50, 1, 100);

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.EDITOR);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    await assertWeeklySchemaCapability();

    const result = await drainMetricSyncBacklog({
      workspaceId,
      limit,
      changedByLinkId: auth.link.id,
    });

    return ok({
      workspaceId,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      pending: result.pending,
      limit,
      drainedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
