import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { resolveAssistantPendingIdentity } from '@/lib/assistant/service';

const resolveSchema = z.object({
  workspaceId: z.string().min(1),
  governorDbId: z.string().min(1),
  eventId: z.string().optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pendingIdentityId } = await params;
    const body = resolveSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const result = await resolveAssistantPendingIdentity({
      workspaceId: body.workspaceId,
      pendingIdentityId,
      governorDbId: body.governorDbId,
      eventId: body.eventId || null,
      note: body.note || null,
      accessLink: auth.link,
    });

    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}
