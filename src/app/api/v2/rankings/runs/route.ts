import { NextRequest } from 'next/server';
import {
  ArtifactType,
  IngestionDomain,
  Prisma,
  RankingRunStatus,
  ScanJobSource,
  WorkspaceRole,
} from '@prisma/client';
import { z } from 'zod';
import {
  ApiHttpError,
  fail,
  handleApiError,
  ok,
  readJson,
  requireParam,
} from '@/lib/api-response';
import { parsePagination } from '@/lib/v2';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { prisma } from '@/lib/prisma';
import {
  createRankingRunWithRows,
  listRankingRuns,
  type RankingRowInput,
} from '@/lib/rankings/service';
import { dispatchOcrWork } from '@/lib/aws/ocr-dispatch';

const rowSchema = z.object({
  sourceRank: z.number().int().min(1).max(5000).optional().nullable(),
  governorNameRaw: z.string().min(1).max(80),
  allianceRaw: z.string().max(80).optional().nullable(),
  titleRaw: z.string().max(80).optional().nullable(),
  metricRaw: z.string().min(1).max(80),
  metricValue: z.union([z.string(), z.number(), z.bigint()]).optional().nullable(),
  confidence: z.number().min(0).max(100).optional(),
  ocrTrace: z.unknown().optional(),
  candidates: z.unknown().optional(),
});

const createSchema = z.object({
  workspaceId: z.string().min(1),
  eventId: z.string().optional().nullable(),
  source: z.nativeEnum(ScanJobSource).optional(),
  domain: z.nativeEnum(IngestionDomain).optional(),
  rankingType: z.string().min(1).max(80),
  metricKey: z.string().min(1).max(80),
  headerText: z.string().max(120).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
  artifactUrl: z.string().url().optional().nullable(),
  artifactType: z.nativeEnum(ArtifactType).optional(),
  captureFingerprint: z.string().max(140).optional().nullable(),
  rows: z.array(rowSchema).min(1).max(1000),
});

function parseStatus(value: string | null): RankingRunStatus | null {
  if (!value) return null;
  if (!Object.values(RankingRunStatus).includes(value as RankingRunStatus)) {
    throw new ApiHttpError('VALIDATION_ERROR', 'Invalid ranking run status filter.', 400);
  }
  return value as RankingRunStatus;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const eventId = url.searchParams.get('eventId')?.trim() || null;
    const rankingType = url.searchParams.get('rankingType')?.trim() || null;
    const status = parseStatus(url.searchParams.get('status'));
    const { limit, offset } = parsePagination(request, { limit: 30, offset: 0 });

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const runs = await listRankingRuns({
      workspaceId,
      eventId,
      rankingType,
      status,
      limit,
      offset,
    });

    return ok(runs.rows, {
      total: runs.total,
      limit,
      offset,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createSchema.parse(await readJson(request));

    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const artifactId = body.artifactUrl
      ? (
          await prisma.artifact.create({
            data: {
              workspaceId: body.workspaceId,
              type: body.artifactType || ArtifactType.SCREENSHOT,
              url: body.artifactUrl,
            },
            select: {
              id: true,
            },
          })
        ).id
      : null;

    const created = await createRankingRunWithRows({
      workspaceId: body.workspaceId,
      eventId: body.eventId,
      source: body.source,
      domain: body.domain,
      rankingType: body.rankingType,
      metricKey: body.metricKey,
      headerText: body.headerText,
      notes: body.notes,
      metadata: body.metadata as Prisma.InputJsonValue | undefined,
      idempotencyKey: body.idempotencyKey,
      artifactId,
      createdByLinkId: auth.link.id,
      captureFingerprint: body.captureFingerprint,
      rows: body.rows as RankingRowInput[],
    });

    if (!created.idempotentReplay) {
      await dispatchOcrWork({
        type: 'ranking_run_created',
        workspaceId: body.workspaceId,
        eventId: body.eventId,
        rankingRunId: created.id,
        source: body.source,
        payload: {
          rankingType: body.rankingType,
          metricKey: body.metricKey,
          rowCount: body.rows.length,
        },
      });
    }

    return ok(
      created,
      created.idempotentReplay ? { idempotentReplay: true } : null,
      created.idempotentReplay ? 200 : 201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
