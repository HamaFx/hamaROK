import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { serializeBigInt } from '@/lib/utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    const governorId = searchParams.get('governorId');

    const where: Record<string, unknown> = {};
    if (eventId) where.eventId = eventId;
    if (governorId) where.governorId = governorId;

    const snapshots = await prisma.snapshot.findMany({
      where,
      include: { governor: true, event: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(serializeBigInt({ snapshots }));
  } catch (error) {
    console.error('GET /api/snapshots error:', error);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch snapshots' } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      eventId,
      governorId: govGameId,
      governorName,
      alliance,
      power,
      killPoints,
      t4Kills,
      t5Kills,
      deads,
      screenshotUrl,
      ocrConfidence,
      verified,
    } = body;

    if (!eventId || !govGameId || !governorName) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'eventId, governorId, and governorName are required' } },
        { status: 400 }
      );
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, workspaceId: true },
    });

    if (!event) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Event not found' } },
        { status: 404 }
      );
    }

    const workspaceId = event.workspaceId ?? null;

    // Upsert governor
    const governor = await prisma.governor.upsert({
      where: { governorId: String(govGameId) },
      update: {
        name: String(governorName),
        alliance: alliance || '',
        ...(workspaceId ? { workspaceId } : {}),
      },
      create: {
        governorId: String(govGameId),
        name: String(governorName),
        alliance: alliance || '',
        workspaceId,
      },
    });

    // Upsert snapshot
    const snapshot = await prisma.snapshot.upsert({
      where: { eventId_governorId: { eventId, governorId: governor.id } },
      update: {
        power: BigInt(String(power).replace(/[^0-9]/g, '') || '0'),
        killPoints: BigInt(String(killPoints).replace(/[^0-9]/g, '') || '0'),
        t4Kills: BigInt(String(t4Kills).replace(/[^0-9]/g, '') || '0'),
        t5Kills: BigInt(String(t5Kills).replace(/[^0-9]/g, '') || '0'),
        deads: BigInt(String(deads).replace(/[^0-9]/g, '') || '0'),
        workspaceId,
        screenshotUrl: screenshotUrl || null,
        ocrConfidence: ocrConfidence || 0,
        verified: verified ?? false,
      },
      create: {
        eventId,
        governorId: governor.id,
        workspaceId,
        power: BigInt(String(power).replace(/[^0-9]/g, '') || '0'),
        killPoints: BigInt(String(killPoints).replace(/[^0-9]/g, '') || '0'),
        t4Kills: BigInt(String(t4Kills).replace(/[^0-9]/g, '') || '0'),
        t5Kills: BigInt(String(t5Kills).replace(/[^0-9]/g, '') || '0'),
        deads: BigInt(String(deads).replace(/[^0-9]/g, '') || '0'),
        screenshotUrl: screenshotUrl || null,
        ocrConfidence: ocrConfidence || 0,
        verified: verified ?? false,
      },
    });

    return NextResponse.json(serializeBigInt(snapshot), { status: 201 });
  } catch (error) {
    console.error('POST /api/snapshots error:', error);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to save snapshot' } }, { status: 500 });
  }
}
