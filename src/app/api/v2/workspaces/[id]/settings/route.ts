import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, handleApiError, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import {
  FALLBACK_OCR_PROVIDER_VALUES,
  getDefaultFallbackOcrModel,
  normalizeFallbackOcrProvider,
} from '@/lib/ocr/fallback-config';
import {
  DEFAULT_WEEK_RESET_UTC_OFFSET,
  normalizeWeekResetUtcOffset,
} from '@/lib/weekly-events';

const fallbackProviderSchema = z
  .string()
  .min(1)
  .max(40)
  .transform((value) => normalizeFallbackOcrProvider(value))
  .refine((value): value is (typeof FALLBACK_OCR_PROVIDER_VALUES)[number] => value != null, {
    message: `fallbackOcrProvider must be one of: ${FALLBACK_OCR_PROVIDER_VALUES.join(', ')}`,
  });

const settingsSchema = z.object({
  t4Weight: z.number().min(0).max(20),
  t5Weight: z.number().min(0).max(20),
  deadWeight: z.number().min(0).max(30),
  kpPerPowerRatio: z.number().min(0).max(2),
  deadPerPowerRatio: z.number().min(0).max(1),
  discordWebhook: z.string().url().optional().or(z.literal('')),
  fallbackOcrEnabled: z.boolean().optional(),
  fallbackOcrDailyLimit: z.number().int().min(1).max(5000).optional(),
  fallbackOcrMonthlyBudgetUsd: z.number().min(0).max(1000).optional(),
  fallbackOcrProvider: fallbackProviderSchema.optional(),
  fallbackOcrModel: z.string().min(1).max(80).optional(),
  featureAdbCaptureRnd: z.boolean().optional(),
  weekResetUtcOffset: z
    .string()
    .min(6)
    .max(6)
    .transform((value) => normalizeWeekResetUtcOffset(value))
    .refine((value): value is string => value != null, {
      message: 'weekResetUtcOffset must match format +HH:MM or -HH:MM.',
    })
    .optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params;
    const auth = await authorizeWorkspaceAccess(
      request,
      workspaceId,
      WorkspaceRole.VIEWER
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const settings = await prisma.workspaceSettings.findUnique({
      where: { workspaceId },
    });

    if (!settings) {
      return fail('NOT_FOUND', 'Workspace settings not found.', 404);
    }

    return ok({
      ...settings,
      discordWebhook: settings.discordWebhook || null,
      updatedAt: settings.updatedAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params;
    const auth = await authorizeWorkspaceAccess(
      request,
      workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const body = settingsSchema.parse(await readJson(request));
    const requestedProvider = body.fallbackOcrProvider ?? undefined;
    const requestedModel = body.fallbackOcrModel?.trim() || undefined;
    const defaultProvider = 'google_vision' as const;

    const settings = await prisma.workspaceSettings.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        t4Weight: body.t4Weight,
        t5Weight: body.t5Weight,
        deadWeight: body.deadWeight,
        kpPerPowerRatio: body.kpPerPowerRatio,
        deadPerPowerRatio: body.deadPerPowerRatio,
        discordWebhook: body.discordWebhook?.trim() || null,
        fallbackOcrEnabled: body.fallbackOcrEnabled ?? true,
        fallbackOcrDailyLimit: body.fallbackOcrDailyLimit ?? 50,
        fallbackOcrMonthlyBudgetUsd: body.fallbackOcrMonthlyBudgetUsd ?? 5,
        fallbackOcrProvider: requestedProvider || defaultProvider,
        fallbackOcrModel:
          requestedModel ||
          getDefaultFallbackOcrModel(requestedProvider || defaultProvider),
        featureAdbCaptureRnd: body.featureAdbCaptureRnd ?? false,
        weekResetUtcOffset: body.weekResetUtcOffset || DEFAULT_WEEK_RESET_UTC_OFFSET,
      },
      update: {
        t4Weight: body.t4Weight,
        t5Weight: body.t5Weight,
        deadWeight: body.deadWeight,
        kpPerPowerRatio: body.kpPerPowerRatio,
        deadPerPowerRatio: body.deadPerPowerRatio,
        discordWebhook: body.discordWebhook?.trim() || null,
        fallbackOcrEnabled: body.fallbackOcrEnabled ?? undefined,
        fallbackOcrDailyLimit: body.fallbackOcrDailyLimit ?? undefined,
        fallbackOcrMonthlyBudgetUsd:
          body.fallbackOcrMonthlyBudgetUsd ?? undefined,
        fallbackOcrProvider: requestedProvider,
        fallbackOcrModel:
          requestedModel ||
          (requestedProvider ? getDefaultFallbackOcrModel(requestedProvider) : undefined),
        featureAdbCaptureRnd: body.featureAdbCaptureRnd ?? undefined,
        weekResetUtcOffset: body.weekResetUtcOffset ?? undefined,
      },
    });

    return ok({
      ...settings,
      discordWebhook: settings.discordWebhook || null,
      updatedAt: settings.updatedAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
