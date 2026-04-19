import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { createAssistantBatchRun } from '@/lib/assistant/service';

const createBatchSchema = z.object({
  workspaceId: z.string().min(1),
  scanJobId: z.string().min(1),
  conversationId: z.string().min(1).optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const body = createBatchSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const batch = await createAssistantBatchRun({
      workspaceId: body.workspaceId,
      scanJobId: body.scanJobId,
      conversationId: body.conversationId,
      accessLink: auth.link,
    });

    return ok(batch, null, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
