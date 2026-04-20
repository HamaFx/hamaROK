import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { getQueryParam } from '@/lib/v2';
import { prisma } from '@/lib/prisma';
import { deleteGovernorTx, updateGovernorTx } from '@/lib/domain/workspace-actions';
import { METRIC_KEY_KILL_POINTS, METRIC_KEY_POWER } from '@/lib/metric-sync';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const workspaceId = getQueryParam(request, 'workspaceId');
    if (!workspaceId) {
      return fail('VALIDATION_ERROR', 'workspaceId is required.', 400);
    }

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const governor = await prisma.governor.findUnique({
      where: { id },
      include: {
        aliases: {
          where: { workspaceId },
          select: {
            id: true,
            aliasRaw: true,
            aliasNormalized: true,
            source: true,
            confidence: true,
          },
        },
        snapshots: {
          where: {
            OR: [{ workspaceId }, { event: { workspaceId } }],
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            eventId: true,
            power: true,
            killPoints: true,
            t4Kills: true,
            t5Kills: true,
            deads: true,
            createdAt: true,
          },
        },
      },
    });

    if (!governor) {
      return fail('NOT_FOUND', 'Governor not found.', 404);
    }

    // Get latest weekly event for this workspace
    const currentWeekEvent = await prisma.event.findFirst({
      where: {
        workspaceId,
        eventType: 'WEEKLY',
        isClosed: false,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, weekKey: true },
    });

    // Get metric observations for current week
    const weeklyStats: Record<string, string> = {};
    if (currentWeekEvent) {
      const observations = await prisma.metricObservation.findMany({
        where: {
          workspaceId,
          eventId: currentWeekEvent.id,
          governorId: governor.id,
        },
        orderBy: { observedAt: 'desc' },
        select: {
          metricKey: true,
          metricValue: true,
        },
      });

      // Take the latest observation per metric key
      const seen = new Set<string>();
      for (const obs of observations) {
        if (!seen.has(obs.metricKey)) {
          seen.add(obs.metricKey);
          weeklyStats[obs.metricKey] = obs.metricValue.toString();
        }
      }
    }

    // Get previous week stats for growth calculation
    const previousWeekStats: Record<string, string> = {};
    if (currentWeekEvent) {
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
            governorId: governor.id,
          },
          orderBy: { observedAt: 'desc' },
          select: {
            metricKey: true,
            metricValue: true,
          },
        });

        const prevSeen = new Set<string>();
        for (const obs of prevObs) {
          if (!prevSeen.has(obs.metricKey)) {
            prevSeen.add(obs.metricKey);
            previousWeekStats[obs.metricKey] = obs.metricValue.toString();
          }
        }
      }
    }

    const [snapshotCount, latestObservations] = await Promise.all([
      prisma.snapshot.count({
        where: {
          governorId: governor.id,
          OR: [{ workspaceId }, { event: { workspaceId } }],
        },
      }),
      prisma.metricObservation.findMany({
        where: {
          workspaceId,
          governorId: governor.id,
          metricKey: { in: [METRIC_KEY_POWER, METRIC_KEY_KILL_POINTS] },
        },
        orderBy: [{ observedAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          metricKey: true,
          metricValue: true,
        },
      }),
    ]);

    let latestPower = governor.snapshots[0]?.power?.toString() || '0';
    let latestKillPoints = governor.snapshots[0]?.killPoints?.toString() || '0';
    const seenLatestMetric = new Set<string>();
    for (const observation of latestObservations) {
      if (seenLatestMetric.has(observation.metricKey)) continue;
      seenLatestMetric.add(observation.metricKey);
      if (observation.metricKey === METRIC_KEY_POWER) {
        latestPower = observation.metricValue.toString();
      } else if (observation.metricKey === METRIC_KEY_KILL_POINTS) {
        latestKillPoints = observation.metricValue.toString();
      }
      if (seenLatestMetric.size >= 2) break;
    }

    return ok({
      id: governor.id,
      governorId: governor.governorId,
      name: governor.name,
      alliance: governor.alliance || '',
      workspaceId: governor.workspaceId,
      createdAt: governor.createdAt.toISOString(),
      updatedAt: governor.updatedAt.toISOString(),
      aliases: governor.aliases,
      snapshotCount,
      latestPower,
      latestKillPoints,
      recentSnapshots: governor.snapshots.map((s) => ({
        id: s.id,
        eventId: s.eventId,
        power: s.power.toString(),
        killPoints: s.killPoints.toString(),
        t4Kills: s.t4Kills.toString(),
        t5Kills: s.t5Kills.toString(),
        deads: s.deads.toString(),
        createdAt: s.createdAt.toISOString(),
      })),
      weeklyStats,
      previousWeekStats,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

interface PatchBody {
  workspaceId: string;
  name?: string;
  alliance?: string;
  governorId?: string;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJson<PatchBody>(request);

    if (!body.workspaceId) {
      return fail('VALIDATION_ERROR', 'workspaceId is required.', 400);
    }

    const auth = await authorizeWorkspaceAccess(request, body.workspaceId, WorkspaceRole.EDITOR);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const updated = await prisma.$transaction((tx) =>
      updateGovernorTx(tx, {
        workspaceId: body.workspaceId,
        governorDbId: id,
        name: body.name,
        alliance: body.alliance,
        governorId: body.governorId,
      })
    );

    return ok(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const workspaceId = getQueryParam(request, 'workspaceId');
    if (!workspaceId) {
      return fail('VALIDATION_ERROR', 'workspaceId is required.', 400);
    }

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.OWNER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const result = await prisma.$transaction((tx) =>
      deleteGovernorTx(tx, {
        workspaceId,
        governorDbId: id,
      })
    );

    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}
