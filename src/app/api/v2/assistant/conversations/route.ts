import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson, requireParam } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import {
  createAssistantConversation,
  listAssistantConversations,
} from '@/lib/assistant/service';

const createSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().max(120).optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    const workspaceId = requireParam(
      new URL(request.url).searchParams.get('workspaceId'),
      'workspaceId'
    );

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const rows = await listAssistantConversations({
      workspaceId,
      accessLink: auth.link,
    });

    return ok(rows);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.VIEWER
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const conversation = await createAssistantConversation({
      workspaceId: body.workspaceId,
      title: body.title,
      accessLink: auth.link,
    });

    return ok(conversation, null, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
