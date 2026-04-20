import { del, list } from '@vercel/blob';
import { getEnv } from '@/lib/env';

const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_DELETE_BATCH_SIZE = 100;
const DEFAULT_MAX_SCANNED = 5000;

type BlobRetentionPrefix = 'screenshots/' | 'assistant/';

export interface BlobCleanupResult {
  enabled: boolean;
  retentionDays: number;
  cutoffIso: string;
  scanned: number;
  deleted: number;
  errors: string[];
  prefixes: Array<{
    prefix: BlobRetentionPrefix;
    scanned: number;
    deleted: number;
  }>;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const parsed = new Date(String(value || ''));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export async function cleanupBlobRetention(args?: {
  retentionDays?: number;
  maxScanned?: number;
}): Promise<BlobCleanupResult> {
  const env = getEnv();
  const retentionDays = Math.max(1, Number(args?.retentionDays || DEFAULT_RETENTION_DAYS));
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const maxScanned = Math.max(100, Number(args?.maxScanned || DEFAULT_MAX_SCANNED));

  const result: BlobCleanupResult = {
    enabled: Boolean(env.BLOB_READ_WRITE_TOKEN),
    retentionDays,
    cutoffIso: cutoff.toISOString(),
    scanned: 0,
    deleted: 0,
    errors: [],
    prefixes: [],
  };

  if (!env.BLOB_READ_WRITE_TOKEN) {
    return result;
  }

  const prefixes: BlobRetentionPrefix[] = ['screenshots/', 'assistant/'];
  for (const prefix of prefixes) {
    let scannedForPrefix = 0;
    let deletedForPrefix = 0;
    let cursor: string | undefined;

    while (scannedForPrefix < maxScanned) {
      const response = await list({
        prefix,
        cursor,
        limit: 1000,
        token: env.BLOB_READ_WRITE_TOKEN,
      });
      cursor = response.cursor;
      const staleUrls: string[] = [];

      for (const blob of response.blobs) {
        const uploadedAt = toDate(blob.uploadedAt);
        scannedForPrefix += 1;
        if (!uploadedAt || uploadedAt >= cutoff) continue;
        staleUrls.push(blob.url);
        if (staleUrls.length >= DEFAULT_DELETE_BATCH_SIZE) {
          try {
            await del(staleUrls, { token: env.BLOB_READ_WRITE_TOKEN });
            deletedForPrefix += staleUrls.length;
          } catch (error) {
            result.errors.push(
              error instanceof Error
                ? error.message
                : `Failed deleting blob batch under ${prefix}.`
            );
          }
          staleUrls.length = 0;
        }
      }

      if (staleUrls.length > 0) {
        try {
          await del(staleUrls, { token: env.BLOB_READ_WRITE_TOKEN });
          deletedForPrefix += staleUrls.length;
        } catch (error) {
          result.errors.push(
            error instanceof Error
              ? error.message
              : `Failed deleting blob batch under ${prefix}.`
          );
        }
      }

      if (!response.hasMore || !cursor) break;
    }

    result.prefixes.push({
      prefix,
      scanned: scannedForPrefix,
      deleted: deletedForPrefix,
    });
    result.scanned += scannedForPrefix;
    result.deleted += deletedForPrefix;
  }

  return result;
}

export function getBlobRetentionDefaults() {
  return {
    retentionDays: DEFAULT_RETENTION_DAYS,
  };
}
