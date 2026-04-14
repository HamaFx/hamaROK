import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { createOpaqueToken, hashAccessToken } from '@/lib/security';
import { getDefaultFallbackOcrModel } from '@/lib/ocr/fallback-config';

const bootstrapSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});

function toSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

export async function POST(request: Request) {
  try {
    const body = bootstrapSchema.parse((await readJson(request).catch(() => ({}))) || {});
    const defaultName = (body.name || 'Hama Kingdom').trim();

    let workspace = await prisma.workspace.findFirst({
      where: { isArchived: false },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
      },
    });

    let createdWorkspace = false;

    if (!workspace) {
      const slugBase = body.slug || toSlug(defaultName) || `workspace-${Date.now().toString(36)}`;
      const existing = await prisma.workspace.findUnique({ where: { slug: slugBase } });
      const slug = existing ? `${slugBase}-${Date.now().toString(36).slice(-5)}` : slugBase;

      const created = await prisma.$transaction(async (tx) => {
        const next = await tx.workspace.create({
          data: {
            slug,
            name: defaultName,
          },
          select: {
            id: true,
            slug: true,
            name: true,
          },
        });

        await tx.workspaceSettings.create({
          data: {
            workspaceId: next.id,
            fallbackOcrEnabled: true,
            fallbackOcrMonthlyBudgetUsd: 5,
            fallbackOcrProvider: 'google_vision',
            fallbackOcrModel: getDefaultFallbackOcrModel('google_vision'),
          },
        });

        return next;
      });

      workspace = created;
      createdWorkspace = true;
    }

    if (!workspace) {
      return fail('INTERNAL_ERROR', 'Failed to bootstrap workspace.', 500);
    }

    const accessToken = createOpaqueToken(32);
    const tokenHash = hashAccessToken(accessToken);

    await prisma.accessLink.create({
      data: {
        workspaceId: workspace.id,
        role: WorkspaceRole.EDITOR,
        label: createdWorkspace ? 'Auto Bootstrap Link' : 'Auto Upload Link',
        tokenHash,
      },
    });

    return ok({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      accessToken,
      createdWorkspace,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
