import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { fail, handleApiError, ok } from '@/lib/api-response';
import { getQueryParam } from '@/lib/v2';
import { prisma } from '@/lib/prisma';

const workspaceGovernorScope = (workspaceId: string) => ({
  OR: [
    { workspaceId },
    { snapshots: { some: { workspaceId } } },
    { snapshots: { some: { event: { workspaceId } } } },
    { rankingRows: { some: { workspaceId } } },
    { rankingSnapshots: { some: { workspaceId } } },
  ],
});

const workspaceSnapshotScope = (workspaceId: string) => ({
  OR: [{ workspaceId }, { event: { workspaceId } }],
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const workspaceId = getQueryParam(request, 'workspaceId');
    if (!workspaceId) {
      return fail('VALIDATION_ERROR', 'workspaceId is required.', 400);
    }

    const auth = await authorizeWorkspaceAccess(
      request,
      workspaceId,
      WorkspaceRole.VIEWER
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const { id } = await params;
    const governor = await prisma.governor.findFirst({
      where: {
        id,
        ...workspaceGovernorScope(workspaceId),
      },
      select: {
        id: true,
        governorId: true,
        name: true,
        alliance: true,
      },
    });

    if (!governor) {
      return fail('NOT_FOUND', 'Governor not found in this workspace.', 404);
    }

    const snapshots = await prisma.snapshot.findMany({
      where: {
        governorId: governor.id,
        ...workspaceSnapshotScope(workspaceId),
      },
      include: {
        event: {
          select: {
            id: true,
            name: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ event: { createdAt: 'asc' } }, { createdAt: 'asc' }],
    });

    return ok({
      governor,
      timeline: snapshots.map((snapshot) => ({
        event: {
          id: snapshot.event.id,
          name: snapshot.event.name,
        },
        power: snapshot.power.toString(),
        killPoints: snapshot.killPoints.toString(),
        t4Kills: snapshot.t4Kills.toString(),
        t5Kills: snapshot.t5Kills.toString(),
        deads: snapshot.deads.toString(),
        date: snapshot.event.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
