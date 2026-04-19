import { getMistralApiKey, getMistralBaseUrl } from '@/lib/env';

export class MistralApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'MistralApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface MistralImageInput {
  base64: string;
  mimeType: string;
}

export interface MistralOcrPage {
  index: number;
  markdown: string;
  images: Array<Record<string, unknown>>;
  dimensions: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MistralOcrResponse {
  pages: MistralOcrPage[];
  model: string;
  document_annotation?: string | null;
  usage_info?: {
    pages_processed?: number;
    doc_size_bytes?: number | null;
  };
}

export interface MistralToolCallConfirmation {
  tool_call_id: string;
  confirmation: 'allow' | 'deny';
}

export interface MistralFunctionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    strict?: boolean;
    parameters: Record<string, unknown>;
  };
}

export type MistralTool = MistralFunctionTool;

export interface MistralConversationResponse {
  object: 'conversation.response';
  conversation_id: string;
  outputs: Array<Record<string, unknown>>;
  usage: Record<string, unknown>;
  guardrails?: Array<Record<string, unknown>> | null;
}

export interface MistralConversationMessagesResponse {
  object: string;
  conversation_id: string;
  messages: Array<Record<string, unknown>>;
}

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
}

function toDataUrl(args: MistralImageInput): string {
  const mimeType = args.mimeType || 'image/png';
  const payload = args.base64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  return `data:${mimeType};base64,${payload}`;
}

function normalizeConversationInputs(
  inputs: string | Array<Record<string, unknown>> | undefined
): Array<Record<string, unknown>> | undefined {
  if (typeof inputs === 'undefined') return undefined;

  if (typeof inputs === 'string') {
    return [
      {
        type: 'message.input',
        role: 'user',
        content: inputs,
      },
    ];
  }

  const rows = Array.isArray(inputs) ? inputs : [];
  if (rows.length === 0) {
    return [
      {
        type: 'message.input',
        role: 'user',
        content: '(empty)',
      },
    ];
  }

  const looksLikeConversationEntries = rows.every((row) => {
    const type = typeof row?.type === 'string' ? row.type : '';
    return (
      type === 'message.input' ||
      type === 'message.output' ||
      type === 'function.call' ||
      type === 'function.result' ||
      type === 'tool.execution' ||
      type === 'agent.handoff'
    );
  });

  if (looksLikeConversationEntries) {
    return rows;
  }

  // Back-compat: wrap legacy multimodal chunks ({ type: 'text'|'image_url', ... })
  // into a single message.input entry expected by /v1/conversations.
  return [
    {
      type: 'message.input',
      role: 'user',
      content: rows,
    },
  ];
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RETRIES = 2;

function backoffMs(attempt: number): number {
  const capped = Math.min(5_000, 250 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 120);
  return capped + jitter;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const asSeconds = Number(value);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1_000);
  }

  const asDate = Date.parse(value);
  if (!Number.isFinite(asDate)) return null;
  const diff = asDate - Date.now();
  if (diff <= 0) return 0;
  return diff;
}

function isTransientMistralStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorMessage(payload: unknown, fallback: string): {
  message: string;
  code?: string;
  details?: unknown;
} {
  if (!payload || typeof payload !== 'object') {
    return { message: fallback };
  }

  const record = payload as Record<string, unknown>;
  const nested = record.error && typeof record.error === 'object'
    ? (record.error as Record<string, unknown>)
    : null;

  const message =
    (typeof nested?.message === 'string' && nested.message) ||
    (typeof record.message === 'string' && record.message) ||
    fallback;

  const code =
    (typeof nested?.code === 'string' && nested.code) ||
    (typeof record.code === 'string' && record.code) ||
    undefined;

  const details = nested?.details ?? record.details ?? payload;

  return { message, code, details };
}

