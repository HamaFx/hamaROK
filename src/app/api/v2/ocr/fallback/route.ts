import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { runFallbackProvider } from '@/lib/ocr/fallback-provider';

const fallbackSchema = z.object({
  workspaceId: z.string().min(1),
  fieldKey: z.enum([
    'governorId',
    'governorName',
    'power',
    'killPoints',
    't4Kills',
    't5Kills',
    'deads',
  ]),
  croppedImage: z.string().min(10),
  currentValue: z.string().max(120).default(''),
  currentConfidence: z.number().min(0).max(100).default(0),
});

export async function POST(request: NextRequest) {
  try {
    const body = fallbackSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const settings = await prisma.workspaceSettings.findUnique({
      where: { workspaceId: body.workspaceId },
    });

    const result = await runFallbackProvider({
      workspaceId: body.workspaceId,
      settings,
      fieldKey: body.fieldKey,
      croppedImage: body.croppedImage,
      currentValue: body.currentValue,
      currentConfidence: body.currentConfidence,
    });

    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}
