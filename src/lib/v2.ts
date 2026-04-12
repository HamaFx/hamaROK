import { NextRequest } from 'next/server';
import { ApiHttpError, parseIntQuery } from '@/lib/api-response';

export function parsePagination(
  request: NextRequest,
  defaults?: { limit?: number; offset?: number }
) {
  const url = new URL(request.url);
  const limit = parseIntQuery(
    url.searchParams.get('limit'),
    defaults?.limit ?? 50,
    1,
    500
  );
  const offset = parseIntQuery(url.searchParams.get('offset'), defaults?.offset ?? 0, 0, 1_000_000);

  return { limit, offset };
}

export function getQueryParam(request: NextRequest, key: string): string | null {
  const value = new URL(request.url).searchParams.get(key);
  return value?.trim() || null;
}

export function parseCommaValues(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseDateQuery(value: string | null, key: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiHttpError('VALIDATION_ERROR', `Invalid ${key} date.`, 400);
  }
  return parsed;
}
