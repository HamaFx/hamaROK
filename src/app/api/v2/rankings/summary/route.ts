import { NextRequest } from 'next/server';
import { EventType, WorkspaceRole } from '@prisma/client';
import { fail, handleApiError, ok, parseIntQuery, requireParam } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { getRankingSummary } from '@/lib/rankings/service';
import { makeServerCacheKey, withServerCache } from '@/lib/server-cache';
import { workspaceCacheTags } from '@/lib/cache-scopes';
import { parseCommaValues } from '@/lib/v2';
import { prisma } from '@/lib/prisma';
import { getWeeklyActivityReport } from '@/lib/activity/service';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const eventIdParam = url.searchParams.get('eventId')?.trim() || null;
    const weekKey = url.searchParams.get('weekKey')?.trim() || null;
    const rankingType = url.searchParams.get('rankingType')?.trim() || null;
    const metricKey = url.searchParams.get('metricKey')?.trim() || null;
    const alliances = [...new Set(parseCommaValues(url.searchParams.get('alliance')))];
    const sortedAlliances = [...alliances].sort();
    const topN = parseIntQuery(url.searchParams.get('topN'), 20, 1, 100);

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    let eventId = eventIdParam;
    if (!eventId && weekKey) {
      const weeklyEvent = await prisma.event.findFirst({
        where: {
          workspaceId,
          eventType: EventType.WEEKLY,
          weekKey,
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!weeklyEvent) {
        return fail('NOT_FOUND', `Weekly event not found for ${weekKey}.`, 404);
      }
      eventId = weeklyEvent.id;
    }

    const tags = workspaceCacheTags(workspaceId);
    const summary = await withServerCache(
      makeServerCacheKey('api:v2:rankings:summary', {
        workspaceId,
        eventId,
        weekKey,
        rankingType,
        metricKey,
        alliances: sortedAlliances,
        topN,
      }),
      {
        ttlMs: 12_000,
        tags: [tags.all, tags.rankings],
      },
      () =>
        getRankingSummary({
          workspaceId,
          eventId,
          rankingType,
          metricKey,
          alliances,
          topN,
        })
    );

    let weeklyActivity: Awaited<ReturnType<typeof getWeeklyActivityReport>> | null = null;
    if (weekKey || eventId) {
      const weeklyEvent = eventId
        ? await prisma.event.findFirst({
            where: {
              id: eventId,
              workspaceId,
              eventType: EventType.WEEKLY,
            },
            select: { id: true, weekKey: true },
          })
        : null;
      if (weekKey || weeklyEvent?.weekKey) {
        weeklyActivity = await getWeeklyActivityReport({
          workspaceId,
          weekKey: weekKey || weeklyEvent?.weekKey || undefined,
          alliances,
        });
      }
    }

    return ok({
      ...summary,
      weeklyActivity: weeklyActivity
        ? {
            event: weeklyActivity.event,
            previousEvent: weeklyActivity.previousEvent,
            summary: weeklyActivity.summary,
          }
        : null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
