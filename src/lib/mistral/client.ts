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

export interface MistralEmbeddingData {
  object?: string;
  index: number;
  embedding: number[] | string;
}

export interface MistralEmbeddingResponse {
  object?: string;
  id?: string;
  model?: string;
  data: MistralEmbeddingData[];
  usage?: Record<string, unknown>;
}

export type MistralJsonResponseFormat =
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: {
        name?: string;
        strict?: boolean;
        schema: Record<string, unknown>;
      };
    };

export interface MistralFileResponse {
  id: string;
  filename?: string;
  bytes?: number;
  purpose?: string;
  object?: string;
  created_at?: number;
  [key: string]: unknown;
}

export type MistralBatchEndpoint =
  | '/v1/chat/completions'
  | '/v1/embeddings'
  | '/v1/fim/completions'
  | '/v1/moderations'
  | '/v1/chat/moderations'
  | '/v1/ocr'
  | '/v1/classifications'
  | '/v1/chat/classifications'
  | '/v1/conversations'
  | '/v1/audio/transcriptions';

export type MistralBatchStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'TIMEOUT_EXCEEDED'
  | 'CANCELLATION_REQUESTED'
  | 'CANCELLED';

export interface MistralBatchJobResponse {
  id: string;
  status: MistralBatchStatus;
  endpoint: string;
  model?: string | null;
  total_requests?: number;
  completed_requests?: number;
  succeeded_requests?: number;
  failed_requests?: number;
  output_file?: string | null;
  error_file?: string | null;
  outputs?: Array<Record<string, unknown>> | null;
  errors?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown> | null;
  created_at?: number;
  started_at?: number | null;
  completed_at?: number | null;
  [key: string]: unknown;
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
  headers?: Record<string, string>;
  contentType?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
}

const MISTRAL_METADATA_VALUE_MAX = 512;

function sanitizeMetadataValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, MISTRAL_METADATA_VALUE_MAX) : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return null;
    return serialized.slice(0, MISTRAL_METADATA_VALUE_MAX);
  } catch {
    return '[unserializable]';
  }
}

function normalizeConversationMetadata(
  metadata?: Record<string, unknown>
): Record<string, string> | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const next: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(metadata)) {
    const key = String(rawKey || '').trim();
    if (!key) continue;
    const normalized = sanitizeMetadataValue(value);
    if (!normalized) continue;
    next[key] = normalized;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeConversationCompletionArgs(
  completionArgs?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!completionArgs || typeof completionArgs !== 'object') return undefined;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(completionArgs)) {
    if (value === undefined) continue;
    if (key === 'parallel_tool_calls') continue;
    next[key] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
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
  const detailList = Array.isArray(record.detail) ? record.detail : null;
  const firstDetail = detailList?.[0];
  const detailMessage =
    firstDetail && typeof firstDetail === 'object'
      ? (() => {
          const row = firstDetail as Record<string, unknown>;
          const msg = typeof row.msg === 'string' ? row.msg.trim() : '';
          if (!msg) return '';
          const loc = Array.isArray(row.loc) ? row.loc.map((entry) => String(entry || '')).filter(Boolean).join('.') : '';
          return loc ? `${msg} (${loc})` : msg;
        })()
      : typeof firstDetail === 'string'
        ? firstDetail.trim()
        : '';

  const message =
    (typeof nested?.message === 'string' && nested.message) ||
    (typeof record.message === 'string' && record.message) ||
    detailMessage ||
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
      const hasFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        ...(options.headers || {}),
      };

      if (!hasFormData && options.contentType !== null) {
        headers['Content-Type'] = options.contentType || 'application/json';
      }

      const body =
        options.body == null
          ? undefined
          : hasFormData || typeof options.body === 'string'
            ? (options.body as BodyInit)
            : JSON.stringify(options.body);

      const response = await fetch(`${baseUrl}${options.path}`, {
        method: options.method,
        headers,
        body,
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
  documentAnnotationFormat?: MistralJsonResponseFormat;
  documentAnnotationPrompt?: string;
  confidenceScoresGranularity?: 'word' | 'page';
  pages?: number[];
  extractHeader?: boolean;
  extractFooter?: boolean;
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
      document_annotation_format: args.documentAnnotationFormat,
      document_annotation_prompt: args.documentAnnotationPrompt,
      confidence_scores_granularity: args.confidenceScoresGranularity,
      pages: args.pages,
      extract_header: args.extractHeader,
      extract_footer: args.extractFooter,
    },
  });
}

