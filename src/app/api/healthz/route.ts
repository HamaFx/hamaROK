import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getEnv } from '@/lib/env';

export async function GET() {
  const startedAt = Date.now();

  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const env = getEnv();
  const awsConfigured = Boolean(
    env.AWS_OCR_CONTROL_ENABLED &&
      env.AWS_REGION &&
      env.AWS_OCR_QUEUE_URL &&
      env.AWS_OCR_START_LAMBDA
  );

  const status = dbOk ? 200 : 503;
  return NextResponse.json(
    {
      ok: dbOk,
      db: dbOk ? 'up' : 'down',
      awsOcrControl: awsConfigured ? 'configured' : 'not-configured',
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    },
    { status }
  );
}
