import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as uploadScreenshot } from '@/app/api/screenshots/upload/route';
import { readEnvelope } from '../helpers/api-test-harness';

describe('screenshot upload error envelope', () => {
  it('returns shared failure envelope for missing file', async () => {
    const form = new FormData();
    const request = new NextRequest('https://example.test/api/screenshots/upload', {
      method: 'POST',
      body: form,
    });

    const response = await uploadScreenshot(request);

    expect(response.status).toBe(400);
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    const payload = await readEnvelope(response);
    expect(payload.error?.code).toBe('VALIDATION_ERROR');
    expect(payload.error?.category).toBe('validation');
    expect(payload.error?.retryable).toBe(false);
    expect(payload.error?.source).toBe('blob');
  });
});
