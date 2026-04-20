import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'No file provided' } },
        { status: 400 }
      );
    }

    const mimeType = normalizeImageMimeType(file.type, file.name);
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Only PNG, JPEG, WEBP, HEIC, HEIF, and AVIF images are allowed',
          },
        },
        { status: 400 }
      );
    }

    assertBlobConfigured();

    const blob = await put(`screenshots/${Date.now()}-${file.name}`, file, {
      access: 'public',
      contentType: mimeType,
    });

    return NextResponse.json({
      url: blob.url,
      size: file.size,
      uploadedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('POST /api/screenshots/upload error:', error);
    const rawMessage =
      error instanceof Error ? error.message : 'Failed to upload screenshot';
    const quotaExceeded = /quota|limit exceeded|storage exceeds/i.test(rawMessage);
    const message = quotaExceeded
      ? 'Storage exceeds free quota (1GB). Delete older screenshots and retry.'
      : rawMessage;
    return NextResponse.json(
      {
        error: {
          code: quotaExceeded ? 'STORAGE_QUOTA_EXCEEDED' : 'INTERNAL_ERROR',
          message,
        },
      },
      { status: quotaExceeded ? 507 : 500 }
    );
  }
}
