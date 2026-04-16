import { NextRequest } from 'next/server';
import { EventType, WorkspaceRole } from '@prisma/client';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { fail, handleApiError, ok, parseIntQuery } from '@/lib/api-response';
import { getQueryParam } from '@/lib/v2';
import { prisma } from '@/lib/prisma';
import { getWeeklyActivityReport } from '@/lib/activity/service';

const workspaceGovernorScope = (workspaceId: string) => ({
  OR: [
    { workspaceId },
    { snapshots: { some: { workspaceId } } },
    { snapshots: { some: { event: { workspaceId } } } },
    { rankingRows: { some: { workspaceId } } },
    { rankingSnapshots: { some: { workspaceId } } },
  ],
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
      },
    });

    if (!governor) {
      return fail('NOT_FOUND', 'Governor not found in this workspace.', 404);
    }

    const url = new URL(request.url);
    const limit = parseIntQuery(url.searchParams.get('limit'), 10, 1, 26);

    const weeks = await prisma.event.findMany({
      where: {
        workspaceId,
        eventType: EventType.WEEKLY,
        weekKey: { not: null },
      },
      select: {
        id: true,
        name: true,
        weekKey: true,
        startsAt: true,
      },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    const history = [];
    for (const week of weeks) {
      if (!week.weekKey) continue;
      const report = await getWeeklyActivityReport({
        workspaceId,
        weekKey: week.weekKey,
      });
      const row = report.rows.find((entry) => entry.governorDbId === governor.id);
      history.push({
        weekKey: week.weekKey,
        weekName: week.name,
        startsAt: week.startsAt?.toISOString() || null,
        metrics: row
          ? {
              contributionPoints: row.contributionPoints,
              fortDestroying: row.fortDestroying,
              powerGrowth: row.powerGrowth,
              killPointsGrowth: row.killPointsGrowth,
              t4KillsGrowth: row.t4KillsGrowth,
              t5KillsGrowth: row.t5KillsGrowth,
              deadsGrowth: row.deadsGrowth,
              powerBaselineReady: row.powerBaselineReady,
              killPointsBaselineReady: row.killPointsBaselineReady,
              compliance: row.compliance,
            }
          : null,
      });
    }

    return ok({
      governor,
      history,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
