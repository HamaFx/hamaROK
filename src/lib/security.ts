import crypto from 'node:crypto';
import { getAppSigningSecret } from '@/lib/env';

export function createOpaqueToken(size = 32): string {
  return crypto.randomBytes(size).toString('base64url');
}

export function hashAccessToken(token: string): string {
  const secret = getAppSigningSecret();
  return crypto
    .createHmac('sha256', secret)
    .update(token)
    .digest('hex');
}

export function hashDestination(value: string): string {
  const secret = getAppSigningSecret();
  return crypto
    .createHmac('sha256', secret)
    .update(value)
    .digest('hex');
}

export function createScopedKeyHash(
  workspaceId: string,
  scope: string,
  key: string
): string {
  return hashAccessToken(`${workspaceId}:${scope}:${key}`);
}

function stableStringify(input: unknown): string {
  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (input && typeof input === 'object') {
    const entries = Object.entries(input as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${entries
      .map(([key, value]) => `${JSON.stringify(key)}:${stableStringify(value)}`)
      .join(',')}}`;
  }

  return JSON.stringify(input);
}

export function hashRequestPayload(payload: unknown): string {
  const serialized = stableStringify(payload ?? {});
  return crypto.createHash('sha256').update(serialized).digest('hex');
}
