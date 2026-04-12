import { NextRequest } from 'next/server';
import { Prisma, WorkspaceRole } from '@prisma/client';
import {
  fail,
  handleApiError,
  ok,
  parseBooleanQuery,
  parseIntQuery,
  requireParam,
} from '@/lib/api-response';
import { getQueryParam } from '@/lib/v2';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { compareWorkspaceEvents } from '@/lib/compare-service';
import { prisma } from '@/lib/prisma';

function createShareSlug() {
  return `rpt_${Math.random().toString(36).slice(2, 10)}${Date.now()
    .toString(36)
    .slice(-4)}`;
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = requireParam(getQueryParam(request, 'workspaceId'), 'workspaceId');
    const eventA = requireParam(getQueryParam(request, 'eventA'), 'eventA');
    const eventB = requireParam(getQueryParam(request, 'eventB'), 'eventB');
    const persist = parseBooleanQuery(getQueryParam(request, 'persist'), false);
    const storeAnomalies = parseBooleanQuery(
      getQueryParam(request, 'storeAnomalies'),
      persist
    );
    const topN = parseIntQuery(getQueryParam(request, 'topN'), 10, 3, 50);

    const requiredRole = persist ? WorkspaceRole.EDITOR : WorkspaceRole.VIEWER;
    const auth = await authorizeWorkspaceAccess(request, workspaceId, requiredRole);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const result = await compareWorkspaceEvents({
      workspaceId,
      eventAId: eventA,
      eventBId: eventB,
    });

    let reportSnapshot: { id: string; shareSlug: string } | null = null;
    if (persist || storeAnomalies) {
      await prisma.$transaction(async (tx) => {
        if (storeAnomalies) {
          await tx.anomaly.deleteMany({
            where: {
              workspaceId,
              eventAId: eventA,
              eventBId: eventB,
              type: 'COMPARISON',
            },
          });

          const rows = result.comparisons.flatMap((entry) => {
            if (entry.anomalies.length === 0) return [];
            return entry.anomalies.map((anomaly) => ({
              workspaceId,
              governorId: entry.governor.id,
              eventAId: eventA,
              eventBId: eventB,
              code: anomaly.code,
              type: 'COMPARISON',
              message: anomaly.message,
              severity: anomaly.severity,
              context: {
                compareType: anomaly.type,
                governorName: entry.governor.name,
                deltas: entry.deltas,
                details: anomaly.context,
              } as Prisma.InputJsonValue,
            }));
          });

          if (rows.length > 0) {
            await tx.anomaly.createMany({ data: rows });
          }
        }

        if (persist) {
          const created = await tx.reportSnapshot.create({
            data: {
              workspaceId,
              eventAId: eventA,
              eventBId: eventB,
              createdByLinkId: auth.link.id,
              shareSlug: createShareSlug(),
              payload: result as unknown as Prisma.InputJsonValue,
            },
            select: {
              id: true,
              shareSlug: true,
            },
          });
          reportSnapshot = created;
        }
      });
    }

    const leaderboard = result.comparisons.slice(0, topN);

    return ok({
      ...result,
      leaderboard,
      leaderboardCount: leaderboard.length,
      reportSnapshot,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
