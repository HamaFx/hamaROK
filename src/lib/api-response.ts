import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { MistralApiError } from '@/lib/mistral/client';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PRECONDITION_FAILED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export type ApiErrorCategory =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'conflict'
  | 'precondition'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'database'
  | 'storage'
  | 'upstream'
  | 'internal';

export type ErrorSource =
  | 'api'
  | 'mistral'
  | 'prisma'
  | 'blob'
  | 'aws'
  | 'idempotency'
  | 'timeout'
  | 'network'
  | 'unknown';

export interface RetryPolicyHint {
  retryable: boolean;
  retryAfterMs?: number | null;
  hints?: string[];
}

export interface ApiErrorDescriptor {
  code: ApiErrorCode;
  httpStatus: number;
  category: ApiErrorCategory;
  retryable: boolean;
  source: ErrorSource;
  retryAfterMs?: number | null;
  hints?: string[];
}

interface ApiErrorMeta extends Partial<ApiErrorDescriptor> {
  requestId?: string;
}

export class ApiHttpError extends Error {
  code: ApiErrorCode;
  status: number;
  details?: unknown;
  expose: boolean;
  meta?: ApiErrorMeta;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    details?: unknown,
    expose = true,
    meta?: ApiErrorMeta
  ) {
    super(message);
    this.name = 'ApiHttpError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.expose = expose;
    this.meta = meta;
  }
}

interface ErrorPayload {
  code: ApiErrorCode;
  message: string;
  category?: ApiErrorCategory;
  retryable?: boolean;
  retryAfterMs?: number | null;
  source?: ErrorSource;
  requestId?: string;
  hints?: string[];
  details?: unknown;
}

interface MetaPayload {
  total?: number;
  limit?: number;
  offset?: number;
  [key: string]: unknown;
}

interface ResponseOptions {
  requestId?: string;
  headers?: Record<string, string>;
}

interface FailOptions extends ResponseOptions {
  category?: ApiErrorCategory;
  retryable?: boolean;
  retryAfterMs?: number | null;
  source?: ErrorSource;
  hints?: string[];
}

const API_ERROR_DEFAULTS: Record<ApiErrorCode, Omit<ApiErrorDescriptor, 'code' | 'httpStatus'>> = {
  VALIDATION_ERROR: {
    category: 'validation',
    retryable: false,
    source: 'api',
  },
  UNAUTHORIZED: {
    category: 'authentication',
    retryable: false,
    source: 'api',
  },
  FORBIDDEN: {
    category: 'authorization',
    retryable: false,
    source: 'api',
  },
  NOT_FOUND: {
    category: 'not_found',
    retryable: false,
    source: 'api',
  },
  CONFLICT: {
    category: 'conflict',
    retryable: false,
    source: 'api',
  },
  PRECONDITION_FAILED: {
    category: 'precondition',
    retryable: false,
    source: 'api',
  },
  RATE_LIMITED: {
    category: 'rate_limit',
    retryable: true,
    source: 'api',
  },
  INTERNAL_ERROR: {
    category: 'internal',
    retryable: false,
    source: 'api',
  },
};

function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, item) =>
      typeof item === 'bigint' ? item.toString() : item
    )
  ) as T;
}

