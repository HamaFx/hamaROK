import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, handleApiError, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { createOpaqueToken, hashAccessToken } from '@/lib/security';

const createLinkSchema = z.object({
  role: z.nativeEnum(WorkspaceRole).default(WorkspaceRole.VIEWER),
  label: z.string().max(80).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params;
    const auth = await authorizeWorkspaceAccess(
      request,
      workspaceId,
      WorkspaceRole.OWNER
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const links = await prisma.accessLink.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        role: true,
        label: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
    });

    return ok(
      links.map((link) => ({
        ...link,
        createdAt: link.createdAt.toISOString(),
        expiresAt: link.expiresAt?.toISOString() ?? null,
        revokedAt: link.revokedAt?.toISOString() ?? null,
        lastUsedAt: link.lastUsedAt?.toISOString() ?? null,
      }))
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params;
    const auth = await authorizeWorkspaceAccess(
      request,
      workspaceId,
      WorkspaceRole.OWNER
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const body = createLinkSchema.parse(await readJson(request));
    const token = createOpaqueToken(32);
    const tokenHash = hashAccessToken(token);
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const link = await prisma.accessLink.create({
      data: {
        workspaceId,
        role: body.role,
        label: body.label?.trim() || null,
        tokenHash,
        expiresAt,
      },
    });

    return ok(
      {
        id: link.id,
        role: link.role,
        label: link.label,
        createdAt: link.createdAt.toISOString(),
        expiresAt: link.expiresAt?.toISOString() ?? null,
        accessToken: token,
      },
      null,
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
