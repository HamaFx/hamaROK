import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { runAssistantBatchContinuous } from '@/lib/assistant/service';

const runSchema = z.object({
  workspaceId: z.string().min(1),
  maxSteps: z.number().int().min(1).max(500).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: batchId } = await params;
    const body = runSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const result = await runAssistantBatchContinuous({
      workspaceId: body.workspaceId,
      batchId,
      accessLink: auth.link,
      maxSteps: body.maxSteps,
    });

    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}
