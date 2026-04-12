import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail, handleApiError } from '@/lib/api-response';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const report = await prisma.reportSnapshot.findUnique({
      where: { shareSlug: slug },
      select: {
        id: true,
        workspaceId: true,
        shareSlug: true,
        payload: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    if (!report) {
      return fail('NOT_FOUND', 'Shared report not found.', 404);
    }

    if (report.expiresAt && report.expiresAt <= new Date()) {
      return fail('NOT_FOUND', 'Shared report has expired.', 404);
    }

    return ok({
      id: report.id,
      workspaceId: report.workspaceId,
      shareSlug: report.shareSlug,
      payload: report.payload,
      createdAt: report.createdAt.toISOString(),
      expiresAt: report.expiresAt?.toISOString() ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
