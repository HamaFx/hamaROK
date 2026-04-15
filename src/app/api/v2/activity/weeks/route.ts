import { NextRequest } from 'next/server';
import { EventType, WorkspaceRole } from '@prisma/client';
import { fail, handleApiError, ok, parseIntQuery, requireParam } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { assertWeeklySchemaCapability } from '@/lib/weekly-schema-guard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const limit = parseIntQuery(url.searchParams.get('limit'), 52, 1, 100);

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    await assertWeeklySchemaCapability();

    const weeks = await prisma.event.findMany({
      where: {
        workspaceId,
        eventType: EventType.WEEKLY,
        weekKey: { not: null },
      },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        name: true,
        weekKey: true,
        startsAt: true,
        endsAt: true,
        isClosed: true,
        _count: {
          select: {
            rankingSnapshots: true,
            snapshots: true,
          },
        },
      },
    });

    return ok(
      weeks.map((week) => ({
        id: week.id,
        name: week.name,
        weekKey: week.weekKey,
        startsAt: week.startsAt?.toISOString() || null,
        endsAt: week.endsAt?.toISOString() || null,
        isClosed: week.isClosed,
        rankingSnapshotCount: week._count.rankingSnapshots,
        snapshotCount: week._count.snapshots,
      }))
    );
  } catch (error) {
    return handleApiError(error);
  }
}
