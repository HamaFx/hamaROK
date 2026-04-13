import { z } from 'zod';

const booleanString = z
  .string()
  .optional()
  .transform((v) => {
    if (v == null || v === '') return undefined;
    return v === 'true';
  });

const intString = z
  .string()
  .optional()
  .transform((v) => {
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : undefined;
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    POSTGRES_PRISMA_URL: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    POSTGRES_URL_NON_POOLING: z.string().optional(),
    BLOB_READ_WRITE_TOKEN: z.string().optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    APP_SIGNING_SECRET: z.string().min(16).optional(),
    OPENAI_API_KEY: z.string().optional(),
    GOOGLE_VISION_API_KEY: z.string().optional(),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
    GOOGLE_VISION_SERVICE_ACCOUNT_JSON: z.string().optional(),
    AWS_REGION: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_OCR_CONTROL_ENABLED: booleanString,
    AWS_OCR_QUEUE_URL: z.string().url().optional(),
    AWS_OCR_START_LAMBDA: z.string().optional(),
    OCR_FALLBACK_ENABLED: booleanString,
    OCR_FALLBACK_DAILY_LIMIT: intString,
    FEATURE_ADB_CAPTURE_RND: booleanString,
    FEATURE_METRICS_LOGGING: booleanString,
    REQUIRE_BLOB_UPLOAD: booleanString,
  })
  .superRefine((value, ctx) => {
    if (value.OCR_FALLBACK_DAILY_LIMIT != null && value.OCR_FALLBACK_DAILY_LIMIT < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'OCR_FALLBACK_DAILY_LIMIT must be at least 1.',
      });
    }

    if (value.AWS_OCR_CONTROL_ENABLED) {
      if (!value.AWS_OCR_QUEUE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'AWS_OCR_QUEUE_URL is required when AWS_OCR_CONTROL_ENABLED=true.',
        });
      }
      if (!value.AWS_REGION) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'AWS_REGION is required when AWS_OCR_CONTROL_ENABLED=true.',
        });
      }
    }
  });

type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;
let runtimeValidated = false;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;
  cachedEnv = envSchema.parse(process.env);
  return cachedEnv;
}

export function validateRuntimeEnv(options?: {
  requireBlob?: boolean;
  allowInTest?: boolean;
}) {
  const env = getEnv();

  if (options?.allowInTest && env.NODE_ENV === 'test') {
    return env;
  }

  if ((options?.requireBlob || env.REQUIRE_BLOB_UPLOAD) && !env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN is required but not configured.');
  }

  return env;
}

export function ensureRuntimeReady() {
  if (runtimeValidated) return;
  validateRuntimeEnv();
  getDatabaseUrl();
  runtimeValidated = true;
}

export function getDatabaseUrl(): string {
  const env = getEnv();
  const url = env.POSTGRES_PRISMA_URL || env.DATABASE_URL;
  if (!url) {
    throw new Error('Missing database URL. Set POSTGRES_PRISMA_URL or DATABASE_URL.');
  }
  return url;
}

export function getAppSigningSecret(): string {
  const env = getEnv();
  if (env.APP_SIGNING_SECRET) return env.APP_SIGNING_SECRET;
  if (env.NODE_ENV === 'production') {
    throw new Error('Missing APP_SIGNING_SECRET in production.');
  }
  return 'development-only-insecure-secret-change-me';
}

export function assertBlobConfigured(): void {
  const env = getEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not configured.');
  }
}

export function isFallbackOcrEnabled(): boolean {
  return getEnv().OCR_FALLBACK_ENABLED ?? false;
}

export function getFallbackOcrDailyLimit(): number {
  return getEnv().OCR_FALLBACK_DAILY_LIMIT ?? 50;
}

export function isAdbCaptureRndEnabled(): boolean {
  return getEnv().FEATURE_ADB_CAPTURE_RND ?? false;
}

export function isMetricsLoggingEnabled(): boolean {
  const env = getEnv();
  if (env.FEATURE_METRICS_LOGGING != null) {
    return env.FEATURE_METRICS_LOGGING;
  }
  return env.NODE_ENV !== 'production';
}

export function isAwsOcrControlEnabled(): boolean {
  return getEnv().AWS_OCR_CONTROL_ENABLED ?? false;
}
