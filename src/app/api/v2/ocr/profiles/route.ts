import { NextRequest } from 'next/server';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { fail, handleApiError, ok, readJson, requireParam } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import {
  createOrUpdateWorkspaceProfile,
  listWorkspaceRuntimeProfiles,
} from '@/lib/ocr/profile-store';
import { normalizeRuntimeProfile } from '@/lib/ocr/profiles';

const regionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.001).max(1),
  height: z.number().min(0.001).max(1),
});

const calibrationSchema = z.object({
  xOffset: z.number().min(-0.2).max(0.2).default(0),
  yOffset: z.number().min(-0.2).max(0.2).default(0),
  xScale: z.number().min(0.6).max(1.5).default(1),
  yScale: z.number().min(0.6).max(1.5).default(1),
});

const profileUpsertSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().optional(),
  profileKey: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  sourceTemplateId: z.string().max(80).optional().nullable(),
  version: z.number().int().min(1).max(500).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  minWidth: z.number().int().min(100).max(12000).optional().nullable(),
  maxWidth: z.number().int().min(100).max(12000).optional().nullable(),
  minAspectRatio: z.number().min(0.2).max(6).optional().nullable(),
  maxAspectRatio: z.number().min(0.2).max(6).optional().nullable(),
  calibration: calibrationSchema,
  regions: z.record(z.string(), regionSchema),
});

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const profiles = await listWorkspaceRuntimeProfiles(workspaceId);
    return ok(
      profiles.map((profile) => ({
        ...profile,
        selectedByDefault: Boolean(profile.isDefault),
      }))
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = profileUpsertSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const saved = await createOrUpdateWorkspaceProfile({
      workspaceId: body.workspaceId,
      id: body.id,
      profileKey: body.profileKey,
      name: body.name,
      sourceTemplateId: body.sourceTemplateId ?? null,
      minWidth: body.minWidth ?? null,
      maxWidth: body.maxWidth ?? null,
      minAspectRatio: body.minAspectRatio ?? null,
      maxAspectRatio: body.maxAspectRatio ?? null,
      calibration: body.calibration as Prisma.InputJsonValue,
      regions: body.regions as Prisma.InputJsonValue,
      isDefault: body.isDefault,
      isActive: body.isActive,
      version: body.version,
    });

    const normalized = normalizeRuntimeProfile({
      id: saved.id,
      profileKey: saved.profileKey,
      name: saved.name,
      version: saved.version,
      sourceTemplateId: saved.sourceTemplateId,
      minWidth: saved.minWidth,
      maxWidth: saved.maxWidth,
      minAspectRatio: saved.minAspectRatio,
      maxAspectRatio: saved.maxAspectRatio,
      calibration: saved.calibration,
      regions: saved.regions,
      isDefault: saved.isDefault,
    });

    if (!normalized) {
      return fail('INTERNAL_ERROR', 'Saved profile could not be normalized.', 500);
    }

    return ok(normalized, null, body.id ? 200 : 201);
  } catch (error) {
    return handleApiError(error);
  }
}
