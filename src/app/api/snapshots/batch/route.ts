import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { eventId, snapshots } = body;

    if (!eventId || !Array.isArray(snapshots) || snapshots.length === 0) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'eventId and snapshots array are required' } },
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

    let saved = 0;
    let updated = 0;
    let errors = 0;

    for (const snap of snapshots) {
      try {
        // Upsert governor
        const governor = await prisma.governor.upsert({
          where: { governorId: String(snap.governorId) },
          update: {
            name: String(snap.governorName || snap.name || 'Unknown'),
            alliance: snap.alliance || '',
            ...(workspaceId ? { workspaceId } : {}),
          },
          create: {
            governorId: String(snap.governorId),
            name: String(snap.governorName || snap.name || 'Unknown'),
            alliance: snap.alliance || '',
            workspaceId,
          },
        });

        // Check if snapshot exists
        const existing = await prisma.snapshot.findUnique({
          where: { eventId_governorId: { eventId, governorId: governor.id } },
        });

        // Upsert snapshot
        await prisma.snapshot.upsert({
          where: { eventId_governorId: { eventId, governorId: governor.id } },
          update: {
            power: BigInt(String(snap.power).replace(/[^0-9]/g, '') || '0'),
            killPoints: BigInt(String(snap.killPoints).replace(/[^0-9]/g, '') || '0'),
            t4Kills: BigInt(String(snap.t4Kills).replace(/[^0-9]/g, '') || '0'),
            t5Kills: BigInt(String(snap.t5Kills).replace(/[^0-9]/g, '') || '0'),
            deads: BigInt(String(snap.deads).replace(/[^0-9]/g, '') || '0'),
            workspaceId,
            screenshotUrl: snap.screenshotUrl || null,
            ocrConfidence: snap.ocrConfidence || 0,
            verified: snap.verified ?? true,
          },
          create: {
            eventId,
            governorId: governor.id,
            workspaceId,
            power: BigInt(String(snap.power).replace(/[^0-9]/g, '') || '0'),
            killPoints: BigInt(String(snap.killPoints).replace(/[^0-9]/g, '') || '0'),
            t4Kills: BigInt(String(snap.t4Kills).replace(/[^0-9]/g, '') || '0'),
            t5Kills: BigInt(String(snap.t5Kills).replace(/[^0-9]/g, '') || '0'),
            deads: BigInt(String(snap.deads).replace(/[^0-9]/g, '') || '0'),
            screenshotUrl: snap.screenshotUrl || null,
            ocrConfidence: snap.ocrConfidence || 0,
            verified: snap.verified ?? true,
          },
        });

        if (existing) updated++;
        else saved++;
      } catch (err) {
        console.error('Batch snapshot error for governor:', snap.governorId, err);
        errors++;
      }
    }

    return NextResponse.json({ saved, updated, errors }, { status: 201 });
  } catch (error) {
    console.error('POST /api/snapshots/batch error:', error);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to save batch' } }, { status: 500 });
  }
}
