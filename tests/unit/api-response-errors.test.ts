import { describe, expect, it } from 'vitest';
import { ApiHttpError, fail, handleApiError } from '@/lib/api-response';
import { MistralApiError } from '@/lib/mistral/client';
import { expectReliabilityFields, readEnvelope } from '../helpers/api-test-harness';

describe('api-response error reliability', () => {
  it('includes reliability metadata and request id in fail responses', async () => {
    const response = fail('VALIDATION_ERROR', 'Invalid payload.', 400, {
      field: 'workspaceId',
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('X-Request-Id')).toBeTruthy();

    const payload = await readEnvelope(response);
    expect(payload.error).toBeTruthy();
    expectReliabilityFields(payload.error as Record<string, unknown>);
    expect(payload.error?.code).toBe('VALIDATION_ERROR');
    expect(payload.error?.category).toBe('validation');
    expect(payload.error?.retryable).toBe(false);
  });

  it('propagates retry hints and Retry-After for typed ApiHttpError', async () => {
    const response = handleApiError(
      new ApiHttpError(
        'CONFLICT',
        'Request with this idempotency key is already in progress.',
        409,
        { reason: 'IDEMPOTENCY_IN_PROGRESS' },
        true,
        {
          source: 'idempotency',
          retryable: true,
          retryAfterMs: 1200,
          hints: ['Retry with same idempotency key.'],
        }
      )
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('Retry-After')).toBe('2');
    const payload = await readEnvelope(response);
    expect(payload.error?.code).toBe('CONFLICT');
    expect(payload.error?.retryable).toBe(true);
    expect(payload.error?.source).toBe('idempotency');
  });

  it('maps Mistral rate limit to retryable RATE_LIMITED envelope', async () => {
    const response = handleApiError(
      new MistralApiError(
        'Rate limit reached.',
        429,
        'RATE_LIMITED',
        { callsite: 'assistant_planner' },
        2500
      )
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3');
    const payload = await readEnvelope(response);
    expect(payload.error?.code).toBe('RATE_LIMITED');
    expect(payload.error?.category).toBe('rate_limit');
    expect(payload.error?.retryable).toBe(true);
    expect(payload.error?.source).toBe('mistral');
  });

  it('maps Prisma unique violations to deterministic conflict envelopes', async () => {
    const response = handleApiError({
      code: 'P2002',
      message: 'Unique constraint failed',
    });

    expect(response.status).toBe(409);
    const payload = await readEnvelope(response);
    expect(payload.error?.code).toBe('CONFLICT');
    expect(payload.error?.category).toBe('conflict');
    expect(payload.error?.source).toBe('prisma');
    expect(payload.error?.retryable).toBe(false);
  });

  it('maps abort errors to timeout-retryable envelopes', async () => {
    const response = handleApiError(new DOMException('aborted', 'AbortError'));
    expect(response.status).toBe(504);
    expect(response.headers.get('Retry-After')).toBe('1');
    const payload = await readEnvelope(response);
    expect(payload.error?.code).toBe('INTERNAL_ERROR');
    expect(payload.error?.category).toBe('timeout');
    expect(payload.error?.retryable).toBe(true);
  });
});
