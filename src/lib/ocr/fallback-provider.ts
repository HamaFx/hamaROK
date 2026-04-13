import fs from 'node:fs';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';
import { WorkspaceSettings } from '@prisma/client';
import { getEnv } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import {
  FallbackOcrProvider,
  getDefaultFallbackOcrModel,
  getFallbackOcrEstimatedCostUsd,
  normalizeFallbackOcrProvider,
} from '@/lib/ocr/fallback-config';

const GOOGLE_VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const GOOGLE_VISION_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_PROVIDER: FallbackOcrProvider = 'google_vision';

type FallbackFieldKey =
  | 'governorId'
  | 'governorName'
  | 'power'
  | 'killPoints'
  | 't4Kills'
  | 't5Kills'
  | 'deads';

export interface FallbackProviderRequest {
  workspaceId: string;
  fieldKey: FallbackFieldKey;
  croppedImage: string;
  currentValue: string;
  currentConfidence: number;
  settings: WorkspaceSettings | null;
}

export interface FallbackProviderResponse {
  blocked: boolean;
  reason: string;
  value?: string;
  confidence?: number;
}

interface ProviderCallResult {
  value: string;
  confidence: number;
}

interface ProviderOutcome {
  output: ProviderCallResult | null;
  reason: string;
}

let cachedLocalServiceAccountPath: string | null | undefined;

function getPeriodMonth(date = new Date()): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
}

function isServiceAccountJson(value: unknown): value is {
  client_email: string;
  private_key: string;
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.client_email === 'string' &&
    candidate.client_email.length > 3 &&
    typeof candidate.private_key === 'string' &&
    candidate.private_key.length > 30
  );
}

function findLocalServiceAccountJsonPath(): string | null {
  if (cachedLocalServiceAccountPath !== undefined) {
    return cachedLocalServiceAccountPath;
  }

  if (process.env.NODE_ENV === 'production') {
    cachedLocalServiceAccountPath = null;
    return null;
  }

  const candidates = [
    path.resolve(process.cwd(), 'Example Screenshots'),
    path.resolve(process.cwd(), 'ExampleScreenshots'),
  ];

  for (const dir of candidates) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const files = fs
      .readdirSync(dir)
      .filter((file) => file.toLowerCase().endsWith('.json'));

    for (const file of files) {
      const fullPath = path.join(dir, file);
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (isServiceAccountJson(parsed)) {
          cachedLocalServiceAccountPath = fullPath;
          return fullPath;
        }
      } catch {
        // Not a service-account JSON file. Continue searching.
      }
    }
  }

  cachedLocalServiceAccountPath = null;
  return null;
}

async function incrementBlockedUsage(workspaceId: string, periodMonth: string) {
  await prisma.ocrFallbackUsage.upsert({
    where: {
      workspaceId_periodMonth: {
        workspaceId,
        periodMonth,
      },
    },
    create: {
      workspaceId,
      periodMonth,
      blocked: 1,
    },
    update: {
      blocked: { increment: 1 },
    },
  });
}

async function incrementSuccessfulUsage(args: {
  workspaceId: string;
  periodMonth: string;
  costUsd: number;
}) {
  await prisma.ocrFallbackUsage.upsert({
    where: {
      workspaceId_periodMonth: {
        workspaceId: args.workspaceId,
        periodMonth: args.periodMonth,
      },
    },
    create: {
      workspaceId: args.workspaceId,
      periodMonth: args.periodMonth,
      requestCount: 1,
      projectedUsd: args.costUsd,
    },
    update: {
      requestCount: { increment: 1 },
      projectedUsd: { increment: args.costUsd },
    },
  });
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const root = payload as Record<string, unknown>;
  if (typeof root.output_text === 'string') return root.output_text.trim();
  const output = Array.isArray(root.output) ? root.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const parts = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as Array<Record<string, unknown>>)
      : [];
    for (const part of parts) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        return part.text.trim();
      }
    }
  }
  return '';
}

async function callOpenAiVision(args: {
  model: string;
  fieldKey: FallbackFieldKey;
  croppedImage: string;
  currentValue: string;
}): Promise<ProviderOutcome> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { output: null, reason: 'openai-missing-api-key' };
  }

  const instruction = [
    `Read OCR for field "${args.fieldKey}".`,
    'Return only the value with no explanation.',
    args.fieldKey === 'governorName'
      ? 'Allowed language profile: English letters/numbers/symbols.'
      : 'Return digits only.',
    `Current OCR guess: ${args.currentValue || '(empty)'}.`,
  ].join(' ');

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        temperature: 0,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: instruction },
              { type: 'input_image', image_url: args.croppedImage },
            ],
          },
        ],
      }),
    });
  } catch {
    return { output: null, reason: 'openai-request-failed' };
  }

  if (!response.ok) {
    return { output: null, reason: `openai-http-${response.status}` };
  }

  const payload = await response.json();
  const text = extractResponseText(payload);
  if (!text) {
    return { output: null, reason: 'openai-empty-result' };
  }

  return {
    output: { value: text, confidence: 88 },
    reason: 'ok',
  };
}

