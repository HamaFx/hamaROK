import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { cleanupAssistantWorkspace } from '@/lib/assistant/service';

const cleanupSchema = z.object({
  workspaceId: z.string().min(1),
  mode: z.enum(['archive', 'purge']),
  confirm: z.string().optional(),
  includePendingIdentities: z.boolean().optional(),
});

const PURGE_CONFIRMATION_PHRASE = 'RESET_ASSISTANT_WORKSPACE';

export async function POST(request: NextRequest) {
  try {
    const body = cleanupSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.OWNER
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const requirePurgeConfirmation =
      body.mode === 'purge' && body.confirm !== PURGE_CONFIRMATION_PHRASE;

    const result = await cleanupAssistantWorkspace({
      workspaceId: body.workspaceId,
      accessLink: auth.link,
      mode: body.mode,
      includePendingIdentities: body.includePendingIdentities,
      requirePurgeConfirmation,
    });

    return ok({
      ...result,
      confirmationPhrase: body.mode === 'purge' ? PURGE_CONFIRMATION_PHRASE : null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
