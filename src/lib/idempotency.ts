import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiHttpError } from '@/lib/api-response';
import { createScopedKeyHash, hashRequestPayload } from '@/lib/security';

function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, item) =>
      typeof item === 'bigint' ? item.toString() : item
    )
  ) as T;
}

interface IdempotencyOptions<T> {
  workspaceId: string;
  scope: string;
  key?: string | null;
  request: unknown;
  ttlHours?: number;
  execute: () => Promise<T>;
}

function createIdempotencyConflictError(
  reason: 'PAYLOAD_MISMATCH' | 'IN_PROGRESS'
): ApiHttpError {
  if (reason === 'PAYLOAD_MISMATCH') {
    return new ApiHttpError(
      'CONFLICT',
      'Idempotency key was already used with a different request payload.',
      409,
      {
        reason: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
      },
      true,
      {
        source: 'idempotency',
        retryable: false,
        category: 'conflict',
        hints: ['Use a new idempotency key when request payload differs.'],
      }
    );
  }

  return new ApiHttpError(
    'CONFLICT',
    'Request with this idempotency key is already in progress.',
    409,
    {
      reason: 'IDEMPOTENCY_IN_PROGRESS',
    },
    true,
    {
      source: 'idempotency',
      retryable: true,
      retryAfterMs: 1200,
      category: 'conflict',
      hints: ['Retry using the same idempotency key after a short delay.'],
    }
  );
}

export async function withIdempotency<T>({
  workspaceId,
  scope,
  key,
  request,
  ttlHours = 24,
  execute,
}: IdempotencyOptions<T>): Promise<{ value: T; replayed: boolean }> {
  if (!key) {
    const value = await execute();
    return { value, replayed: false };
  }

  const keyHash = createScopedKeyHash(workspaceId, scope, key);
  const requestHash = hashRequestPayload(request);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  let reserved = false;
  try {
    await prisma.idempotencyKey.create({
      data: {
        workspaceId,
        scope,
        keyHash,
        requestHash,
        response: Prisma.JsonNull,
        expiresAt,
      },
    });
    reserved = true;
  } catch (error) {
    const prismaCode =
      error && typeof error === 'object'
        ? (error as { code?: unknown }).code
        : null;
    const isUniqueViolation = String(prismaCode || '') === 'P2002';
    if (!isUniqueViolation) {
      throw error;
    }
  }

  if (!reserved) {
    const existing = await prisma.idempotencyKey.findUnique({
      where: {
        workspaceId_scope_keyHash: {
          workspaceId,
          scope,
          keyHash,
        },
      },
    });

    if (existing && existing.expiresAt > now) {
      if (existing.requestHash !== requestHash) {
        throw createIdempotencyConflictError('PAYLOAD_MISMATCH');
      }
      if (existing.response) {
        return {
          value: existing.response as T,
          replayed: true,
        };
      }
      throw createIdempotencyConflictError('IN_PROGRESS');
    }

    const reclaimed = await prisma.idempotencyKey.updateMany({
      where: {
        workspaceId,
        scope,
        keyHash,
        expiresAt: { lte: now },
      },
      data: {
        requestHash,
        response: Prisma.JsonNull,
        expiresAt,
      },
    });
    reserved = reclaimed.count > 0;

    if (!reserved) {
      const latest = await prisma.idempotencyKey.findUnique({
        where: {
          workspaceId_scope_keyHash: {
            workspaceId,
            scope,
            keyHash,
          },
        },
      });
      if (latest?.response && latest.requestHash === requestHash && latest.expiresAt > now) {
        return {
          value: latest.response as T,
          replayed: true,
        };
      }
      throw createIdempotencyConflictError('IN_PROGRESS');
    }
  }

  try {
    const value = await execute();
    const response = toJsonSafe(value) as Prisma.InputJsonValue;

    await prisma.idempotencyKey.update({
      where: {
        workspaceId_scope_keyHash: {
          workspaceId,
          scope,
          keyHash,
        },
      },
      data: {
        requestHash,
        response,
        expiresAt,
      },
    });

    return {
      value,
      replayed: false,
    };
  } catch (error) {
    await prisma.idempotencyKey.updateMany({
      where: {
        workspaceId,
        scope,
        keyHash,
        requestHash,
        response: {
          equals: Prisma.JsonNull,
        },
      },
      data: {
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    throw error;
  }
}

export async function cleanupExpiredIdempotencyKeys() {
  const result = await prisma.idempotencyKey.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  return result.count;
}

export { createIdempotencyConflictError };
