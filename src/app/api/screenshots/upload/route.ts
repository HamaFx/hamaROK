import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { assertBlobConfigured } from '@/lib/env';

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

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Only PNG, JPEG, and WEBP images are allowed' } },
        { status: 400 }
      );
    }

    assertBlobConfigured();

    const blob = await put(`screenshots/${Date.now()}-${file.name}`, file, {
      access: 'public',
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
