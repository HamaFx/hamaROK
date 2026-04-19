import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { fail, handleApiError, ok } from '@/lib/api-response';
import { enqueueWorkspaceEmbeddingBackfill } from '@/lib/embeddings/service';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params;
    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.EDITOR);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const queued = await enqueueWorkspaceEmbeddingBackfill({
      workspaceId,
      accessLink: auth.link,
    });

    return ok(queued, null, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
