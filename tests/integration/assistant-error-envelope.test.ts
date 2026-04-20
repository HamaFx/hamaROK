import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postAssistantMessage } from '@/app/api/v2/assistant/conversations/[id]/messages/route';
import { readEnvelope } from '../helpers/api-test-harness';

describe('assistant message route error envelope', () => {
  it('returns machine-readable metadata when content-type is invalid', async () => {
    const request = new NextRequest('https://example.test/api/v2/assistant/conversations/c1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const response = await postAssistantMessage(request, {
      params: Promise.resolve({ id: 'c1' }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    const payload = await readEnvelope(response);
    expect(payload.error?.code).toBe('VALIDATION_ERROR');
    expect(payload.error?.category).toBe('validation');
    expect(payload.error?.retryable).toBe(false);
    expect(payload.error?.source).toBe('api');
  });
});
