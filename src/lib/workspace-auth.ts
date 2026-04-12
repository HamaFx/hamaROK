import type { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hashAccessToken } from '@/lib/security';

const roleRank: Record<WorkspaceRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
};

export function resolveAccessToken(request: NextRequest): string | null {
  const fromHeader =
    request.headers.get('x-access-token') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (fromHeader) return fromHeader.trim();

  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('accessToken');
  return fromQuery ? fromQuery.trim() : null;
}

export async function authorizeWorkspaceAccess(
  request: NextRequest,
  workspaceId: string,
  requiredRole: WorkspaceRole = WorkspaceRole.VIEWER
) {
  const token = resolveAccessToken(request);
  if (!token) {
    return {
      ok: false as const,
      code: 'UNAUTHORIZED' as const,
      message: 'Missing access token.',
    };
  }

  const tokenHash = hashAccessToken(token);
  const now = new Date();
  const link = await prisma.accessLink.findFirst({
    where: {
      workspaceId,
      tokenHash,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });

  if (!link) {
    return {
      ok: false as const,
      code: 'FORBIDDEN' as const,
      message: 'Invalid or expired access token.',
    };
  }

  if (roleRank[link.role] < roleRank[requiredRole]) {
    return {
      ok: false as const,
      code: 'FORBIDDEN' as const,
      message: `Requires ${requiredRole} access.`,
    };
  }

  await prisma.accessLink.update({
    where: { id: link.id },
    data: { lastUsedAt: now },
  });

  return {
    ok: true as const,
    link,
  };
}
