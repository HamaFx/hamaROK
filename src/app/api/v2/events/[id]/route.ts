import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { fail, handleApiError, ok } from '@/lib/api-response';
import { getQueryParam } from '@/lib/v2';
import { prisma } from '@/lib/prisma';

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
    const event = await prisma.event.findFirst({
      where: { id, workspaceId },
      include: {
        snapshots: {
          where: {
            OR: [{ workspaceId }, { workspaceId: null }],
          },
          include: {
            governor: {
              select: {
                id: true,
                governorId: true,
                name: true,
              },
            },
          },
          orderBy: {
            governor: { name: 'asc' },
          },
        },
      },
    });

    if (!event) {
      return fail('NOT_FOUND', 'Event not found in this workspace.', 404);
    }

    return ok({
      id: event.id,
      workspaceId: event.workspaceId,
      name: event.name,
      description: event.description,
      eventType: event.eventType,
      createdAt: event.createdAt.toISOString(),
      snapshots: event.snapshots.map((snapshot) => ({
        id: snapshot.id,
        governor: {
          id: snapshot.governor.id,
          governorId: snapshot.governor.governorId,
          name: snapshot.governor.name,
        },
        power: snapshot.power.toString(),
        killPoints: snapshot.killPoints.toString(),
        t4Kills: snapshot.t4Kills.toString(),
        t5Kills: snapshot.t5Kills.toString(),
        deads: snapshot.deads.toString(),
        verified: snapshot.verified,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
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
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const { id } = await params;
    const event = await prisma.event.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });

    if (!event) {
      return fail('NOT_FOUND', 'Event not found in this workspace.', 404);
    }

    await prisma.event.delete({
      where: { id: event.id },
    });

    return ok({ id: event.id, deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