async function requestJson<T>(options: RequestOptions): Promise<T> {
  const apiKey = getMistralApiKey();
  const baseUrl = getMistralBaseUrl();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = Math.max(0, Math.min(6, options.maxRetries ?? DEFAULT_MAX_RETRIES));
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${options.path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: options.body == null ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      const payload = await parseJsonSafe(response);
      if (response.ok) {
        return payload as T;
      }

      const mapped = extractErrorMessage(
        payload,
        `Mistral request failed (${response.status}).`
      );
      const mappedError = new MistralApiError(
        mapped.message,
        response.status,
        mapped.code,
        mapped.details
      );
      lastError = mappedError;

      if (attempt < maxRetries && isTransientMistralStatus(response.status)) {
        const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'));
        await sleep(Math.max(retryAfter ?? 0, backoffMs(attempt)));
        continue;
      }

      throw mappedError;
    } catch (error) {
      lastError = error;

      if (isAbortError(error)) {
        const timeoutError = new MistralApiError(
          `Mistral request timed out after ${timeoutMs}ms.`,
          504,
          'REQUEST_TIMEOUT'
        );
        lastError = timeoutError;
        if (attempt < maxRetries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw timeoutError;
      }

      if (error instanceof MistralApiError) {
        throw error;
      }

      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }

      throw new MistralApiError(
        error instanceof Error ? error.message : 'Mistral request failed.',
        502,
        'NETWORK_ERROR',
        { cause: error }
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new MistralApiError('Mistral request failed.', 502, 'UNKNOWN');
}

export async function runMistralOcr(args: {
  image: MistralImageInput;
  model?: string;
  includeImageBase64?: boolean;
  tableFormat?: 'markdown' | 'html';
}): Promise<MistralOcrResponse> {
  const model = (args.model || 'mistral-ocr-latest').trim();
  return requestJson<MistralOcrResponse>({
    method: 'POST',
    path: '/v1/ocr',
    body: {
      model,
      document: {
        type: 'image_url',
        image_url: {
          url: toDataUrl(args.image),
        },
      },
      include_image_base64: args.includeImageBase64 ?? false,
      table_format: args.tableFormat,
    },
  });
}

export async function startMistralConversation(args: {
  model?: string;
  instructions?: string;
  inputs: string | Array<Record<string, unknown>>;
  tools?: MistralTool[];
  metadata?: Record<string, unknown>;
  completionArgs?: Record<string, unknown>;
  store?: boolean;
}): Promise<MistralConversationResponse> {
  const normalizedInputs = normalizeConversationInputs(args.inputs);
  const body: Record<string, unknown> = {
    model: args.model || 'mistral-large-latest',
    inputs: normalizedInputs,
    store: args.store ?? true,
    stream: false,
  };

  if (args.instructions && args.instructions.trim()) {
    body.instructions = args.instructions;
  }
  if (args.tools && args.tools.length > 0) {
    body.tools = args.tools;
  }
  if (args.metadata && Object.keys(args.metadata).length > 0) {
    body.metadata = args.metadata;
  }
  if (args.completionArgs) {
    body.completion_args = args.completionArgs;
  }

  return requestJson<MistralConversationResponse>({
    method: 'POST',
    path: '/v1/conversations',
    body,
  });
}

export async function appendMistralConversation(args: {
  conversationId: string;
  inputs?: string | Array<Record<string, unknown>>;
  toolConfirmations?: MistralToolCallConfirmation[];
  completionArgs?: Record<string, unknown>;
  store?: boolean;
}): Promise<MistralConversationResponse> {
  const normalizedInputs = normalizeConversationInputs(args.inputs);
  return requestJson<MistralConversationResponse>({
    method: 'POST',
    path: `/v1/conversations/${encodeURIComponent(args.conversationId)}`,
    body: {
      inputs: normalizedInputs,
      tool_confirmations: args.toolConfirmations || undefined,
      completion_args: args.completionArgs || undefined,
      store: args.store ?? true,
      stream: false,
    },
  });
}

export async function getMistralConversationMessages(
  conversationId: string
): Promise<MistralConversationMessagesResponse> {
  return requestJson<MistralConversationMessagesResponse>({
    method: 'GET',
    path: `/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
  });
}

export function extractConversationTextOutputs(outputs: Array<Record<string, unknown>>): string[] {
  const textParts: string[] = [];

  for (const output of outputs) {
    const type = typeof output.type === 'string' ? output.type : '';
    if (type !== 'message.output') continue;

    const content = output.content;
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (trimmed) textParts.push(trimmed);
      continue;
    }

    if (Array.isArray(content)) {
      for (const chunk of content) {
        if (!chunk || typeof chunk !== 'object') continue;
        const chunkRecord = chunk as Record<string, unknown>;
        if (chunkRecord.type === 'text' && typeof chunkRecord.text === 'string') {
          const trimmed = chunkRecord.text.trim();
          if (trimmed) textParts.push(trimmed);
        }
      }
    }
  }

  return textParts;
}

function parseJsonFromLooseText(text: string): unknown {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // continue
    }
  }

  const objectCandidate = trimmed.match(/\{[\s\S]*\}$/);
  if (objectCandidate?.[0]) {
    try {
      return JSON.parse(objectCandidate[0]);
    } catch {
      // continue
    }
  }

  return null;
}

export async function runMistralStructuredOutput<T>(args: {
  instructions: string;
  input: string | Array<Record<string, unknown>>;
  schemaName: string;
  schema: Record<string, unknown>;
  model?: string;
  store?: boolean;
}): Promise<{ response: MistralConversationResponse; parsed: T }> {
  const responseFormat = {
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: args.schemaName,
        strict: true,
        schema: args.schema,
      },
    },
  } as Record<string, unknown>;

  const parseStructuredResponse = (response: MistralConversationResponse): T => {
    const textOutputs = extractConversationTextOutputs(response.outputs);
    const combined = textOutputs.join('\n').trim();
    const parsed = parseJsonFromLooseText(combined);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new MistralApiError(
        'Mistral structured response did not contain a valid JSON object.',
        502,
        'INVALID_STRUCTURED_OUTPUT',
        { outputs: response.outputs }
      );
    }

    return parsed as T;
  };

  try {
    const response = await startMistralConversation({
      model: args.model || 'mistral-large-latest',
      instructions: args.instructions,
      inputs: args.input,
      completionArgs: responseFormat,
      store: args.store ?? false,
    });

    return {
      response,
      parsed: parseStructuredResponse(response),
    };
  } catch (error) {
    const isServerError = error instanceof MistralApiError && error.status >= 500;
    if (!isServerError) throw error;

    const fallbackInstructions = [
      args.instructions,
      '',
      'Return STRICTLY valid JSON object (no prose, no markdown) matching this JSON schema:',
      JSON.stringify(args.schema),
    ].join('\n');

    const fallbackResponse = await startMistralConversation({
      model: args.model || 'mistral-large-latest',
      instructions: fallbackInstructions,
      inputs: args.input,
      completionArgs: {
        response_format: {
          type: 'json_object',
        },
      },
      store: args.store ?? false,
    });

    return {
      response: fallbackResponse,
      parsed: parseStructuredResponse(fallbackResponse),
    };
  }
}

export function extractPendingToolCalls(outputs: Array<Record<string, unknown>>): Array<{
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown> | string;
}> {
  return extractFunctionCalls(outputs)
    .filter((call) => call.confirmationStatus === 'pending')
    .map((call) => ({
      toolCallId: call.toolCallId,
      name: call.name,
      arguments: call.arguments,
    }));
}

export function extractFunctionCalls(outputs: Array<Record<string, unknown>>): Array<{
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown> | string;
  confirmationStatus: 'pending' | 'allowed' | 'denied' | null;
}> {
  const calls: Array<{
    toolCallId: string;
    name: string;
    arguments: Record<string, unknown> | string;
    confirmationStatus: 'pending' | 'allowed' | 'denied' | null;
  }> = [];

  for (const output of outputs) {
    if (output.type !== 'function.call') continue;
    const toolCallId = typeof output.tool_call_id === 'string' ? output.tool_call_id : '';
    const name = typeof output.name === 'string' ? output.name : '';
    if (!toolCallId || !name) continue;

    let args: Record<string, unknown> | string = {};
    const rawArgs = output.arguments;
    if (typeof rawArgs === 'string') {
      try {
        const parsed = JSON.parse(rawArgs);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        } else {
          args = rawArgs;
        }
      } catch {
        args = rawArgs;
      }
    } else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
      args = rawArgs as Record<string, unknown>;
    }

    calls.push({
      toolCallId,
      name,
      arguments: args,
      confirmationStatus:
        output.confirmation_status === 'pending' ||
        output.confirmation_status === 'allowed' ||
        output.confirmation_status === 'denied'
          ? output.confirmation_status
          : null,
    });
  }

  return calls;
}
