import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendMistralConversation,
  extractConversationTextOutputs,
  extractFunctionCalls,
  extractPendingToolCalls,
  runMistralOcr,
  runMistralStructuredOutput,
  startMistralConversation,
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

  it('normalizes string inputs to message.input entries for conversations', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    process.env.MISTRAL_BASE_URL = 'https://api.mistral.ai';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'conversation.response',
          conversation_id: 'conv_test',
          outputs: [],
          usage: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await startMistralConversation({
      inputs: 'hello world',
      store: false,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    const inputs = body.inputs as Array<Record<string, unknown>>;
    expect(Array.isArray(inputs)).toBe(true);
    expect(inputs[0]).toMatchObject({
      type: 'message.input',
      role: 'user',
      content: 'hello world',
    });
  });

  it('normalizes legacy chunk arrays to message.input entries when appending', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    process.env.MISTRAL_BASE_URL = 'https://api.mistral.ai';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'conversation.response',
          conversation_id: 'conv_test',
          outputs: [],
          usage: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await appendMistralConversation({
      conversationId: 'conv_test',
      inputs: [
        { type: 'text', text: 'hello' },
        { type: 'image_url', image_url: 'data:image/png;base64,ZmFrZQ==' },
      ],
      store: false,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    const inputs = body.inputs as Array<Record<string, unknown>>;
    expect(Array.isArray(inputs)).toBe(true);
    expect(inputs[0]).toMatchObject({
      type: 'message.input',
      role: 'user',
    });
    expect(Array.isArray(inputs[0]?.content)).toBe(true);
    expect((inputs[0]?.content as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: 'text',
      text: 'hello',
    });
  });

  it('merges structured response_format with custom completion args', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    process.env.MISTRAL_BASE_URL = 'https://api.mistral.ai';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'conversation.response',
          conversation_id: 'conv_structured',
          outputs: [
            {
              type: 'message.output',
              content: '{"ok":true}',
            },
          ],
          usage: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const structured = await runMistralStructuredOutput<{ ok: boolean }>({
      instructions: 'Return JSON',
      input: 'hello',
      schemaName: 'demo_schema',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: {
          ok: { type: 'boolean' },
        },
      },
      completionArgs: {
        tool_choice: 'auto',
        parallel_tool_calls: false,
      },
      metadata: {
        callsite: 'test',
      },
      store: false,
    });

    expect(structured.parsed.ok).toBe(true);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    expect(body.metadata).toMatchObject({ callsite: 'test' });
    expect(body.completion_args).toMatchObject({
      tool_choice: 'auto',
    });
    expect((body.completion_args as Record<string, unknown>).parallel_tool_calls).toBeUndefined();
    expect((body.completion_args as Record<string, unknown>).response_format).toBeTruthy();
  });

  it('normalizes conversation metadata values to strings and 512-char max', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    process.env.MISTRAL_BASE_URL = 'https://api.mistral.ai';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'conversation.response',
          conversation_id: 'conv_meta',
          outputs: [],
          usage: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await startMistralConversation({
      inputs: 'meta check',
      metadata: {
        callsite: 'assistant_planner',
        boolFlag: true,
        longValue: 'x'.repeat(1024),
        nested: {
          a: 1,
          b: 'two',
        },
      },
      store: false,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    const metadata = (body.metadata || {}) as Record<string, unknown>;

    expect(typeof metadata.callsite).toBe('string');
    expect(typeof metadata.boolFlag).toBe('string');
    expect(metadata.boolFlag).toBe('true');
    expect(typeof metadata.longValue).toBe('string');
    expect(String(metadata.longValue).length).toBe(512);
    expect(typeof metadata.nested).toBe('string');
    expect(String(metadata.nested)).toContain('"a":1');
  });
});
