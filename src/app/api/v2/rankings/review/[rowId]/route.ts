import { NextRequest } from 'next/server';
import { RankingRowReviewAction, WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { applyRankingReviewAction } from '@/lib/rankings/service';

const correctionSchema = z.object({
  sourceRank: z.number().int().min(1).max(5000).optional().nullable(),
  governorNameRaw: z.string().max(80).optional(),
  allianceRaw: z.string().max(80).optional().nullable(),
  titleRaw: z.string().max(80).optional().nullable(),
  metricRaw: z.string().max(80).optional(),
  metricValue: z.union([z.string(), z.number(), z.bigint()]).optional().nullable(),
});

const patchSchema = z.object({
  workspaceId: z.string().min(1),
  action: z.nativeEnum(RankingRowReviewAction),
  reason: z.string().max(300).optional(),
  governorDbId: z.string().optional(),
  governorGameId: z.string().optional(),
  aliasRaw: z.string().max(80).optional(),
  corrected: correctionSchema.optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ rowId: string }> }
) {
  try {
    const { rowId } = await params;
    const body = patchSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const result = await applyRankingReviewAction({
      workspaceId: body.workspaceId,
      rowId,
      changedByLinkId: auth.link.id,
      action: body.action,
      reason: body.reason,
      governorDbId: body.governorDbId,
      governorGameId: body.governorGameId,
      aliasRaw: body.aliasRaw,
      corrected: body.corrected,
    });

    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}
