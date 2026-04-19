import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { updateAssistantConversation } from '@/lib/assistant/service';

const updateConversationSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().max(120).optional().nullable(),
  threadConfig: z
    .object({
      threadInstructions: z.string().max(2000).optional().nullable(),
      analyzerOverride: z
        .enum(['inherit', 'hybrid', 'ocr_pipeline', 'vision_model'])
        .optional()
        .nullable(),
    })
    .optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const body = updateConversationSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(request, body.workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const updated = await updateAssistantConversation({
      workspaceId: body.workspaceId,
      conversationId,
      accessLink: auth.link,
      title: body.title,
      threadConfig: body.threadConfig,
    });

    return ok(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

