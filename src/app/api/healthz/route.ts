import { NextResponse } from 'next/server';
import {
  getAppSigningSecret,
  getEnv,
  getUploadMode,
  validateRuntimeEnv,
} from '@/lib/env';
import { resolveOcrEnginePolicy } from '@/lib/ocr/engine-policy';
import { getWeeklySchemaCapability } from '@/lib/weekly-schema-guard';
import { getBlobRetentionDefaults } from '@/lib/blob-retention';

export const dynamic = 'force-dynamic';

interface ReadinessCheck {
  name: 'env' | 'database' | 'weekly_schema' | 'mistral' | 'embedding';
  ok: boolean;
  message?: string;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

function buildRequestId(): string {
  const globalCrypto = globalThis.crypto as Crypto | undefined;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function GET() {
  const startedAt = Date.now();
  const requestId = buildRequestId();
  const checks: ReadinessCheck[] = [];
  let ready = true;

  let env: ReturnType<typeof getEnv> | null = null;
  let uploadMode: 'queue_first' | 'client_legacy' | null = null;
  let ocrPolicy:
    | ReturnType<typeof resolveOcrEnginePolicy>
    | null = null;
  let embeddingInstalled: boolean | null = null;
  let embeddingConfigValid: boolean | null = null;
  let embeddingInvalidWorkspaceCount = 0;
  const blobRetention = getBlobRetentionDefaults();

  try {
    env = validateRuntimeEnv();
    getAppSigningSecret();
    uploadMode = getUploadMode();
    ocrPolicy = resolveOcrEnginePolicy({
      envRequested: env.OCR_ENGINE,
      allowLegacy: env.ALLOW_LEGACY_OCR,
    });
    checks.push({ name: 'env', ok: true });
  } catch (error) {
    ready = false;
    checks.push({
      name: 'env',
      ok: false,
      message: toErrorMessage(error),
    });
  }

  if (env && ocrPolicy?.effective === 'mistral') {
    const hasApiKey = Boolean(env.MISTRAL_API_KEY);
    checks.push({
      name: 'mistral',
      ok: hasApiKey,
      message: hasApiKey ? undefined : 'MISTRAL_API_KEY is missing while OCR_ENGINE=mistral.',
    });
    if (!hasApiKey) {
      ready = false;
    }
  } else {
    checks.push({
      name: 'mistral',
      ok: true,
      message: ocrPolicy?.effective === 'legacy' ? 'Legacy OCR engine active.' : undefined,
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

  try {
    const { prisma } = await import('@/lib/prisma');
    const [extension] = await prisma.$queryRaw<Array<{ installed: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_extension
        WHERE extname = 'vector'
      ) AS installed
    `;
    const installed = Boolean(extension?.installed);
    const hasMistralKey = Boolean(env?.MISTRAL_API_KEY);
    const [configSummary] = await prisma.$queryRaw<Array<{ invalid_count: number }>>`
      SELECT COUNT(*)::int AS invalid_count
      FROM "WorkspaceSettings"
      WHERE "assistantConfig" IS NOT NULL
        AND "assistantConfig"->'embedding'->>'dimension' IS NOT NULL
        AND (
          NOT ("assistantConfig"->'embedding'->>'dimension' ~ '^[0-9]+$')
          OR ("assistantConfig"->'embedding'->>'dimension')::int <> 1024
        )
    `;
    embeddingInvalidWorkspaceCount = Number(configSummary?.invalid_count || 0);
    const configValid = embeddingInvalidWorkspaceCount === 0;
    embeddingConfigValid = configValid;
    const embeddingReady = installed && hasMistralKey && configValid;
    embeddingInstalled = installed;
    checks.push({
      name: 'embedding',
      ok: embeddingReady,
      message: !installed
        ? 'pgvector extension is not installed.'
        : !hasMistralKey
          ? 'MISTRAL_API_KEY is missing for embedding calls.'
          : !configValid
            ? `Embedding config invalid in ${embeddingInvalidWorkspaceCount} workspace(s) (dimension must be 1024).`
            : undefined,
    });
    if (!embeddingReady) {
      ready = false;
    }
  } catch (error) {
    ready = false;
    checks.push({
      name: 'embedding',
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
  if (env && (env.OCR_ENGINE ?? 'mistral') === 'mistral' && !env.MISTRAL_API_KEY) {
    warnings.push('MISTRAL_API_KEY is not configured while OCR_ENGINE=mistral.');
  }
  if (ocrPolicy?.requested === 'legacy' && !ocrPolicy.legacyAllowed) {
    warnings.push('OCR_ENGINE=legacy requested but blocked because ALLOW_LEGACY_OCR is not enabled.');
  }
  if (embeddingConfigValid === false) {
    warnings.push(
      `Embedding configuration invalid for ${embeddingInvalidWorkspaceCount} workspace(s): dimension must stay at 1024.`
    );
  }

  return NextResponse.json(
    {
      status: ready ? 'ok' : 'degraded',
      requestId,
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
        ocr: {
          engine: ocrPolicy?.effective || (env?.OCR_ENGINE ?? 'mistral'),
          requestedEngine: ocrPolicy?.requested || (env?.OCR_ENGINE ?? 'mistral'),
          legacyAllowed: ocrPolicy?.legacyAllowed ?? null,
          locked: ocrPolicy?.locked ?? null,
          reason: ocrPolicy?.reason ?? null,
          mistralConfigured: Boolean(env?.MISTRAL_API_KEY),
          mistralBaseUrl: env?.MISTRAL_BASE_URL || 'https://api.mistral.ai',
        },
        embedding: {
          vectorExtensionInstalled: embeddingInstalled,
          mistralKeyReady: Boolean(env?.MISTRAL_API_KEY),
          configValid: embeddingConfigValid,
          invalidWorkspaceCount: embeddingInvalidWorkspaceCount,
        },
        storage: {
          blobConfigured: Boolean(env?.BLOB_READ_WRITE_TOKEN),
          screenshotRetentionDays: blobRetention.retentionDays,
          assistantRetentionDays: blobRetention.retentionDays,
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
    {
      status: ready ? 200 : 503,
      headers: {
        'X-Request-Id': requestId,
      },
    }
  );
}