function toGoogleImage(croppedImage: string):
  | { content: string }
  | { source: { imageUri: string } }
  | null {
  const trimmed = croppedImage.trim();
  const dataUrlMatch = trimmed.match(/^data:image\/[\w.+-]+;base64,(.+)$/i);
  if (dataUrlMatch?.[1]) {
    const content = dataUrlMatch[1].replace(/\s+/g, '');
    if (content) {
      return { content };
    }
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return { source: { imageUri: trimmed } };
  }

  const asBase64 = trimmed.replace(/\s+/g, '');
  if (asBase64.length > 20 && /^[A-Za-z0-9+/=]+$/.test(asBase64)) {
    return { content: asBase64 };
  }

  return null;
}

function resolveGoogleVisionFeature(model: string): 'TEXT_DETECTION' | 'DOCUMENT_TEXT_DETECTION' {
  const normalized = model.trim().toUpperCase();
  if (normalized === 'TEXT_DETECTION') {
    return 'TEXT_DETECTION';
  }
  return 'DOCUMENT_TEXT_DETECTION';
}

function compactTextValue(raw: string): string {
  return raw.replace(/\r/g, '\n').split('\n').map((part) => part.trim()).filter(Boolean).join(' ');
}

function extractWordConfidences(fullTextAnnotation: unknown): number[] {
  if (!fullTextAnnotation || typeof fullTextAnnotation !== 'object') {
    return [];
  }

  const pages = Array.isArray((fullTextAnnotation as Record<string, unknown>).pages)
    ? ((fullTextAnnotation as Record<string, unknown>).pages as unknown[])
    : [];

  const confidences: number[] = [];
  for (const page of pages) {
    if (!page || typeof page !== 'object') continue;
    const blocks = Array.isArray((page as Record<string, unknown>).blocks)
      ? ((page as Record<string, unknown>).blocks as unknown[])
      : [];

    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const paragraphs = Array.isArray((block as Record<string, unknown>).paragraphs)
        ? ((block as Record<string, unknown>).paragraphs as unknown[])
        : [];

      for (const paragraph of paragraphs) {
        if (!paragraph || typeof paragraph !== 'object') continue;
        const words = Array.isArray((paragraph as Record<string, unknown>).words)
          ? ((paragraph as Record<string, unknown>).words as unknown[])
          : [];

        for (const word of words) {
          if (!word || typeof word !== 'object') continue;
          const value = (word as Record<string, unknown>).confidence;
          if (typeof value === 'number' && Number.isFinite(value)) {
            confidences.push(value);
          }
        }
      }
    }
  }

  return confidences;
}

function extractGoogleVisionResult(payload: unknown): ProviderOutcome {
  if (!payload || typeof payload !== 'object') {
    return { output: null, reason: 'google-vision-invalid-payload' };
  }

  const root = payload as Record<string, unknown>;
  const responses = Array.isArray(root.responses) ? (root.responses as unknown[]) : [];
  const first = responses[0];
  if (!first || typeof first !== 'object') {
    return { output: null, reason: 'google-vision-empty-response' };
  }

  const entry = first as Record<string, unknown>;
  const error = entry.error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) {
      return {
        output: null,
        reason: `google-vision-error:${message.trim().slice(0, 120)}`,
      };
    }
    return { output: null, reason: 'google-vision-error' };
  }

  const fullTextAnnotation =
    entry.fullTextAnnotation && typeof entry.fullTextAnnotation === 'object'
      ? (entry.fullTextAnnotation as Record<string, unknown>)
      : null;

  const textAnnotations = Array.isArray(entry.textAnnotations)
    ? (entry.textAnnotations as Array<Record<string, unknown>>)
    : [];

  const rawText =
    (fullTextAnnotation && typeof fullTextAnnotation.text === 'string'
      ? fullTextAnnotation.text
      : '') ||
    (typeof textAnnotations[0]?.description === 'string'
      ? (textAnnotations[0].description as string)
      : '');

  const value = compactTextValue(rawText);
  if (!value) {
    return { output: null, reason: 'google-vision-empty-text' };
  }

  const wordConfidences = extractWordConfidences(fullTextAnnotation);
  const meanConfidence =
    wordConfidences.length > 0
      ? wordConfidences.reduce((sum, item) => sum + item, 0) / wordConfidences.length
      : null;

  const confidence =
    meanConfidence != null
      ? Math.max(1, Math.min(100, Math.round(meanConfidence * 100)))
      : 84;

  return {
    output: {
      value,
      confidence,
    },
    reason: 'ok',
  };
}

async function getGoogleVisionAuthHeaders(): Promise<
  | {
      endpoint: string;
      headers: Record<string, string>;
    }
  | null
