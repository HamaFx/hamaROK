import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { normalizeGovernorAlias } from '@/lib/rankings/normalize';

interface RegisterBody {
  workspaceId: string;
  name: string;
  governorId: string;
  alliance?: string;
}

/** Upsert a GovernorAlias for name-based matching during leaderboard ingestion. */
async function upsertAlias(
  workspaceId: string,
  governorDbId: string,
  rawName: string,
  source: string
) {
  const aliasNormalized = normalizeGovernorAlias(rawName);
  if (!aliasNormalized) return;

  await prisma.governorAlias.upsert({
    where: {
      workspaceId_aliasNormalized: {
        workspaceId,
        aliasNormalized,
      },
    },
    create: {
      workspaceId,
      governorId: governorDbId,
      aliasRaw: rawName,
      aliasNormalized,
      confidence: 1.0,
      source,
    },
    update: {
      governorId: governorDbId,
      aliasRaw: rawName,
      confidence: 1.0,
      source,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJson<RegisterBody>(request);

    if (!body.workspaceId) {
      return fail('VALIDATION_ERROR', 'workspaceId is required.', 400);
    }
    if (!body.name?.trim()) {
      return fail('VALIDATION_ERROR', 'name is required.', 400);
    }
    if (!body.governorId?.trim()) {
      return fail('VALIDATION_ERROR', 'governorId is required.', 400);
    }

    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const name = body.name.trim();
    const governorId = body.governorId.trim();
    const alliance = body.alliance?.trim() || '';

    // Check for existing governor by game ID
    const existing = await prisma.governor.findUnique({
      where: { governorId },
      select: {
        id: true,
        name: true,
        governorId: true,
        alliance: true,
        workspaceId: true,
      },
    });

    if (existing) {
      // Reject if already owned by a different workspace
      if (existing.workspaceId && existing.workspaceId !== body.workspaceId) {
        return fail(
          'CONFLICT',
          `Governor ${governorId} is already registered in another workspace.`,
          409
        );
      }

      const updated = await prisma.governor.update({
        where: { id: existing.id },
        data: {
          name,
          alliance,
          workspaceId: body.workspaceId,
        },
        select: {
          id: true,
          governorId: true,
          name: true,
          alliance: true,
          workspaceId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await upsertAlias(body.workspaceId, updated.id, name, 'registration');

      return ok(
        {
          ...updated,
          registered: false,
          message: 'Governor already existed; updated.',
        },
        null,
        200
      );
    }

    // Create new governor
    const governor = await prisma.governor.create({
      data: {
        governorId,
        name,
        alliance,
        workspaceId: body.workspaceId,
      },
      select: {
        id: true,
        governorId: true,
        name: true,
        alliance: true,
        workspaceId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await upsertAlias(body.workspaceId, governor.id, name, 'registration');

    return ok(
      {
        ...governor,
        registered: true,
        message: 'Governor registered successfully.',
      },
      null,
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
