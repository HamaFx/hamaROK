import { WorkspaceSettings } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const DEFAULT_ESTIMATED_COST_USD = 0.0035;

export interface FallbackProviderRequest {
  workspaceId: string;
  fieldKey: string;
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

function getPeriodMonth(date = new Date()): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
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
  fieldKey: string;
  croppedImage: string;
  currentValue: string;
}): Promise<{ value: string; confidence: number } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const instruction = [
    `Read OCR for field "${args.fieldKey}".`,
    'Return only the value with no explanation.',
    args.fieldKey === 'governorName'
      ? 'Allowed language profile: English letters/numbers/symbols.'
      : 'Return digits only.',
    `Current OCR guess: ${args.currentValue || '(empty)'}.`,
  ].join(' ');

  const response = await fetch('https://api.openai.com/v1/responses', {
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

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const text = extractResponseText(payload);
  if (!text) return null;
  return { value: text, confidence: 88 };
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

  const usage = await prisma.ocrFallbackUsage.findUnique({
    where: {
      workspaceId_periodMonth: {
        workspaceId: request.workspaceId,
        periodMonth,
      },
    },
  });

  const projected = usage?.projectedUsd ?? 0;
  const estimatedCost = DEFAULT_ESTIMATED_COST_USD;
  if (projected + estimatedCost > budget) {
    await incrementBlockedUsage(request.workspaceId, periodMonth);
    return { blocked: true, reason: 'monthly-budget-exceeded' };
  }

  const provider = (request.settings?.fallbackOcrProvider || 'openai').toLowerCase();
  const model = request.settings?.fallbackOcrModel || 'gpt-5-mini';

  if (provider !== 'openai') {
    await incrementBlockedUsage(request.workspaceId, periodMonth);
    return { blocked: true, reason: `unsupported-provider:${provider}` };
  }

  const output = await callOpenAiVision({
    model,
    fieldKey: request.fieldKey,
    croppedImage: request.croppedImage,
    currentValue: request.currentValue,
  });

  if (!output) {
    await incrementBlockedUsage(request.workspaceId, periodMonth);
    return { blocked: true, reason: 'provider-failed' };
  }

  await incrementSuccessfulUsage({
    workspaceId: request.workspaceId,
    periodMonth,
    costUsd: estimatedCost,
  });

  return {
    blocked: false,
    reason: 'ok',
    value: output.value,
    confidence: output.confidence,
  };
}
