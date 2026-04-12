import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleApiError, ok } from '@/lib/api-response';

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
        createdAt: true,
        expiresAt: true,
        payload: true,
      },
    });

    if (!report) {
      return fail('NOT_FOUND', 'Rankboard not found.', 404);
    }

    if (report.expiresAt && report.expiresAt <= new Date()) {
      return fail('NOT_FOUND', 'Rankboard has expired.', 404);
    }

    const payload = report.payload as Record<string, unknown> | null;
    if (!payload || payload.kind !== 'rankboard') {
      return fail('NOT_FOUND', 'Rankboard not found.', 404);
    }

    return ok({
      id: report.id,
      workspaceId: report.workspaceId,
      slug: report.shareSlug,
      createdAt: report.createdAt.toISOString(),
      expiresAt: report.expiresAt?.toISOString() ?? null,
      payload,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
