import { NextRequest } from 'next/server';
import { OcrExtractionStatus, WorkspaceRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  ApiHttpError,
  fail,
  handleApiError,
  ok,
  parseSortDirection,
  parseSortQuery,
  requireParam,
} from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { parseCommaValues, parsePagination } from '@/lib/v2';
import {
  inferReviewSeverity,
  parseExtractionValues,
  parseValidation,
} from '@/lib/review-queue';
import { makeServerCacheKey, withServerCache } from '@/lib/server-cache';
import { workspaceCacheTags } from '@/lib/cache-scopes';

type QueueSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

const queueSortFields = ['createdAt', 'confidence'] as const;

function parseStatuses(value: string | null): OcrExtractionStatus[] {
  const statuses = parseCommaValues(value);
  if (statuses.length === 0) {
    return [OcrExtractionStatus.RAW, OcrExtractionStatus.REVIEWED];
  }

  const parsed = statuses
    .map((status) => status.toUpperCase())
    .filter((status): status is OcrExtractionStatus =>
      Object.values(OcrExtractionStatus).includes(status as OcrExtractionStatus)
    );

  if (parsed.length === 0) {
    throw new ApiHttpError('VALIDATION_ERROR', 'Invalid status filter.', 400);
  }

  return parsed;
}

function parseSeverity(value: string | null): QueueSeverity | null {
  if (!value) return null;
  const normalized = value.toUpperCase();
  if (normalized === 'HIGH' || normalized === 'MEDIUM' || normalized === 'LOW') {
    return normalized;
  }
  throw new ApiHttpError('VALIDATION_ERROR', 'Invalid severity filter.', 400);
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const eventId = url.searchParams.get('eventId')?.trim() || null;
    const statuses = parseStatuses(url.searchParams.get('status'));
    const severityFilter = parseSeverity(url.searchParams.get('severity'));
    const sortBy = parseSortQuery(url.searchParams.get('sortBy'), queueSortFields, 'createdAt');
    const sortDir = parseSortDirection(url.searchParams.get('sortDir'));
    const { limit, offset } = parsePagination(request, { limit: 30, offset: 0 });

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const tags = workspaceCacheTags(workspaceId);
    const cached = await withServerCache(
      makeServerCacheKey('api:v2:review-queue', {
        workspaceId,
        eventId,
        statuses: [...statuses].sort(),
        severityFilter,
        sortBy,
        sortDir,
        limit,
        offset,
      }),
      {
        ttlMs: 5_000,
        tags: [tags.all, tags.reviewQueue],
      },
      async () => {
        const candidates = await prisma.ocrExtraction.findMany({
          where: {
            status: { in: statuses },
            scanJob: {
              workspaceId,
              ...(eventId ? { eventId } : {}),
            },
          },
          orderBy: { createdAt: 'desc' },
          take: Math.max(120, limit * 4),
          include: {
            scanJob: {
              select: {
                id: true,
                eventId: true,
                source: true,
                status: true,
              },
            },
            artifact: {
              select: {
                id: true,
                url: true,
                type: true,
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

        const parsedCandidates = candidates.map((item) => ({
          item,
          values: parseExtractionValues({
            fields: item.fields,
            normalized: item.normalized,
            governorIdRaw: item.governorIdRaw,
            governorNameRaw: item.governorNameRaw,
            confidence: item.confidence,
          }),
        }));

        const governorGameIds = new Set<string>();
        for (const candidate of parsedCandidates) {
          const cleanId = candidate.values.governorId.value.replace(/[^0-9]/g, '');
          if (cleanId) governorGameIds.add(cleanId);
        }

        const governors =
          governorGameIds.size > 0
            ? await prisma.governor.findMany({
                where: {
                  workspaceId,
                  governorId: {
                    in: [...governorGameIds],
                  },
                },
                select: {
                  id: true,
                  governorId: true,
                  name: true,
                },
              })
            : [];

        const governorByGameId = new Map(governors.map((gov) => [gov.governorId, gov]));

        const snapshotKeySet = new Set<string>();
        for (const candidate of parsedCandidates) {
          if (!candidate.item.scanJob.eventId) continue;
          const cleanId = candidate.values.governorId.value.replace(/[^0-9]/g, '');
          if (!cleanId) continue;
          const governor = governorByGameId.get(cleanId);
          if (!governor) continue;
          snapshotKeySet.add(`${candidate.item.scanJob.eventId}:${governor.id}`);
        }

        const snapshotLookups = [...snapshotKeySet].map((entry) => {
          const [entryEventId, entryGovernorId] = entry.split(':');
          return {
            eventId: entryEventId,
            governorId: entryGovernorId,
          };
        });

        const snapshots =
          snapshotLookups.length > 0
            ? await prisma.snapshot.findMany({
                where: {
                  OR: snapshotLookups,
                },
                select: {
                  eventId: true,
                  governorId: true,
                  power: true,
                  killPoints: true,
                  t4Kills: true,
                  t5Kills: true,
                  deads: true,
                },
              })
            : [];

        const snapshotByEventGovernor = new Map(
          snapshots.map((snapshot) => [
            `${snapshot.eventId}:${snapshot.governorId}`,
            {
              power: snapshot.power.toString(),
              killPoints: snapshot.killPoints.toString(),
              t4Kills: snapshot.t4Kills.toString(),
              t5Kills: snapshot.t5Kills.toString(),
              deads: snapshot.deads.toString(),
            },
          ])
        );

        const reviewed = parsedCandidates
          .map(({ item, values }) => {
            const validation = parseValidation(item.validation);
            const severity = inferReviewSeverity({
              extractionStatus: item.status,
              lowConfidence: item.lowConfidence,
              failureReasons: item.failureReasons,
              values,
              validation,
            });

            const candidateMap =
              item.candidates && typeof item.candidates === 'object'
                ? (item.candidates as Record<string, unknown>)
                : {};
            const failureReasons = Array.isArray(item.failureReasons)
              ? item.failureReasons.filter((reason): reason is string => typeof reason === 'string')
              : [];

            const gameId = values.governorId.value.replace(/[^0-9]/g, '');
            const governor = governorByGameId.get(gameId);
            const previousSnapshot =
              item.scanJob.eventId && governor
                ? snapshotByEventGovernor.get(`${item.scanJob.eventId}:${governor.id}`)
                : null;

            const withDiff = {
              governorId: {
                ...values.governorId,
                candidates: candidateMap.governorId,
                previousValue: governor?.governorId || null,
                changed:
                  Boolean(governor?.governorId) && governor?.governorId !== values.governorId.value,
              },
              governorName: {
                ...values.governorName,
                candidates: candidateMap.governorName,
                previousValue: governor?.name || null,
                changed: Boolean(governor?.name) && governor?.name !== values.governorName.value,
              },
              power: {
                ...values.power,
                candidates: candidateMap.power,
                previousValue: previousSnapshot?.power || null,
                changed:
                  Boolean(previousSnapshot?.power) && previousSnapshot?.power !== values.power.value,
              },
              killPoints: {
                ...values.killPoints,
                candidates: candidateMap.killPoints,
                previousValue: previousSnapshot?.killPoints || null,
                changed:
                  Boolean(previousSnapshot?.killPoints) &&
                  previousSnapshot?.killPoints !== values.killPoints.value,
              },
              t4Kills: {
                ...values.t4Kills,
                candidates: candidateMap.t4Kills,
                previousValue: previousSnapshot?.t4Kills || null,
                changed:
                  Boolean(previousSnapshot?.t4Kills) && previousSnapshot?.t4Kills !== values.t4Kills.value,
              },
              t5Kills: {
                ...values.t5Kills,
                candidates: candidateMap.t5Kills,
                previousValue: previousSnapshot?.t5Kills || null,
                changed:
                  Boolean(previousSnapshot?.t5Kills) && previousSnapshot?.t5Kills !== values.t5Kills.value,
              },
              deads: {
                ...values.deads,
                candidates: candidateMap.deads,
                previousValue: previousSnapshot?.deads || null,
                changed:
                  Boolean(previousSnapshot?.deads) && previousSnapshot?.deads !== values.deads.value,
              },
            };

            return {
              id: item.id,
              scanJobId: item.scanJobId,
              workspaceId,
              eventId: item.scanJob.eventId,
              scanSource: item.scanJob.source,
              scanStatus: item.scanJob.status,
              provider: item.provider,
              status: item.status,
              confidence: item.confidence,
              lowConfidence: item.lowConfidence,
              severity,
              profile: item.profile,
              profileId: item.profileId,
              engineVersion: item.engineVersion,
              failureReasons,
              preprocessingTrace: item.preprocessingTrace,
              candidates: item.candidates,
              fusionDecision: item.fusionDecision,
              values: withDiff,
              validation,
              artifact: item.artifact,
              createdAt: item.createdAt.toISOString(),
            };
          })
          .filter((entry) => (severityFilter ? entry.severity.level === severityFilter : true));

        reviewed.sort((a, b) => {
          const dir = sortDir === 'asc' ? 1 : -1;
          if (sortBy === 'confidence') {
            return (a.confidence - b.confidence) * dir;
          }
          return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
        });

        const paged = reviewed.slice(offset, offset + limit);

        return {
          rows: paged,
          meta: {
            total: reviewed.length,
            limit,
            offset,
          },
        };
      }
    );

    return ok(cached.rows, cached.meta);
  } catch (error) {
    return handleApiError(error);
  }
}