> {
  const env = getEnv();
  const apiKey = env.GOOGLE_VISION_API_KEY?.trim();
  if (apiKey) {
    return {
      endpoint: `${GOOGLE_VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
      headers: {},
    };
  }

  const serviceJson = env.GOOGLE_VISION_SERVICE_ACCOUNT_JSON?.trim();
  let authOptions: ConstructorParameters<typeof GoogleAuth>[0] = {
    scopes: [GOOGLE_VISION_SCOPE],
  };

  if (serviceJson) {
    try {
      const parsed = JSON.parse(serviceJson);
      if (!isServiceAccountJson(parsed)) {
        return null;
      }
      authOptions = {
        ...authOptions,
        credentials: parsed,
      };
    } catch {
      return null;
    }
  } else {
    const explicitKeyFile = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    const discoveredKeyFile = explicitKeyFile || findLocalServiceAccountJsonPath();
    if (discoveredKeyFile) {
      authOptions = {
        ...authOptions,
        keyFile: discoveredKeyFile,
      };
      if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = discoveredKeyFile;
      }
    }
  }

  try {
    const auth = new GoogleAuth(authOptions);
    const client = await auth.getClient();
    const tokenResult = await client.getAccessToken();
    const token =
      typeof tokenResult === 'string'
        ? tokenResult
        : tokenResult && typeof tokenResult === 'object'
          ? tokenResult.token
          : null;

    if (!token) {
      return null;
    }

    return {
      endpoint: GOOGLE_VISION_ENDPOINT,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  } catch {
    return null;
  }
}

async function callGoogleVision(args: {
  model: string;
  croppedImage: string;
}): Promise<ProviderOutcome> {
  const auth = await getGoogleVisionAuthHeaders();
  if (!auth) {
    return { output: null, reason: 'google-vision-auth-missing' };
  }

  const image = toGoogleImage(args.croppedImage);
  if (!image) {
    return { output: null, reason: 'google-vision-invalid-image' };
  }

  const featureType = resolveGoogleVisionFeature(args.model);
  const languageHints = ['en'];

  let response: Response;
  try {
    response = await fetch(auth.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...auth.headers,
      },
      body: JSON.stringify({
        requests: [
          {
            image,
            features: [{ type: featureType }],
            imageContext: {
              languageHints,
              textDetectionParams: {
                enableTextDetectionConfidenceScore: true,
              },
            },
          },
        ],
      }),
    });
  } catch {
    return { output: null, reason: 'google-vision-request-failed' };
  }

  if (!response.ok) {
    let reason = `google-vision-http-${response.status}`;
    try {
      const failure = await response.json();
      const message = (failure as { error?: { message?: string } })?.error?.message;
      if (typeof message === 'string' && message.trim()) {
        const normalized = message.toLowerCase();
        if (normalized.includes('billing') && normalized.includes('enable')) {
          reason = 'google-vision-billing-disabled';
        } else {
          reason = `${reason}:${message.trim().slice(0, 120)}`;
        }
      }
    } catch {
      // Keep generic HTTP reason when response body parsing fails.
    }
    return { output: null, reason };
  }

  const payload = await response.json();
  return extractGoogleVisionResult(payload);
}

export async function runFallbackProvider(
  request: FallbackProviderRequest
): Promise<FallbackProviderResponse> {
  const periodMonth = getPeriodMonth();
  const budget = request.settings?.fallbackOcrMonthlyBudgetUsd ?? 0;
  const enabled = request.settings?.fallbackOcrEnabled ?? false;

  if (!enabled) {
    await incrementBlockedUsage(request.workspaceId, periodMonth);
    return { blocked: true, reason: 'fallback-disabled' };
  }

  if (budget <= 0) {
    await incrementBlockedUsage(request.workspaceId, periodMonth);
    return { blocked: true, reason: 'monthly-budget-cap-zero' };
  }

  const provider =
    normalizeFallbackOcrProvider(request.settings?.fallbackOcrProvider) || DEFAULT_PROVIDER;
  const model =
    request.settings?.fallbackOcrModel?.trim() || getDefaultFallbackOcrModel(provider);

  const usage = await prisma.ocrFallbackUsage.findUnique({
    where: {
      workspaceId_periodMonth: {
        workspaceId: request.workspaceId,
        periodMonth,
      },
    },
  });

  const projected = usage?.projectedUsd ?? 0;
  const estimatedCost = getFallbackOcrEstimatedCostUsd(provider);
  if (projected + estimatedCost > budget) {
    await incrementBlockedUsage(request.workspaceId, periodMonth);
    return { blocked: true, reason: 'monthly-budget-exceeded' };
  }

  let outcome: ProviderOutcome;
  if (provider === 'google_vision') {
    outcome = await callGoogleVision({
      model,
      croppedImage: request.croppedImage,
    });
  } else {
    outcome = await callOpenAiVision({
      model,
      fieldKey: request.fieldKey,
      croppedImage: request.croppedImage,
      currentValue: request.currentValue,
    });
  }

  if (!outcome.output) {
    await incrementBlockedUsage(request.workspaceId, periodMonth);
    return { blocked: true, reason: outcome.reason || 'provider-failed' };
  }

  await incrementSuccessfulUsage({
    workspaceId: request.workspaceId,
    periodMonth,
    costUsd: estimatedCost,
  });

  return {
    blocked: false,
    reason: 'ok',
    value: outcome.output.value,
    confidence: outcome.output.confidence,
  };
}