function createRequestId(): string {
  const globalCrypto = globalThis.crypto as Crypto | undefined;
  if (globalCrypto?.randomUUID) {
    return globalCrypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRetryAfterMs(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0) return 0;
  return Math.floor(parsed);
}

function toRetryAfterHeader(retryAfterMs: number | null | undefined): string | null {
  if (!Number.isFinite(Number(retryAfterMs))) return null;
  const ms = Math.max(0, Number(retryAfterMs));
  return String(Math.ceil(ms / 1000));
}

function buildApiErrorDescriptor(
  code: ApiErrorCode,
  status: number,
  overrides?: Partial<ApiErrorDescriptor>
): ApiErrorDescriptor {
  const defaults = API_ERROR_DEFAULTS[code] || API_ERROR_DEFAULTS.INTERNAL_ERROR;
  const normalizedStatus = Number.isFinite(status) ? Math.max(400, Math.min(599, status)) : 500;
  const retryAfterMs = normalizeRetryAfterMs(overrides?.retryAfterMs);
  return {
    code,
    httpStatus: normalizedStatus,
    category: overrides?.category || defaults.category,
    retryable: typeof overrides?.retryable === 'boolean' ? overrides.retryable : defaults.retryable,
    source: overrides?.source || defaults.source,
    retryAfterMs,
    hints: Array.isArray(overrides?.hints)
      ? overrides?.hints
          .map((hint) => String(hint || '').trim())
          .filter(Boolean)
          .slice(0, 5)
      : undefined,
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function isNetworkLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message}`.toLowerCase();
  return (
    text.includes('network') ||
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('enotfound') ||
    text.includes('socket hang up') ||
    text.includes('fetch failed')
  );
}

function mapPrismaError(error: unknown): {
  code: ApiErrorCode;
  message: string;
  status: number;
  details?: unknown;
  descriptor: Partial<ApiErrorDescriptor>;
} | null {
  if (!error || typeof error !== 'object') return null;

  const code = String((error as { code?: unknown }).code || '').trim();
  if (!/^P\d{4}$/.test(code)) return null;
  const details = { prismaCode: code };

  if (code === 'P2002') {
    return {
      code: 'CONFLICT',
      message: 'A unique value already exists.',
      status: 409,
      details,
      descriptor: {
        category: 'conflict',
        source: 'prisma',
        retryable: false,
      },
    };
  }

  if (code === 'P2025') {
    return {
      code: 'NOT_FOUND',
      message: 'Requested record was not found.',
      status: 404,
      details,
      descriptor: {
        category: 'not_found',
        source: 'prisma',
        retryable: false,
      },
    };
  }

  if (code === 'P2003') {
    return {
      code: 'PRECONDITION_FAILED',
      message: 'Request references a record that no longer exists.',
      status: 412,
      details,
      descriptor: {
        category: 'precondition',
        source: 'prisma',
        retryable: false,
      },
    };
  }

  if (code === 'P1001' || code === 'P1002' || code === 'P1017') {
    return {
      code: 'INTERNAL_ERROR',
      message: 'Database is temporarily unavailable.',
      status: 503,
      details,
      descriptor: {
        category: 'database',
        source: 'prisma',
        retryable: true,
        retryAfterMs: 1500,
      },
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'Database operation failed.',
    status: 500,
    details,
    descriptor: {
      category: 'database',
      source: 'prisma',
      retryable: false,
    },
  };
}

function mapMistralError(error: MistralApiError): {
  code: ApiErrorCode;
  message: string;
  status: number;
  details: unknown;
  descriptor: Partial<ApiErrorDescriptor>;
} {
  const status = Number.isFinite(error.status) ? Math.max(400, Math.min(599, error.status)) : 502;
  const details = {
    provider: 'mistral',
    mistralCode: error.code || null,
    retryAfterMs: error.retryAfterMs ?? null,
    details: error.details ?? null,
  };

  if (status === 429) {
    return {
      code: 'RATE_LIMITED',
      message: redactErrorForClient(error) || 'Mistral rate limit reached.',
      status: 429,
      details,
      descriptor: {
        category: 'rate_limit',
        source: 'mistral',
        retryable: true,
        retryAfterMs: error.retryAfterMs ?? 1500,
        hints: ['Retry with backoff and jitter.', 'Reduce parallel image/model requests.'],
      },
    };
  }

  if (status >= 500) {
    return {
      code: 'INTERNAL_ERROR',
      message: 'Upstream model provider is temporarily unavailable.',
      status: 503,
      details,
      descriptor: {
        category: error.code === 'REQUEST_TIMEOUT' || error.code === 'BATCH_TIMEOUT' ? 'timeout' : 'upstream',
        source:
          error.code === 'NETWORK_ERROR'
            ? 'network'
            : error.code === 'REQUEST_TIMEOUT' || error.code === 'BATCH_TIMEOUT'
              ? 'timeout'
              : 'mistral',
        retryable: true,
        retryAfterMs: error.retryAfterMs ?? 1500,
        hints: ['Retry the same request key.', 'Preserve idempotency keys on retries.'],
      },
    };
  }

  if (status >= 400 && status < 500) {
    return {
      code: 'VALIDATION_ERROR',
      message: redactErrorForClient(error) || 'Invalid request for Mistral provider.',
      status: 400,
      details,
      descriptor: {
        category: 'validation',
        source: 'mistral',
        retryable: false,
      },
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'Mistral request failed.',
    status: 502,
    details,
    descriptor: {
      category: 'upstream',
      source: 'mistral',
      retryable: true,
      retryAfterMs: error.retryAfterMs ?? 1500,
    },
  };
}

export function ok<T>(data: T, meta?: MetaPayload | null, status = 200, options?: ResponseOptions) {
  const requestId = options?.requestId || createRequestId();
  const headers = new Headers(options?.headers);
  headers.set('X-Request-Id', requestId);
  return NextResponse.json(
    toJsonSafe({
      data,
      meta: meta ?? null,
      error: null,
    }),
    { status, headers }
  );
}

export function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
  options?: FailOptions
) {
  const requestId = options?.requestId || createRequestId();
  const descriptor = buildApiErrorDescriptor(code, status, options);
  const payload: ErrorPayload = {
    code,
    message,
    category: descriptor.category,
    retryable: descriptor.retryable,
    retryAfterMs: descriptor.retryAfterMs ?? undefined,
    source: descriptor.source,
    requestId,
    hints: descriptor.hints,
  };
  if (details !== undefined) payload.details = details;
  const headers = new Headers(options?.headers);
  headers.set('X-Request-Id', requestId);
  const retryAfterHeader = toRetryAfterHeader(descriptor.retryAfterMs);
  if (retryAfterHeader && descriptor.retryable) {
    headers.set('Retry-After', retryAfterHeader);
  }
  return NextResponse.json(
    toJsonSafe({
      data: null,
      meta: null,
      error: payload,
    }),
    { status: descriptor.httpStatus, headers }
  );
}

function redactErrorForClient(error: Error): string {
  const unsafePatterns = [
    /postgres(?:ql)?:\/\/[^\s]+/i,
    /vercel_blob_rw_[A-Za-z0-9_]+/i,
    /https:\/\/discord\.com\/api\/webhooks\/[A-Za-z0-9/_-]+/i,
    /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  ];
  const text = error.message || 'Unhandled server error';
  if (unsafePatterns.some((pattern) => pattern.test(text))) {
    return 'Unhandled server error';
  }
  return text;
}

function logServerError(error: unknown, descriptor?: ApiErrorDescriptor, requestId?: string) {
  if (error instanceof Error) {
    console.error('[api-error]', {
      requestId: requestId || null,
      name: error.name,
      code: descriptor?.code || null,
      category: descriptor?.category || null,
      source: descriptor?.source || null,
      message: redactErrorForClient(error),
      stack:
        process.env.NODE_ENV === 'production'
          ? undefined
          : error.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return;
  }
  console.error('[api-error]', { message: 'Non-error thrown value' });
}

function isSchemaPreconditionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && code === 'P2022') return true;
  const message = error instanceof Error ? error.message : String(error);
  return (
    /column .* does not exist/i.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /type .* does not exist/i.test(message) ||
    /invalid input value for enum/i.test(message)
  );
}

export function handleApiError(error: unknown) {
  const requestId = createRequestId();
  if (error instanceof ZodError) {
    return fail('VALIDATION_ERROR', 'Invalid request payload', 400, error.flatten(), {
      requestId,
      category: 'validation',
      retryable: false,
      source: 'api',
    });
  }

  if (error instanceof ApiHttpError) {
    const descriptor = buildApiErrorDescriptor(error.code, error.status, error.meta);
    return fail(
      descriptor.code,
      error.expose ? error.message : 'Request failed.',
      descriptor.httpStatus,
      error.details,
      {
        requestId: error.meta?.requestId || requestId,
        category: descriptor.category,
        retryable: descriptor.retryable,
        retryAfterMs: descriptor.retryAfterMs,
        source: descriptor.source,
        hints: descriptor.hints,
      }
    );
  }

  if (error instanceof MistralApiError) {
    const mapped = mapMistralError(error);
    return fail(mapped.code, mapped.message, mapped.status, mapped.details, {
      requestId,
      category: mapped.descriptor.category,
      retryable: mapped.descriptor.retryable,
      retryAfterMs: mapped.descriptor.retryAfterMs,
      source: mapped.descriptor.source,
      hints: mapped.descriptor.hints,
    });
  }

  const prismaMapped = mapPrismaError(error);
  if (prismaMapped) {
    return fail(prismaMapped.code, prismaMapped.message, prismaMapped.status, prismaMapped.details, {
      requestId,
      category: prismaMapped.descriptor.category,
      retryable: prismaMapped.descriptor.retryable,
      retryAfterMs: prismaMapped.descriptor.retryAfterMs,
      source: prismaMapped.descriptor.source,
      hints: prismaMapped.descriptor.hints,
    });
  }

  if (isSchemaPreconditionError(error)) {
    return fail(
      'PRECONDITION_FAILED',
      'Required database schema updates are missing. Apply latest migrations and redeploy.',
      412,
      undefined,
      {
        requestId,
        category: 'precondition',
        retryable: false,
        source: 'prisma',
        hints: ['Run `prisma migrate deploy` and redeploy.'],
      }
    );
  }

  if (isAbortError(error)) {
    return fail('INTERNAL_ERROR', 'Request timed out.', 504, undefined, {
      requestId,
      category: 'timeout',
      retryable: true,
      retryAfterMs: 1000,
      source: 'timeout',
      hints: ['Retry with same idempotency key.'],
    });
  }

  if (isNetworkLikeError(error)) {
    return fail('INTERNAL_ERROR', 'Network request failed.', 503, undefined, {
      requestId,
      category: 'network',
      retryable: true,
      retryAfterMs: 1000,
      source: 'network',
      hints: ['Retry with backoff and jitter.'],
    });
  }

  const fallbackDescriptor = buildApiErrorDescriptor('INTERNAL_ERROR', 500, {
    category: 'internal',
    source: 'unknown',
    retryable: false,
  });
  logServerError(error, fallbackDescriptor, requestId);

  if (error instanceof Error && process.env.NODE_ENV !== 'production') {
    return fail('INTERNAL_ERROR', redactErrorForClient(error), 500, undefined, {
      requestId,
      category: 'internal',
      retryable: false,
      source: 'unknown',
    });
  }

  return fail('INTERNAL_ERROR', 'Internal server error', 500, undefined, {
    requestId,
    category: 'internal',
    retryable: false,
    source: 'unknown',
  });
}

export function requireParam(
  value: string | null | undefined,
  name: string
): string {
  if (!value || value.trim().length === 0) {
    throw new ApiHttpError('VALIDATION_ERROR', `${name} is required.`, 400);
  }
  return value.trim();
}

export function ensure(
  condition: boolean,
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown
) {
  if (!condition) {
    throw new ApiHttpError(code, message, status, details);
  }
}

export function notFound(message = 'Not found') {
  throw new ApiHttpError('NOT_FOUND', message, 404);
}

export function conflict(message = 'Conflict') {
  throw new ApiHttpError('CONFLICT', message, 409);
}

export function rateLimited(message = 'Rate limited', details?: unknown) {
  throw new ApiHttpError('RATE_LIMITED', message, 429, details);
}

export function parseIntQuery(
  value: string | null,
  fallback: number,
  min = 0,
  max = 500
) {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new ApiHttpError('VALIDATION_ERROR', 'Invalid integer query param.', 400);
  }
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function parseBooleanQuery(value: string | null, fallback = false): boolean {
  if (value == null) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ApiHttpError('VALIDATION_ERROR', 'Invalid boolean query param.', 400);
}

export function parseSortQuery<T extends string>(
  value: string | null,
  whitelist: readonly T[],
  fallback: T
): T {
  if (!value) return fallback;
  if (!whitelist.includes(value as T)) {
    throw new ApiHttpError(
      'VALIDATION_ERROR',
      `Invalid sort field. Allowed: ${whitelist.join(', ')}`,
      400
    );
  }
  return value as T;
}

export function parseSortDirection(value: string | null): 'asc' | 'desc' {
  if (!value) return 'desc';
  if (value !== 'asc' && value !== 'desc') {
    throw new ApiHttpError('VALIDATION_ERROR', 'Invalid sort direction.', 400);
  }
  return value;
}

export function withApiTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  return fn().finally(() => {
    const durationMs = Date.now() - started;
    const slowThresholdMs = 1500;
    if (durationMs >= slowThresholdMs) {
      console.warn('[api-slow]', { label, durationMs });
    }
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && /json|unexpected end of input/i.test(error.message))
    ) {
      throw new ApiHttpError('VALIDATION_ERROR', 'Invalid JSON payload.', 400);
    }
    throw error;
  }
}
