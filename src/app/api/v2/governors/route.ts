import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { fail, handleApiError, ok } from '@/lib/api-response';
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

    return ok(
      governors.map((governor) => ({
        id: governor.id,
        governorId: governor.governorId,
        name: governor.name,
        alliance: governor.alliance || '',
        snapshotCount: snapshotCountMap.get(governor.id) || 0,
        latestPower: governor.snapshots[0]?.power?.toString() || '0',
      })),
      {
        total,
        limit: boundedLimit,
        offset,
      }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
