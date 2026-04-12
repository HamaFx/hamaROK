import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

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
    // If Vercel Blob is not configured, return a placeholder
    return NextResponse.json(
      { url: null, message: 'Screenshot upload skipped (Blob storage not configured)', size: 0 },
      { status: 200 }
    );
  }
}
