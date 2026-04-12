import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    let settings = await prisma.kingdomSettings.findUnique({
      where: { id: 'default' },
    });

    if (!settings) {
      settings = await prisma.kingdomSettings.create({
        data: { id: 'default' },
      });
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error('Failed to fetch config:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { t4Weight, t5Weight, deadWeight, kpPerPowerRatio, deadPerPowerRatio, discordWebhook } = body;

    const updated = await prisma.kingdomSettings.upsert({
      where: { id: 'default' },
      update: {
        t4Weight: Number(t4Weight),
        t5Weight: Number(t5Weight),
        deadWeight: Number(deadWeight),
        kpPerPowerRatio: Number(kpPerPowerRatio),
        deadPerPowerRatio: Number(deadPerPowerRatio),
        discordWebhook,
      },
      create: {
        id: 'default',
        t4Weight: Number(t4Weight),
        t5Weight: Number(t5Weight),
        deadWeight: Number(deadWeight),
        kpPerPowerRatio: Number(kpPerPowerRatio),
        deadPerPowerRatio: Number(deadPerPowerRatio),
        discordWebhook,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to update config:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
