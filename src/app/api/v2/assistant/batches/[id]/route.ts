import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { fail, handleApiError, ok, requireParam } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { getAssistantBatchRun } from '@/lib/assistant/service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: batchId } = await params;
    const workspaceId = requireParam(
      new URL(request.url).searchParams.get('workspaceId'),
      'workspaceId'
    );

    const auth = await authorizeWorkspaceAccess(
      request,
      workspaceId,
      WorkspaceRole.VIEWER
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const batch = await getAssistantBatchRun({
      workspaceId,
      batchId,
      accessLink: auth.link,
    });

    return ok(batch);
  } catch (error) {
    return handleApiError(error);
  }
}