export async function runMistralEmbeddings(args: {
  input: string | string[];
  model?: string;
  outputDimension?: number;
  outputDtype?: 'float' | 'int8' | 'uint8' | 'binary' | 'ubinary';
  encodingFormat?: 'float' | 'base64';
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<MistralEmbeddingResponse> {
  const inputRows = Array.isArray(args.input)
    ? args.input.map((row) => String(row || '').trim()).filter(Boolean)
    : [String(args.input || '').trim()].filter(Boolean);
  if (inputRows.length === 0) {
    throw new MistralApiError('Embedding input is required.', 400, 'VALIDATION_ERROR');
  }

  return requestJson<MistralEmbeddingResponse>({
    method: 'POST',
    path: '/v1/embeddings',
    timeoutMs: args.timeoutMs,
    maxRetries: args.maxRetries,
    body: {
      model: (args.model || 'mistral-embed-2312').trim(),
      input: inputRows.length === 1 ? inputRows[0] : inputRows,
      output_dimension: Number.isFinite(args.outputDimension) ? Number(args.outputDimension) : undefined,
      output_dtype: args.outputDtype,
      encoding_format: args.encodingFormat,
      metadata: args.metadata,
    },
  });
}

export async function startMistralConversation(args: {
  model?: string;
  instructions?: string;
  inputs: string | Array<Record<string, unknown>>;
  tools?: MistralTool[];
  metadata?: Record<string, unknown>;
  guardrails?: Array<Record<string, unknown>>;
  completionArgs?: Record<string, unknown>;
  store?: boolean;
}): Promise<MistralConversationResponse> {
  const normalizedInputs = normalizeConversationInputs(args.inputs);
  const normalizedMetadata = normalizeConversationMetadata(args.metadata);
  const normalizedCompletionArgs = normalizeConversationCompletionArgs(args.completionArgs);
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
  if (normalizedMetadata && Object.keys(normalizedMetadata).length > 0) {
    body.metadata = normalizedMetadata;
  }
  if (Array.isArray(args.guardrails) && args.guardrails.length > 0) {
    body.guardrails = args.guardrails;
  }
  if (normalizedCompletionArgs) {
    body.completion_args = normalizedCompletionArgs;
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
  guardrails?: Array<Record<string, unknown>>;
  completionArgs?: Record<string, unknown>;
  store?: boolean;
}): Promise<MistralConversationResponse> {
  const normalizedInputs = normalizeConversationInputs(args.inputs);
  const normalizedCompletionArgs = normalizeConversationCompletionArgs(args.completionArgs);
  return requestJson<MistralConversationResponse>({
    method: 'POST',
    path: `/v1/conversations/${encodeURIComponent(args.conversationId)}`,
    body: {
      inputs: normalizedInputs,
      tool_confirmations: args.toolConfirmations || undefined,
      guardrails: args.guardrails || undefined,
      completion_args: normalizedCompletionArgs,
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
  guardrails?: Array<Record<string, unknown>>;
  completionArgs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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
  const completionArgs = {
    ...(args.completionArgs || {}),
    ...responseFormat,
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
      guardrails: args.guardrails,
      completionArgs,
      metadata: args.metadata,
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
      guardrails: args.guardrails,
      completionArgs: {
        ...(args.completionArgs || {}),
        response_format: {
          type: 'json_object',
        },
      },
      metadata: args.metadata,
      store: args.store ?? false,
    });

    return {
      response: fallbackResponse,
      parsed: parseStructuredResponse(fallbackResponse),
    };
  }
}

export async function runMistralVisionStructuredExtraction<T>(args: {
  image: MistralImageInput;
  instructions: string;
  schemaName: string;
  schema: Record<string, unknown>;
  model?: string;
  prompt?: string;
  guardrails?: Array<Record<string, unknown>>;
  completionArgs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  store?: boolean;
}): Promise<{ response: MistralConversationResponse; parsed: T }> {
  const chunks: Array<Record<string, unknown>> = [];
  const prompt = String(args.prompt || '').trim();
  if (prompt) {
    chunks.push({
      type: 'text',
      text: prompt.slice(0, 8000),
    });
  }
  chunks.push({
    type: 'image_url',
    image_url: toDataUrl(args.image),
  });

  return runMistralStructuredOutput<T>({
    instructions: args.instructions,
    input: chunks,
    schemaName: args.schemaName,
    schema: args.schema,
    model: args.model,
    guardrails: args.guardrails,
    completionArgs: args.completionArgs,
    metadata: args.metadata,
    store: args.store,
  });
}

export async function uploadMistralFile(args: {
  fileName: string;
  content: Uint8Array | string;
  purpose?: 'batch' | 'ocr' | 'fine-tune';
  contentType?: string;
}): Promise<MistralFileResponse> {
  const fileName = String(args.fileName || '').trim() || `upload-${Date.now()}.jsonl`;
  const form = new FormData();
  const contentPart: BlobPart =
    typeof args.content === 'string'
      ? args.content
      : (() => {
          const bytes = new Uint8Array(args.content.byteLength);
          bytes.set(args.content);
          return bytes;
        })();
  const blob = new Blob([contentPart], {
    type: args.contentType || 'application/octet-stream',
  });
  form.append('file', blob, fileName);
  if (args.purpose) {
    form.append('purpose', args.purpose);
  }

  return requestJson<MistralFileResponse>({
    method: 'POST',
    path: '/v1/files',
    body: form,
    contentType: null,
  });
}

export async function createMistralBatchJob(args: {
  endpoint: MistralBatchEndpoint;
  model: string;
  requests?: Array<Record<string, unknown>>;
  inputFiles?: string[];
  metadata?: Record<string, unknown>;
  timeoutHours?: number;
}): Promise<MistralBatchJobResponse> {
  return requestJson<MistralBatchJobResponse>({
    method: 'POST',
    path: '/v1/batch/jobs',
    body: {
      endpoint: args.endpoint,
      model: args.model,
      requests: args.requests,
      input_files: args.inputFiles,
      metadata: args.metadata,
      timeout_hours: args.timeoutHours ?? 24,
    },
  });
}

export async function getMistralBatchJob(
  jobId: string,
  inline = false
): Promise<MistralBatchJobResponse> {
  const query = inline ? '?inline=true' : '';
  return requestJson<MistralBatchJobResponse>({
    method: 'GET',
    path: `/v1/batch/jobs/${encodeURIComponent(jobId)}${query}`,
  });
}

export async function pollMistralBatchJobUntilTerminal(args: {
  jobId: string;
  inline?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<MistralBatchJobResponse> {
  const pollIntervalMs = Math.max(1000, Number(args.pollIntervalMs || 5000));
  const timeoutMs = Math.max(5000, Number(args.timeoutMs || 600000));
  const startedAt = Date.now();

  while (true) {
    const batch = await getMistralBatchJob(args.jobId, args.inline ?? false);
    if (
      batch.status === 'SUCCESS' ||
      batch.status === 'FAILED' ||
      batch.status === 'TIMEOUT_EXCEEDED' ||
      batch.status === 'CANCELLED'
    ) {
      return batch;
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new MistralApiError(
        `Timed out waiting for batch job ${args.jobId}.`,
        504,
        'BATCH_TIMEOUT'
      );
    }

    await sleep(pollIntervalMs);
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
