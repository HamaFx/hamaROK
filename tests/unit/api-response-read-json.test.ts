import { describe, expect, it } from 'vitest';
import { ApiHttpError, readJson } from '@/lib/api-response';

describe('readJson', () => {
  it('parses valid JSON payloads', async () => {
    const request = new Request('https://example.com', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'w1' }),
    });

    const payload = await readJson<{ workspaceId: string }>(request);
    expect(payload.workspaceId).toBe('w1');
  });

  it('maps malformed or empty JSON payloads to VALIDATION_ERROR', async () => {
    const request = new Request('https://example.com', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    });

    let thrown: unknown;
    try {
      await readJson(request);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiHttpError);
    expect((thrown as ApiHttpError).code).toBe('VALIDATION_ERROR');
    expect((thrown as ApiHttpError).status).toBe(400);
  });
});
