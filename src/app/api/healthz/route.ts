import { NextResponse } from 'next/server';
import {
  getAppSigningSecret,
  getEnv,
  getUploadMode,
  validateRuntimeEnv,
} from '@/lib/env';
import { getWeeklySchemaCapability } from '@/lib/weekly-schema-guard';

export const dynamic = 'force-dynamic';

interface ReadinessCheck {
  name: 'env' | 'database' | 'weekly_schema';
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

  let weeklySchema: Awaited<ReturnType<typeof getWeeklySchemaCapability>> | null = null;
  try {
    weeklySchema = await getWeeklySchemaCapability({ forceRefresh: true });
    checks.push({
      name: 'weekly_schema',
      ok: weeklySchema.ok,
      message: weeklySchema.ok ? undefined : weeklySchema.message || 'Weekly schema is incomplete.',
    });
    if (!weeklySchema.ok) {
      ready = false;
    }
  } catch (error) {
    ready = false;
    checks.push({
      name: 'weekly_schema',
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
  if (weeklySchema && !weeklySchema.ok) {
    warnings.push(
      `Weekly schema migration required: ${weeklySchema.missing.join(', ')}.`
    );
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
        weeklySchema: weeklySchema
          ? {
              ok: weeklySchema.ok,
              missing: weeklySchema.missing,
              checkedAt: weeklySchema.checkedAt,
            }
          : null,
      },
      warnings,
    },
    { status: ready ? 200 : 503 }
  );
}
