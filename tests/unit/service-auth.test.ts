import { describe, expect, it } from 'vitest';
import { ApiHttpError } from '@/lib/api-response';
import { assertValidServiceRequest, createServiceSignature } from '@/lib/service-auth';

function buildMockRequest(headers: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => {
        const value = headers[key.toLowerCase()];
        return value ?? null;
      },
    },
  };
}

describe('service-auth', () => {
  it('accepts valid service signature', () => {
    const payload = JSON.stringify({ hello: 'world' });
    const timestamp = String(Date.now());
    const signature = createServiceSignature(payload, timestamp);

    expect(() =>
      assertValidServiceRequest(
        buildMockRequest({
          'x-service-timestamp': timestamp,
          'x-service-signature': `sha256=${signature}`,
        }) as never,
        payload
      )
    ).not.toThrow();
  });

  it('rejects expired signatures', () => {
    const payload = '{}';
    const timestamp = String(Date.now() - 10 * 60 * 1000);
    const signature = createServiceSignature(payload, timestamp);

    expect(() =>
      assertValidServiceRequest(
        buildMockRequest({
          'x-service-timestamp': timestamp,
          'x-service-signature': `sha256=${signature}`,
        }) as never,
        payload
      )
    ).toThrow(ApiHttpError);
  });

  it('rejects invalid signature hash', () => {
    const payload = '{}';
    const timestamp = String(Date.now());

    expect(() =>
      assertValidServiceRequest(
        buildMockRequest({
          'x-service-timestamp': timestamp,
          'x-service-signature': 'sha256=deadbeef',
        }) as never,
        payload
      )
    ).toThrow(ApiHttpError);
  });

  it('rejects requests with missing headers', () => {
    expect(() => assertValidServiceRequest(buildMockRequest({}) as never, '{}')).toThrow(ApiHttpError);
  });

  it('rejects non-numeric timestamp header', () => {
    const payload = '{}';
    const signature = createServiceSignature(payload, 'not-a-number');

    expect(() =>
      assertValidServiceRequest(
        buildMockRequest({
          'x-service-timestamp': 'not-a-number',
          'x-service-signature': `sha256=${signature}`,
        }) as never,
        payload
      )
    ).toThrow(ApiHttpError);
  });
});
