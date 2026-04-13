import { NextRequest } from 'next/server';
import { OcrExtractionStatus, WorkspaceRole } from '@prisma/client';
import {
  fail,
  handleApiError,
  ok,
  parseIntQuery,
  requireParam,
} from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = requireParam(url.searchParams.get('workspaceId'), 'workspaceId');
    const days = parseIntQuery(url.searchParams.get('days'), 30, 1, 180);

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const extractions = await prisma.ocrExtraction.findMany({
      where: {
        scanJob: { workspaceId },
        createdAt: { gte: since },
      },
      select: {
        id: true,
        status: true,
        lowConfidence: true,
        profileId: true,
        createdAt: true,
      },
    });

    const total = extractions.length;
    const lowConfidence = extractions.filter((entry) => entry.lowConfidence).length;
    const approved = extractions.filter(
      (entry) => entry.status === OcrExtractionStatus.APPROVED
    ).length;
    const rejected = extractions.filter(
      (entry) => entry.status === OcrExtractionStatus.REJECTED
    ).length;
    const reviewed = extractions.filter((entry) =>
      entry.status === OcrExtractionStatus.REVIEWED ||
      entry.status === OcrExtractionStatus.APPROVED ||
      entry.status === OcrExtractionStatus.REJECTED
    ).length;

    const corrections = await prisma.ocrCorrectionLog.findMany({
      where: {
        workspaceId,
        createdAt: { gte: since },
      },
      select: {
        fieldName: true,
        extractionId: true,
        reasonCode: true,
      },
    });

    const correctionByField = corrections.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.fieldName] = (acc[entry.fieldName] || 0) + 1;
      return acc;
    }, {});

    const correctionTaxonomy = corrections.reduce<Record<string, number>>((acc, entry) => {
      const key = entry.reasonCode || 'unspecified';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const profileTotals = extractions.reduce<
      Record<string, { total: number; lowConfidence: number }>
    >((acc, entry) => {
      const key = entry.profileId || 'unassigned';
      if (!acc[key]) acc[key] = { total: 0, lowConfidence: 0 };
      acc[key].total += 1;
      if (entry.lowConfidence) acc[key].lowConfidence += 1;
      return acc;
    }, {});

    return ok({
      window: {
        days,
        since: since.toISOString(),
      },
      counts: {
        total,
        reviewed,
        approved,
        rejected,
        lowConfidence,
        correctedFields: corrections.length,
        correctedExtractions: new Set(corrections.map((entry) => entry.extractionId)).size,
      },
      rates: {
        reviewPassRate: total > 0 ? approved / total : 0,
        lowConfidenceRate: total > 0 ? lowConfidence / total : 0,
        reviewerEditRate: total > 0 ? corrections.length / total : 0,
      },
      correctionByField,
      correctionTaxonomy,
      profileBreakdown: Object.entries(profileTotals).map(([profileId, stats]) => ({
        profileId,
        total: stats.total,
        lowConfidence: stats.lowConfidence,
        lowConfidenceRate: stats.total > 0 ? stats.lowConfidence / stats.total : 0,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
