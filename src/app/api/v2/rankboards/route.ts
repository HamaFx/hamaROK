import { NextRequest } from 'next/server';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { compareWorkspaceEvents } from '@/lib/compare-service';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { fail, handleApiError, ok, readJson, requireParam } from '@/lib/api-response';
import { parsePagination } from '@/lib/v2';

const createSchema = z.object({
  workspaceId: z.string().min(1),
  eventA: z.string().min(1),
  eventB: z.string().min(1),
  topN: z.number().int().min(3).max(100).default(20),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

function createSlug() {
  return `rbd_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const { limit, offset } = parsePagination(request, { limit: 25, offset: 0 });

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const snapshots = await prisma.reportSnapshot.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(limit + offset, 100),
      select: {
        id: true,
        shareSlug: true,
        createdAt: true,
        expiresAt: true,
        payload: true,
        eventA: { select: { id: true, name: true } },
        eventB: { select: { id: true, name: true } },
      },
    });

    const rankboards = snapshots
      .filter((item) => {
        const payload = item.payload as Record<string, unknown> | null;
        return payload?.kind === 'rankboard';
      })
      .slice(offset, offset + limit)
      .map((item) => ({
        id: item.id,
        slug: item.shareSlug,
        eventA: item.eventA,
        eventB: item.eventB,
        createdAt: item.createdAt.toISOString(),
        expiresAt: item.expiresAt?.toISOString() ?? null,
      }));

    return ok(rankboards, {
      total: snapshots.length,
      limit,
      offset,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(request, body.workspaceId, WorkspaceRole.EDITOR);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const compare = await compareWorkspaceEvents({
      workspaceId: body.workspaceId,
      eventAId: body.eventA,
      eventBId: body.eventB,
    });

    const rows = compare.comparisons
      .filter((item) => item.warriorScore)
      .slice(0, body.topN)
      .map((item) => ({
        rank: item.warriorScore?.rank ?? null,
        governorId: item.governor.governorId,
        governorName: item.governor.name,
        score: item.warriorScore?.totalScore ?? 0,
        actualDkp: item.warriorScore?.actualDkp ?? 0,
        expectedDkp: item.warriorScore?.expectedDkp ?? item.warriorScore?.expectedKp ?? 0,
        kpDelta: item.deltas.killPoints,
        deadsDelta: item.deltas.deads,
        tier: item.warriorScore?.tier ?? 'Inactive',
      }));

    const payload = {
      kind: 'rankboard',
      generatedAt: new Date().toISOString(),
      topN: body.topN,
      summary: compare.summary,
      eventA: compare.eventA,
      eventB: compare.eventB,
      rows,
    };

    const created = await prisma.reportSnapshot.create({
      data: {
        workspaceId: body.workspaceId,
        eventAId: body.eventA,
        eventBId: body.eventB,
        createdByLinkId: auth.link.id,
        shareSlug: createSlug(),
        expiresAt: body.expiresInDays
          ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
          : null,
        payload: payload as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        shareSlug: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    return ok(
      {
        id: created.id,
        slug: created.shareSlug,
        shareUrl: `${appUrl.replace(/\/$/, '')}/api/v2/rankboards/${created.shareSlug}`,
        createdAt: created.createdAt.toISOString(),
        expiresAt: created.expiresAt?.toISOString() ?? null,
      },
      null,
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
