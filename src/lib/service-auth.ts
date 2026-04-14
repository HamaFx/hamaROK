import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { ApiHttpError } from '@/lib/api-response';
import { getAppSigningSecret } from '@/lib/env';

const SERVICE_SIGNATURE_TTL_MS = 5 * 60 * 1000;

export function createServiceSignature(payload: string, timestamp: string): string {
  return crypto
    .createHmac('sha256', getAppSigningSecret())
    .update(`${timestamp}.${payload}`)
    .digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function assertValidServiceRequest(request: NextRequest, rawBody: string) {
  const timestamp = request.headers.get('x-service-timestamp')?.trim();
  const signature = request.headers
    .get('x-service-signature')
    ?.replace(/^sha256=/i, '')
    .trim();

  if (!timestamp || !signature) {
    throw new ApiHttpError('UNAUTHORIZED', 'Missing service signature headers.', 401);
  }

  const tsMillis = Number(timestamp);
  if (!Number.isFinite(tsMillis)) {
    throw new ApiHttpError('UNAUTHORIZED', 'Invalid service timestamp header.', 401);
  }

  if (Math.abs(Date.now() - tsMillis) > SERVICE_SIGNATURE_TTL_MS) {
    throw new ApiHttpError('UNAUTHORIZED', 'Service request signature expired.', 401);
  }

  const expected = createServiceSignature(rawBody, timestamp);
  if (!safeEqualHex(expected, signature)) {
    throw new ApiHttpError('UNAUTHORIZED', 'Invalid service signature.', 401);
  }
}
