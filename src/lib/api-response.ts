import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class ApiHttpError extends Error {
  code: ApiErrorCode;
  status: number;
  details?: unknown;
  expose: boolean;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    details?: unknown,
    expose = true
  ) {
    super(message);
    this.name = 'ApiHttpError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.expose = expose;
  }
}

interface ErrorPayload {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

interface MetaPayload {
  total?: number;
  limit?: number;
  offset?: number;
  [key: string]: unknown;
}

function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, item) =>
      typeof item === 'bigint' ? item.toString() : item
    )
  ) as T;
}

export function ok<T>(data: T, meta?: MetaPayload | null, status = 200) {
  return NextResponse.json(
    toJsonSafe({
      data,
      meta: meta ?? null,
      error: null,
    }),
    { status }
  );
}

export function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown
) {
  const payload: ErrorPayload = { code, message };
  if (details !== undefined) payload.details = details;
  return NextResponse.json(
    toJsonSafe({
      data: null,
      meta: null,
      error: payload,
    }),
    { status }
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

function logServerError(error: unknown) {
  if (error instanceof Error) {
    console.error('[api-error]', {
      name: error.name,
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

export function handleApiError(error: unknown) {
  if (error instanceof ZodError) {
    return fail('VALIDATION_ERROR', 'Invalid request payload', 400, error.flatten());
  }

  if (error instanceof ApiHttpError) {
    return fail(
      error.code,
      error.expose ? error.message : 'Request failed.',
      error.status,
      error.details
    );
  }

  logServerError(error);

  if (error instanceof Error && process.env.NODE_ENV !== 'production') {
    return fail('INTERNAL_ERROR', redactErrorForClient(error), 500);
  }

  return fail('INTERNAL_ERROR', 'Internal server error', 500);
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
  return (await request.json()) as T;
}
