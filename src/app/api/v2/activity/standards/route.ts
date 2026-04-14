import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson, requireParam } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { listActivityStandards, upsertActivityStandards } from '@/lib/activity/service';
import { invalidateServerCacheTags } from '@/lib/server-cache';
import { workspaceCacheTags } from '@/lib/cache-scopes';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const standardSchema = z.object({
  allianceTag: z.string().min(2).max(12),
  metricKey: z.enum(['power_growth', 'contribution_points']),
  minimumValue: z.union([z.string(), z.number(), z.bigint()]),
  isActive: z.boolean().optional(),
});

const patchSchema = z.object({
  workspaceId: z.string().min(1),
  standards: z.array(standardSchema).min(1).max(20),
});

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const rows = await listActivityStandards(workspaceId);
    return ok(rows);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = patchSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(request, body.workspaceId, WorkspaceRole.EDITOR);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const rows = await upsertActivityStandards({
      workspaceId: body.workspaceId,
      standards: body.standards,
    });

    invalidateServerCacheTags(Object.values(workspaceCacheTags(body.workspaceId)));

    return ok(rows);
  } catch (error) {
    return handleApiError(error);
  }
}
