import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ok, fail, handleApiError } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  try {
    const { id: workspaceId, linkId } = await params;
    const auth = await authorizeWorkspaceAccess(
      request,
      workspaceId,
      WorkspaceRole.OWNER
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const existing = await prisma.accessLink.findFirst({
      where: { id: linkId, workspaceId },
    });

    if (!existing) {
      return fail('NOT_FOUND', 'Access link not found.', 404);
    }

    const link = await prisma.accessLink.update({
      where: { id: linkId },
      data: { revokedAt: new Date() },
      select: {
        id: true,
        role: true,
        label: true,
        revokedAt: true,
      },
    });

    return ok({
      id: link.id,
      role: link.role,
      label: link.label,
      revokedAt: link.revokedAt?.toISOString() ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
