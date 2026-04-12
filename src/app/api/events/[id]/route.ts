import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { serializeBigInt } from '@/lib/utils';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        snapshots: {
          include: { governor: true },
          orderBy: { governor: { name: 'asc' } },
        },
        _count: { select: { snapshots: true } },
      },
    });

    if (!event) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Event not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json(serializeBigInt(event));
  } catch (error) {
    console.error('GET /api/events/[id] error:', error);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch event' } }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.event.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('DELETE /api/events/[id] error:', error);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete event' } }, { status: 500 });
  }
}
