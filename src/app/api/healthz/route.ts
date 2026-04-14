import { NextResponse } from 'next/server';
import {
  getAppSigningSecret,
  getEnv,
  getUploadMode,
  validateRuntimeEnv,
} from '@/lib/env';

export const dynamic = 'force-dynamic';

interface ReadinessCheck {
  name: 'env' | 'database';
  ok: boolean;
  message?: string;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

export async function GET() {
  const startedAt = Date.now();
  const checks: ReadinessCheck[] = [];
  let ready = true;

  let env: ReturnType<typeof getEnv> | null = null;
  let uploadMode: 'queue_first' | 'client_legacy' | null = null;

  try {
    env = validateRuntimeEnv();
    getAppSigningSecret();
    uploadMode = getUploadMode();
    checks.push({ name: 'env', ok: true });
  } catch (error) {
    ready = false;
    checks.push({
      name: 'env',
      ok: false,
      message: toErrorMessage(error),
    });
  }

  try {
    const { prisma } = await import('@/lib/prisma');
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: 'database', ok: true });
  } catch (error) {
    ready = false;
    checks.push({
      name: 'database',
      ok: false,
      message: toErrorMessage(error),
    });
  }

  const warnings: string[] = [];
  if (env && !env.BLOB_READ_WRITE_TOKEN) {
    warnings.push('BLOB_READ_WRITE_TOKEN is not configured.');
  }
  if (env?.AWS_OCR_CONTROL_ENABLED && !env.AWS_OCR_START_LAMBDA) {
    warnings.push('AWS_OCR_START_LAMBDA is not configured.');
  }

  return NextResponse.json(
    {
      status: ready ? 'ok' : 'degraded',
      now: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      checks,
      runtime: {
        nodeEnv: process.env.NODE_ENV || 'development',
        uploadMode,
        blobConfigured: Boolean(env?.BLOB_READ_WRITE_TOKEN),
        awsOcr: {
          enabled: Boolean(env?.AWS_OCR_CONTROL_ENABLED),
          region: env?.AWS_REGION || null,
          queueConfigured: Boolean(env?.AWS_OCR_QUEUE_URL),
          startLambdaConfigured: Boolean(env?.AWS_OCR_START_LAMBDA),
          stopLambdaConfigured: Boolean(env?.AWS_OCR_STOP_LAMBDA),
          instanceConfigured: Boolean(env?.AWS_OCR_INSTANCE_ID),
        },
      },
      warnings,
    },
    { status: ready ? 200 : 503 }
  );
}
