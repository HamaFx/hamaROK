import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, handleApiError, readJson } from '@/lib/api-response';
import { parsePagination } from '@/lib/v2';
import { createOpaqueToken, hashAccessToken } from '@/lib/security';
import { getDefaultFallbackOcrModel } from '@/lib/ocr/fallback-config';
import { PRIMARY_KINGDOM_NUMBER } from '@/lib/alliances';

const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  kingdomTag: z.string().max(12).optional(),
  description: z.string().max(300).optional(),
});

function toSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

export async function GET(request: NextRequest) {
  try {
    const { limit, offset } = parsePagination(request, { limit: 25, offset: 0 });
    const includeArchived =
      new URL(request.url).searchParams.get('includeArchived') === 'true';

    const where = includeArchived ? {} : { isArchived: false };

    const [workspaces, total] = await Promise.all([
      prisma.workspace.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          _count: {
            select: {
              events: true,
              snapshots: true,
              governors: true,
            },
          },
        },
      }),
      prisma.workspace.count({ where }),
    ]);

    return ok(
      workspaces.map((workspace) => ({
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        kingdomTag: workspace.kingdomTag,
        description: workspace.description,
        isArchived: workspace.isArchived,
        createdAt: workspace.createdAt.toISOString(),
        updatedAt: workspace.updatedAt.toISOString(),
        counts: workspace._count,
      })),
      { total, limit, offset }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createWorkspaceSchema.parse(await readJson(request));
    const slugBase = body.slug || toSlug(body.name);

    if (!slugBase) {
      return fail('VALIDATION_ERROR', 'Workspace slug could not be generated.', 400);
    }

    const existing = await prisma.workspace.findUnique({ where: { slug: slugBase } });
    const slug = existing ? `${slugBase}-${Date.now().toString(36).slice(-5)}` : slugBase;

    const token = createOpaqueToken(32);
    const tokenHash = hashAccessToken(token);
    const defaultFallbackProvider = 'google_vision' as const;

    const workspace = await prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          slug,
          name: body.name.trim(),
          kingdomTag: body.kingdomTag?.trim() || PRIMARY_KINGDOM_NUMBER,
          description: body.description?.trim() || null,
        },
      });

      await tx.workspaceSettings.create({
        data: {
          workspaceId: created.id,
          fallbackOcrEnabled: true,
          fallbackOcrMonthlyBudgetUsd: 5,
          fallbackOcrProvider: defaultFallbackProvider,
          fallbackOcrModel: getDefaultFallbackOcrModel(defaultFallbackProvider),
        },
      });

      await tx.accessLink.create({
        data: {
          workspaceId: created.id,
          role: WorkspaceRole.OWNER,
          label: 'Bootstrap Owner Link',
          tokenHash,
        },
      });

      return created;
    });

    return ok(
      {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        kingdomTag: workspace.kingdomTag,
        description: workspace.description,
        createdAt: workspace.createdAt.toISOString(),
        bootstrapAccessToken: token,
      },
      null,
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
