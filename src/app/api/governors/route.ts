import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { serializeBigInt } from '@/lib/utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const limit = parseInt(searchParams.get('limit') || '200');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { governorId: { contains: search } },
          ],
        }
      : {};

    const [governors, total] = await Promise.all([
      prisma.governor.findMany({
        where,
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
        include: {
          _count: { select: { snapshots: true } },
          snapshots: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { power: true },
          },
        },
      }),
      prisma.governor.count({ where }),
    ]);

    return NextResponse.json(
      serializeBigInt({
        governors: governors.map((g) => ({
          id: g.id,
          governorId: g.governorId,
          name: g.name,
          alliance: g.alliance,
          snapshotCount: g._count.snapshots,
          latestPower: g.snapshots[0]?.power?.toString() || '0',
          createdAt: g.createdAt.toISOString(),
        })),
        total,
      })
    );
  } catch (error) {
    console.error('GET /api/governors error:', error);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch governors' } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { governorId, name, alliance } = body;

    if (!governorId || !name) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'governorId and name are required' } },
        { status: 400 }
      );
    }

    const governor = await prisma.governor.upsert({
      where: { governorId: String(governorId) },
      update: { name: String(name), alliance: alliance || '' },
      create: { governorId: String(governorId), name: String(name), alliance: alliance || '' },
    });

    return NextResponse.json(governor, { status: 201 });
  } catch (error) {
    console.error('POST /api/governors error:', error);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to save governor' } }, { status: 500 });
  }
}
