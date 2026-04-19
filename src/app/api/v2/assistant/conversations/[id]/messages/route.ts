import { put } from '@vercel/blob';
import { ArtifactType, Prisma, WorkspaceRole } from '@prisma/client';
import { NextRequest } from 'next/server';
import { fail, handleApiError, ok, requireParam } from '@/lib/api-response';
import { withIdempotency } from '@/lib/idempotency';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { prisma } from '@/lib/prisma';
import {
  listAssistantConversationMessages,
  postAssistantMessage,
  type AssistantAnalyzerMode,
  type AssistantAttachmentInput,
} from '@/lib/assistant/service';

export const runtime = 'nodejs';
export const maxDuration = 300;

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

async function storeAssistantImage(args: {
  workspaceId: string;
  conversationId: string;
  accessLinkId: string;
  file: File;
}): Promise<AssistantAttachmentInput> {
  const mimeType = args.file.type || 'image/png';
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new Error('Only PNG, JPEG, and WEBP images are supported for assistant messages.');
  }

  const bytes = Buffer.from(await args.file.arrayBuffer());
  const base64 = bytes.toString('base64');

  let url = `data:${mimeType};base64,${base64}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const safeName = String(args.file.name || 'attachment')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .slice(0, 100);

    const blob = await put(
      `assistant/${args.workspaceId}/${Date.now()}-${safeName || 'image'}`,
      bytes,
      {
        access: 'public',
        contentType: mimeType,
      }
    );
    url = blob.url;
  }

  const artifact = await prisma.artifact.create({
    data: {
      workspaceId: args.workspaceId,
      type: ArtifactType.SCREENSHOT,
      url,
      bytes: bytes.byteLength,
      metadata: {
        source: 'assistant',
        conversationId: args.conversationId,
        uploadedByLinkId: args.accessLinkId,
        fileName: args.file.name,
        mimeType,
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      url: true,
    },
  });

  return {
    artifactId: artifact.id,
    url: artifact.url,
    fileName: args.file.name || 'assistant-image',
    mimeType,
    sizeBytes: bytes.byteLength,
    base64,
  };
}

async function hydrateAssistantArtifactAttachment(args: {
  workspaceId: string;
  artifactId: string;
}): Promise<AssistantAttachmentInput> {
  const artifact = await prisma.artifact.findFirst({
    where: {
      id: args.artifactId,
      workspaceId: args.workspaceId,
    },
    select: {
      id: true,
      url: true,
      bytes: true,
      metadata: true,
    },
  });

  if (!artifact?.url) {
    throw new Error(`Artifact ${args.artifactId} is missing or inaccessible.`);
  }

  const response = await fetch(artifact.url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to download artifact ${args.artifactId} (${response.status}).`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const metadata = artifact.metadata && typeof artifact.metadata === 'object'
    ? (artifact.metadata as Record<string, unknown>)
    : {};
  const mimeType = String(
    metadata.mimeType ||
      response.headers.get('content-type') ||
      'image/png'
  ).toLowerCase();

  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new Error(`Artifact ${args.artifactId} is not a supported assistant image type.`);
  }

  return {
    artifactId: artifact.id,
    url: artifact.url,
    fileName: String(metadata.fileName || `artifact-${artifact.id.slice(-8)}.png`),
    mimeType,
    sizeBytes: artifact.bytes || bytes.byteLength,
    base64: bytes.toString('base64'),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const workspaceId = requireParam(
      new URL(request.url).searchParams.get('workspaceId'),
      'workspaceId'
    );

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const history = await listAssistantConversationMessages({
      workspaceId,
      conversationId,
      accessLink: auth.link,
    });

    return ok(history);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return fail(
        'VALIDATION_ERROR',
        'Assistant message endpoint requires multipart/form-data.',
        400
      );
    }

    const { id: conversationId } = await params;
    const formData = await request.formData();

    const workspaceId = String(formData.get('workspaceId') || '').trim();
    if (!workspaceId) {
      return fail('VALIDATION_ERROR', 'workspaceId is required.', 400);
    }

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.VIEWER);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const text = String(formData.get('text') || '').trim();

    const files: File[] = [];
    for (const value of formData.values()) {
      if (value instanceof File && value.size > 0) {
        files.push(value);
      }
    }
    const artifactIds = formData
      .getAll('artifactId')
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const uniqueArtifactIds = [...new Set(artifactIds)];
    const idempotencyKeyRaw = String(formData.get('idempotencyKey') || '').trim();
    const idempotencyKey = idempotencyKeyRaw ? idempotencyKeyRaw.slice(0, 120) : null;
    const analyzerModeRaw = String(formData.get('analyzerMode') || '')
      .trim()
      .toLowerCase();
    const analyzerMode: AssistantAnalyzerMode | null =
      analyzerModeRaw === 'hybrid' ||
      analyzerModeRaw === 'ocr_pipeline' ||
      analyzerModeRaw === 'vision_model'
        ? analyzerModeRaw
        : null;

    if (!text && files.length === 0 && artifactIds.length === 0) {
      return fail('VALIDATION_ERROR', 'text or image attachment is required.', 400);
    }

    if (files.length + uniqueArtifactIds.length > 6) {
      return fail('VALIDATION_ERROR', 'At most 6 image attachments are allowed per message.', 400);
    }

    const idempotent = await withIdempotency({
      workspaceId,
      scope: `assistant:message:${conversationId}:${auth.link.id}`,
      key: idempotencyKey,
      request: {
        conversationId,
        text,
        analyzerMode,
        artifactIds: uniqueArtifactIds,
        files: files.map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
        })),
      },
      ttlHours: 24,
      execute: async () => {
        const attachments: AssistantAttachmentInput[] = [];
        for (const file of files) {
          const stored = await storeAssistantImage({
            workspaceId,
            conversationId,
            accessLinkId: auth.link.id,
            file,
          });
          attachments.push(stored);
        }

        for (const artifactId of uniqueArtifactIds) {
          const hydrated = await hydrateAssistantArtifactAttachment({
            workspaceId,
            artifactId,
          });
          attachments.push(hydrated);
        }

        return postAssistantMessage({
          workspaceId,
          conversationId,
          accessLink: auth.link,
          text,
          attachments,
          analyzerMode,
        });
      },
    });

    return ok(
      idempotent.value,
      idempotent.replayed ? { idempotentReplay: true } : null,
      idempotent.replayed ? 200 : 201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
