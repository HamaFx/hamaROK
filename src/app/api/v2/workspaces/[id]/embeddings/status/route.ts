import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { fail, handleApiError, ok } from '@/lib/api-response';
import { getWorkspaceEmbeddingStatus } from '@/lib/embeddings/service';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params;
    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const status = await getWorkspaceEmbeddingStatus({
      workspaceId,
      accessLink: auth.link,
    });

    return ok(status);
  } catch (error) {
    return handleApiError(error);
  }
}
