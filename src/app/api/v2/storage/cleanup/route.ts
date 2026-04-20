import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { cleanupBlobRetention } from '@/lib/blob-retention';

const cleanupSchema = z.object({
  workspaceId: z.string().min(1),
  retentionDays: z.number().int().min(1).max(365).optional(),
  maxScanned: z.number().int().min(100).max(20000).optional(),
});

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

    const result = await cleanupBlobRetention({
      retentionDays: body.retentionDays,
      maxScanned: body.maxScanned,
    });

    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}
