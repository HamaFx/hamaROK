import { NextRequest } from 'next/server';
import { EventType, WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, handleApiError, readJson } from '@/lib/api-response';
import { parsePagination, getQueryParam } from '@/lib/v2';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';

const createEventSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  eventType: z.nativeEnum(EventType).default(EventType.CUSTOM),
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

    const { limit, offset } = parsePagination(request, { limit: 50, offset: 0 });

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          _count: {
            select: { snapshots: true },
          },
        },
      }),
      prisma.event.count({ where: { workspaceId } }),
    ]);

    return ok(
      events.map((event) => ({
        id: event.id,
        name: event.name,
        description: event.description,
        eventType: event.eventType,
        workspaceId: event.workspaceId,
        snapshotCount: event._count.snapshots,
        createdAt: event.createdAt.toISOString(),
      })),
      { total, limit, offset }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createEventSchema.parse(await readJson(request));
    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const event = await prisma.event.create({
      data: {
        workspaceId: body.workspaceId,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        eventType: body.eventType,
      },
    });

    return ok(
      {
        id: event.id,
        workspaceId: event.workspaceId,
        name: event.name,
        description: event.description,
        eventType: event.eventType,
        createdAt: event.createdAt.toISOString(),
      },
      null,
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
