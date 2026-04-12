import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';


export async function GET() {
  try {
    const events = await prisma.event.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { snapshots: true } } },
    });

    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        eventType: e.eventType,
        snapshotCount: e._count.snapshots,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('GET /api/events error:', error);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch events' } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, eventType, workspaceId } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Event name is required', field: 'name' } },
        { status: 400 }
      );
    }

    const event = await prisma.event.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        eventType: eventType || 'CUSTOM',
        workspaceId: workspaceId || null,
      },
    });

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    console.error('POST /api/events error:', error);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create event' } }, { status: 500 });
  }
}
