import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { serializeBigInt } from '@/lib/utils';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const governor = await prisma.governor.findUnique({
      where: { id },
      include: {
        snapshots: {
          include: { event: true },
          orderBy: { event: { createdAt: 'asc' } },
        },
      },
    });

    if (!governor) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Governor not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json(
      serializeBigInt({
        governor: {
          id: governor.id,
          governorId: governor.governorId,
          name: governor.name,
          alliance: governor.alliance,
        },
        timeline: governor.snapshots.map((s) => ({
          event: { id: s.event.id, name: s.event.name },
          power: s.power.toString(),
          killPoints: s.killPoints.toString(),
          t4Kills: s.t4Kills.toString(),
          t5Kills: s.t5Kills.toString(),
          deads: s.deads.toString(),
          date: s.event.createdAt.toISOString(),
        })),
      })
    );
  } catch (error) {
    console.error('GET /api/governors/[id]/timeline error:', error);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch timeline' } }, { status: 500 });
  }
}
