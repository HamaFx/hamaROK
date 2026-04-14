import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  getTemplateRuntimeProfiles,
  normalizeRuntimeProfile,
  type OcrRuntimeProfile,
} from './profiles';
import { OCR_TEMPLATES } from './templates';

function inferProfileArchetype(args: {
  profileKey: string;
  sourceTemplateId?: string | null;
}): 'governor-profile' | 'rankboard' | null {
  const sourceTemplateId = args.sourceTemplateId || null;
  const profileKey = String(args.profileKey || '').trim();

  const byTemplateId = sourceTemplateId
    ? OCR_TEMPLATES.find((template) => template.id === sourceTemplateId)
    : null;
  if (byTemplateId?.archetype) {
    return byTemplateId.archetype;
  }

  const byProfileKey = OCR_TEMPLATES.find((template) => template.id === profileKey);
  if (byProfileKey?.archetype) {
    return byProfileKey.archetype;
  }

  const normalized = profileKey.toLowerCase();
  if (normalized.includes('rank')) return 'rankboard';
  if (normalized.includes('profile')) return 'governor-profile';
  return null;
}

export async function listWorkspaceRuntimeProfiles(
  workspaceId: string,
  options?: { includeTemplates?: boolean }
): Promise<OcrRuntimeProfile[]> {
  const dbProfiles = await prisma.ocrProfile.findMany({
    where: {
      workspaceId,
      isActive: true,
    },
    orderBy: [{ isDefault: 'desc' }, { profileKey: 'asc' }, { version: 'desc' }],
  });

  const parsed = dbProfiles
    .map((profile) =>
      normalizeRuntimeProfile({
        id: profile.id,
        profileKey: profile.profileKey,
        name: profile.name,
        archetype: inferProfileArchetype({
          profileKey: profile.profileKey,
          sourceTemplateId: profile.sourceTemplateId,
        }),
        version: profile.version,
        sourceTemplateId: profile.sourceTemplateId,
        minWidth: profile.minWidth,
        maxWidth: profile.maxWidth,
        minAspectRatio: profile.minAspectRatio,
        maxAspectRatio: profile.maxAspectRatio,
        calibration: profile.calibration,
        regions: profile.regions,
        isDefault: profile.isDefault,
      })
    )
    .filter((profile): profile is OcrRuntimeProfile => Boolean(profile));

  if (options?.includeTemplates === false) return parsed;

  const existingKeys = new Set(parsed.map((profile) => profile.profileKey));
  const templateProfiles = getTemplateRuntimeProfiles().filter(
    (profile) => !existingKeys.has(profile.profileKey)
  );

  return [...parsed, ...templateProfiles];
}

export async function createOrUpdateWorkspaceProfile(args: {
  workspaceId: string;
  id?: string;
  profileKey: string;
  name: string;
  sourceTemplateId?: string | null;
  minWidth?: number | null;
  maxWidth?: number | null;
  minAspectRatio?: number | null;
  maxAspectRatio?: number | null;
  calibration: Prisma.InputJsonValue;
  regions: Prisma.InputJsonValue;
  isDefault?: boolean;
  isActive?: boolean;
  version?: number;
}) {
  if (args.id) {
    const updated = await prisma.$transaction(async (tx) => {
      if (args.isDefault) {
        await tx.ocrProfile.updateMany({
          where: { workspaceId: args.workspaceId, NOT: { id: args.id } },
          data: { isDefault: false },
        });
      }
      return tx.ocrProfile.update({
        where: { id: args.id },
        data: {
          profileKey: args.profileKey,
          name: args.name,
          sourceTemplateId: args.sourceTemplateId ?? null,
          minWidth: args.minWidth ?? null,
          maxWidth: args.maxWidth ?? null,
          minAspectRatio: args.minAspectRatio ?? null,
          maxAspectRatio: args.maxAspectRatio ?? null,
          calibration: args.calibration,
          regions: args.regions,
          isDefault: args.isDefault ?? undefined,
          isActive: args.isActive ?? undefined,
          version: args.version ?? undefined,
        },
      });
    });
    return updated;
  }

  const latest = await prisma.ocrProfile.findFirst({
    where: { workspaceId: args.workspaceId, profileKey: args.profileKey },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const nextVersion = args.version ?? (latest?.version ?? 0) + 1;

  const created = await prisma.$transaction(async (tx) => {
    if (args.isDefault) {
      await tx.ocrProfile.updateMany({
        where: { workspaceId: args.workspaceId },
        data: { isDefault: false },
      });
    }
    return tx.ocrProfile.create({
      data: {
        workspaceId: args.workspaceId,
        profileKey: args.profileKey,
        name: args.name,
        version: nextVersion,
        sourceTemplateId: args.sourceTemplateId ?? null,
        minWidth: args.minWidth ?? null,
        maxWidth: args.maxWidth ?? null,
        minAspectRatio: args.minAspectRatio ?? null,
        maxAspectRatio: args.maxAspectRatio ?? null,
        calibration: args.calibration,
        regions: args.regions,
        isDefault: args.isDefault ?? false,
        isActive: args.isActive ?? true,
      },
    });
  });

  return created;
}
