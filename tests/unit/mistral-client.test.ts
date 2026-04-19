import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractConversationTextOutputs,
  extractFunctionCalls,
  extractPendingToolCalls,
  runMistralOcr,
} from '@/lib/mistral/client';

describe('mistral client parsers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_BASE_URL;
  });

  it('extracts text outputs from mixed message chunks', () => {
    const outputs = [
      {
        type: 'message.output',
        content: [
          { type: 'text', text: 'Hello commander.' },
          { type: 'other', value: 'ignored' },
        ],
      },
      {
        type: 'message.output',
        content: 'Second line',
      },
      {
        type: 'function.call',
        name: 'register_player',
      },
    ] as Array<Record<string, unknown>>;

    expect(extractConversationTextOutputs(outputs)).toEqual([
      'Hello commander.',
      'Second line',
    ]);
  });

  it('parses function calls and pending confirmations', () => {
    const outputs = [
      {
        type: 'function.call',
        tool_call_id: 'tool_1',
        name: 'register_player',
        arguments: JSON.stringify({ governorId: '1234', name: 'Alpha' }),
        confirmation_status: 'pending',
      },
      {
        type: 'function.call',
        tool_call_id: 'tool_2',
        name: 'create_event',
        arguments: { name: 'Week 01' },
        confirmation_status: 'allowed',
      },
    ] as Array<Record<string, unknown>>;

    const calls = extractFunctionCalls(outputs);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.name).toBe('register_player');
    expect(calls[0]?.confirmationStatus).toBe('pending');

    const pending = extractPendingToolCalls(outputs);
    expect(pending).toEqual([
      {
        toolCallId: 'tool_1',
        name: 'register_player',
        arguments: { governorId: '1234', name: 'Alpha' },
      },
    ]);
  });

  it('retries transient server failures and succeeds', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    process.env.MISTRAL_BASE_URL = 'https://api.mistral.ai';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'server busy' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            pages: [{ index: 0, markdown: 'ok', images: [], dimensions: {} }],
            model: 'mistral-ocr-latest',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    vi.stubGlobal('fetch', fetchMock);

    const result = await runMistralOcr({
      image: {
        base64: 'ZmFrZQ==',
        mimeType: 'image/png',
      },
    });

    expect(result.pages).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps abort/network timeout style failures to MistralApiError', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    process.env.MISTRAL_BASE_URL = 'https://api.mistral.ai';

    const abortError = new DOMException('aborted', 'AbortError');
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runMistralOcr({
        image: {
          base64: 'ZmFrZQ==',
          mimeType: 'image/png',
        },
      })
    ).rejects.toMatchObject({
      name: 'MistralApiError',
      code: 'REQUEST_TIMEOUT',
    });

    expect(fetchMock).toHaveBeenCalled();
  });
});
