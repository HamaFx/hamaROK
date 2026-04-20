import { expect } from 'vitest';

export interface EnvelopeRow<T = unknown> {
  data: T | null;
  meta: Record<string, unknown> | null;
  error:
    | (Record<string, unknown> & {
        code: string;
        message: string;
      })
    | null;
}

export async function readEnvelope<T = unknown>(response: Response): Promise<EnvelopeRow<T>> {
  const payload = (await response.json()) as EnvelopeRow<T>;
  expect(payload).toHaveProperty('data');
  expect(payload).toHaveProperty('meta');
  expect(payload).toHaveProperty('error');
  return payload;
}

export function expectReliabilityFields(error: Record<string, unknown>) {
  expect(typeof error.category).toBe('string');
  expect(typeof error.retryable).toBe('boolean');
  expect(typeof error.source).toBe('string');
  expect(typeof error.requestId).toBe('string');
}
