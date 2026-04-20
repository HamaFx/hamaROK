import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { fail, handleApiError } from '@/lib/api-response';
import { assertBlobConfigured } from '@/lib/env';

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
]);

function normalizeImageMimeType(raw: string, fileName?: string | null): string {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase();
  const base = normalized.split(';', 1)[0].trim();
  if (base === 'image/jpg') return 'image/jpeg';
  if (ALLOWED_IMAGE_TYPES.has(base)) return base;
  const name = String(fileName || '').toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.heic')) return 'image/heic';
  if (name.endsWith('.heif')) return 'image/heif';
  if (name.endsWith('.avif')) return 'image/avif';
  return base;
}

function buildRequestId(): string {
  const globalCrypto = globalThis.crypto as Crypto | undefined;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return fail('VALIDATION_ERROR', 'No file provided', 400, undefined, {
        category: 'validation',
        source: 'blob',
        retryable: false,
      });
    }

    const mimeType = normalizeImageMimeType(file.type, file.name);
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      return fail(
        'VALIDATION_ERROR',
        'Only PNG, JPEG, WEBP, HEIC, HEIF, and AVIF images are allowed',
        400,
        { mimeType, fileName: file.name },
        {
          category: 'validation',
          source: 'blob',
          retryable: false,
        }
      );
    }

    assertBlobConfigured();

    const blob = await put(`screenshots/${Date.now()}-${file.name}`, file, {
      access: 'public',
      contentType: mimeType,
    });

    const response = NextResponse.json({
      url: blob.url,
      size: file.size,
      uploadedAt: new Date().toISOString(),
    });
    response.headers.set('X-Request-Id', buildRequestId());
    return response;
  } catch (error) {
    console.error('POST /api/screenshots/upload error:', error);
    const rawMessage =
      error instanceof Error ? error.message : 'Failed to upload screenshot';
    const quotaExceeded = /quota|limit exceeded|storage exceeds/i.test(rawMessage);
    const message = quotaExceeded
      ? 'Storage exceeds free quota (1GB). Delete older screenshots and retry.'
      : rawMessage;
    if (quotaExceeded) {
      return fail(
        'INTERNAL_ERROR',
        message,
        507,
        {
          reason: 'STORAGE_QUOTA_EXCEEDED',
        },
        {
          category: 'storage',
          source: 'blob',
          retryable: false,
          hints: ['Run storage cleanup and retry upload.'],
        }
      );
    }
    return handleApiError(error);
  }
}
