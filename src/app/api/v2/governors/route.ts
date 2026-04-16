import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { fail, handleApiError, ok, parseBooleanQuery } from '@/lib/api-response';
import { getQueryParam, parsePagination } from '@/lib/v2';
import { prisma } from '@/lib/prisma';

const SEARCH_LIMIT = 200;

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

export async function GET(request: NextRequest) {
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

    const search = getQueryParam(request, 'search') || '';
    const includeWeekly = parseBooleanQuery(getQueryParam(request, 'includeWeekly'), false);
    const { limit, offset } = parsePagination(request, { limit: 80, offset: 0 });
    const boundedLimit = Math.min(SEARCH_LIMIT, limit);

    const where = {
      AND: [
        workspaceGovernorScope(workspaceId),
        search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { governorId: { contains: search } },
              ],
            }
          : {},
      ],
    };

    const [governors, total] = await Promise.all([
      prisma.governor.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: boundedLimit,
        skip: offset,
        include: {
          snapshots: {
            where: workspaceSnapshotScope(workspaceId),
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: {
              power: true,
              killPoints: true,
            },
          },
        },
      }),
      prisma.governor.count({ where }),
    ]);

    const governorIds = governors.map((governor) => governor.id);
    const snapshotCounts =
      governorIds.length > 0
        ? await prisma.snapshot.groupBy({
            by: ['governorId'],
            where: {
              governorId: { in: governorIds },
              ...workspaceSnapshotScope(workspaceId),
            },
            _count: { _all: true },
          })
        : [];

    const snapshotCountMap = new Map(
      snapshotCounts.map((row) => [row.governorId, row._count._all])
    );

    // Fetch weekly stats if requested
    const weeklyStatsMap = new Map<string, Record<string, string>>();
    const previousWeekStatsMap = new Map<string, Record<string, string>>();
    let currentWeekKey: string | null = null;

    if (includeWeekly && governorIds.length > 0) {
      // Find the current open weekly event
      const currentWeekEvent = await prisma.event.findFirst({
        where: {
          workspaceId,
          eventType: 'WEEKLY',
          isClosed: false,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, weekKey: true },
      });

      if (currentWeekEvent) {
        currentWeekKey = currentWeekEvent.weekKey;

        // Fetch all observations for the current week for these governors
        const observations = await prisma.metricObservation.findMany({
          where: {
            workspaceId,
            eventId: currentWeekEvent.id,
            governorId: { in: governorIds },
          },
          orderBy: { observedAt: 'desc' },
          select: {
            governorId: true,
            metricKey: true,
            metricValue: true,
          },
        });

        // De-duplicate: latest observation per governor+metric
        const seenKeys = new Set<string>();
        for (const obs of observations) {
          const key = `${obs.governorId}:${obs.metricKey}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          if (!weeklyStatsMap.has(obs.governorId)) {
            weeklyStatsMap.set(obs.governorId, {});
          }
          weeklyStatsMap.get(obs.governorId)![obs.metricKey] = obs.metricValue.toString();
        }

        // Find previous week event for growth calculation
        const previousWeekEvent = await prisma.event.findFirst({
          where: {
            workspaceId,
            eventType: 'WEEKLY',
            id: { not: currentWeekEvent.id },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });

        if (previousWeekEvent) {
          const prevObs = await prisma.metricObservation.findMany({
            where: {
              workspaceId,
              eventId: previousWeekEvent.id,
              governorId: { in: governorIds },
            },
            orderBy: { observedAt: 'desc' },
            select: {
              governorId: true,
              metricKey: true,
              metricValue: true,
            },
          });

          const prevSeen = new Set<string>();
          for (const obs of prevObs) {
            const key = `${obs.governorId}:${obs.metricKey}`;
            if (prevSeen.has(key)) continue;
            prevSeen.add(key);

            if (!previousWeekStatsMap.has(obs.governorId)) {
              previousWeekStatsMap.set(obs.governorId, {});
            }
            previousWeekStatsMap.get(obs.governorId)![obs.metricKey] = obs.metricValue.toString();
          }
        }
      }
    }

    return ok(
      governors.map((governor) => ({
        id: governor.id,
        governorId: governor.governorId,
        name: governor.name,
        alliance: governor.alliance || '',
        snapshotCount: snapshotCountMap.get(governor.id) || 0,
        latestPower: governor.snapshots[0]?.power?.toString() || '0',
        latestKillPoints: governor.snapshots[0]?.killPoints?.toString() || '0',
        ...(includeWeekly
          ? {
              weeklyStats: weeklyStatsMap.get(governor.id) || {},
              previousWeekStats: previousWeekStatsMap.get(governor.id) || {},
            }
          : {}),
      })),
      {
        total,
        limit: boundedLimit,
        offset,
        ...(currentWeekKey ? { weekKey: currentWeekKey } : {}),
      }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
