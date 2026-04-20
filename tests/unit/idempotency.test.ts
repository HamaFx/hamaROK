import { describe, expect, it } from 'vitest';
import { handleApiError } from '@/lib/api-response';
import { createIdempotencyConflictError } from '@/lib/idempotency';
import { readEnvelope } from '../helpers/api-test-harness';

describe('idempotency conflict errors', () => {
  it('marks in-progress key conflicts as retryable', async () => {
    const response = handleApiError(createIdempotencyConflictError('IN_PROGRESS'));
    expect(response.status).toBe(409);
    expect(response.headers.get('Retry-After')).toBe('2');
    const payload = await readEnvelope(response);
    expect(payload.error?.code).toBe('CONFLICT');
    expect(payload.error?.retryable).toBe(true);
    expect(payload.error?.source).toBe('idempotency');
    expect((payload.error?.details as Record<string, unknown>)?.reason).toBe(
      'IDEMPOTENCY_IN_PROGRESS'
    );
  });

  it('marks payload mismatch conflicts as non-retryable', async () => {
    const response = handleApiError(createIdempotencyConflictError('PAYLOAD_MISMATCH'));
    expect(response.status).toBe(409);
    expect(response.headers.get('Retry-After')).toBeNull();
    const payload = await readEnvelope(response);
    expect(payload.error?.code).toBe('CONFLICT');
    expect(payload.error?.retryable).toBe(false);
    expect(payload.error?.source).toBe('idempotency');
    expect((payload.error?.details as Record<string, unknown>)?.reason).toBe(
      'IDEMPOTENCY_PAYLOAD_MISMATCH'
    );
  });
});
