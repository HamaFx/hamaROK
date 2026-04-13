import { NextRequest } from 'next/server';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import {
  fail,
  handleApiError,
  ok,
  parseIntQuery,
  readJson,
  requireParam,
} from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';

const expectedSchema = z.object({
  governorId: z.string(),
  governorName: z.string(),
  power: z.string(),
  killPoints: z.string(),
  t4Kills: z.string(),
  t5Kills: z.string(),
  deads: z.string(),
});

const fixtureSchema = z.object({
  workspaceId: z.string().min(1),
  artifactId: z.string().min(1),
  profileId: z.string().optional().nullable(),
  label: z.string().max(120).optional().nullable(),
  expected: expectedSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const limit = parseIntQuery(url.searchParams.get('limit'), 100, 1, 1000);

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const fixtures = await prisma.ocrGoldenFixture.findMany({
      where: { workspaceId },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        artifact: {
          select: {
            id: true,
            url: true,
            type: true,
            createdAt: true,
          },
        },
        profile: {
          select: {
            id: true,
            profileKey: true,
            name: true,
            version: true,
          },
        },
      },
    });

    return ok(
      fixtures.map((fixture) => ({
        id: fixture.id,
        workspaceId: fixture.workspaceId,
        artifactId: fixture.artifactId,
        profileId: fixture.profileId,
        label: fixture.label,
        expected: fixture.expected,
        metadata: fixture.metadata,
        artifact: fixture.artifact,
        profile: fixture.profile,
        createdAt: fixture.createdAt.toISOString(),
        updatedAt: fixture.updatedAt.toISOString(),
      }))
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = fixtureSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const fixture = await prisma.ocrGoldenFixture.upsert({
      where: {
        workspaceId_artifactId: {
          workspaceId: body.workspaceId,
          artifactId: body.artifactId,
        },
      },
      create: {
        workspaceId: body.workspaceId,
        artifactId: body.artifactId,
        profileId: body.profileId ?? null,
        label: body.label ?? null,
        expected: body.expected as unknown as Prisma.InputJsonValue,
        metadata: body.metadata
          ? (body.metadata as Prisma.InputJsonValue)
          : undefined,
      },
      update: {
        profileId: body.profileId ?? null,
        label: body.label ?? null,
        expected: body.expected as unknown as Prisma.InputJsonValue,
        metadata: body.metadata
          ? (body.metadata as Prisma.InputJsonValue)
          : undefined,
      },
    });

    return ok(
      {
        id: fixture.id,
        workspaceId: fixture.workspaceId,
        artifactId: fixture.artifactId,
        profileId: fixture.profileId,
        label: fixture.label,
        expected: fixture.expected,
        metadata: fixture.metadata,
        createdAt: fixture.createdAt.toISOString(),
        updatedAt: fixture.updatedAt.toISOString(),
      },
      null,
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
