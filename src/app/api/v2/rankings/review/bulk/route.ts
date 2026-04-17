import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { bulkApplyRankingReviewAction } from '@/lib/rankings/service';
import { invalidateServerCacheTags } from '@/lib/server-cache';
import { rankingRunCacheTag, workspaceCacheTags } from '@/lib/cache-scopes';

const bulkSchema = z.object({
  workspaceId: z.string().min(1),
  mode: z.enum(['ACCEPT_LINKED', 'REJECT_ALL_UNRESOLVED', 'REJECT_ALL_NON_REJECTED']),
  eventId: z.string().optional().nullable(),
  runId: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const body = bulkSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const { count, runIds } = await bulkApplyRankingReviewAction({
      workspaceId: body.workspaceId,
      changedByLinkId: auth.link.id,
      mode: body.mode,
      eventId: body.eventId,
      runId: body.runId,
    });

    const tags = [
      ...Object.values(workspaceCacheTags(body.workspaceId)),
      ...runIds.map((id: string) => rankingRunCacheTag(id))
    ];
    invalidateServerCacheTags(tags);

    return ok({ count });
  } catch (error) {
    return handleApiError(error);
  }
}
