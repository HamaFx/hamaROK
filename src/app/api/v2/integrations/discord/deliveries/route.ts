import { NextRequest } from 'next/server';
import { DeliveryStatus, WorkspaceRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fail, handleApiError, ok } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { parsePagination, getQueryParam } from '@/lib/v2';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = getQueryParam(request, 'workspaceId');
    if (!workspaceId) {
      return fail('VALIDATION_ERROR', 'workspaceId is required.', 400);
    }

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const statusParam = getQueryParam(request, 'status');
    const status =
      statusParam && Object.values(DeliveryStatus).includes(statusParam as DeliveryStatus)
        ? (statusParam as DeliveryStatus)
        : null;

    const { limit, offset } = parsePagination(request, { limit: 30, offset: 0 });

    const where = {
      workspaceId,
      integration: 'discord',
      ...(status ? { status } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.deliveryLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.deliveryLog.count({ where }),
    ]);

    return ok(
      items.map((item) => ({
        id: item.id,
        status: item.status,
        attemptCount: item.attemptCount,
        lastError: item.lastError,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        nextAttemptAt: item.nextAttemptAt?.toISOString() ?? null,
      })),
      { total, limit, offset }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
