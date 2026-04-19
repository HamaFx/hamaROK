import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { registerGovernorTx } from '@/lib/domain/workspace-actions';

interface RegisterBody {
  workspaceId: string;
  name: string;
  governorId: string;
  alliance?: string;
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

    const result = await prisma.$transaction((tx) =>
      registerGovernorTx(tx, {
        workspaceId: body.workspaceId,
        governorId: body.governorId,
        name: body.name,
        alliance: body.alliance,
      })
    );

    return ok(
      {
        ...result.governor,
        registered: result.created,
        message: result.created
          ? 'Governor registered successfully.'
          : 'Governor already existed; updated.',
      },
      null,
      result.created ? 201 : 200
    );
  } catch (error) {
    return handleApiError(error);
  }
}
