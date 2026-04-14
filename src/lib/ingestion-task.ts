import { IngestionDomain, IngestionTaskStatus } from '@prisma/client';

export const MAX_INGESTION_ATTEMPTS = 3;

export type IngestionArchetypeHint = 'governor_profile' | 'ranking_board' | 'unknown';

export function normalizeArchetypeHint(value?: string | null): IngestionArchetypeHint {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');

  if (normalized.includes('profile')) return 'governor_profile';
  if (normalized.includes('ranking')) return 'ranking_board';
  return 'unknown';
}

export function deriveIngestionDomainFromArchetype(
  archetype: IngestionArchetypeHint
): IngestionDomain {
  return archetype === 'ranking_board'
    ? IngestionDomain.RANKING_CAPTURE
    : IngestionDomain.PROFILE_SNAPSHOT;
}

export function canTransitionTaskStatus(
  current: IngestionTaskStatus,
  next: IngestionTaskStatus
): boolean {
  if (current === next) return true;

  switch (current) {
    case IngestionTaskStatus.QUEUED:
      return next === IngestionTaskStatus.PROCESSING || next === IngestionTaskStatus.FAILED;
    case IngestionTaskStatus.PROCESSING:
      return next === IngestionTaskStatus.QUEUED || next === IngestionTaskStatus.COMPLETED || next === IngestionTaskStatus.FAILED;
    case IngestionTaskStatus.COMPLETED:
      return false;
    case IngestionTaskStatus.FAILED:
      return next === IngestionTaskStatus.QUEUED;
    default:
      return false;
  }
}

export function nextFailureStatus(
  attemptCount: number,
  maxAttempts = MAX_INGESTION_ATTEMPTS
): IngestionTaskStatus {
  return attemptCount >= maxAttempts
    ? IngestionTaskStatus.FAILED
    : IngestionTaskStatus.QUEUED;
}

export function taskStatusLabel(status: IngestionTaskStatus): string {
  switch (status) {
    case IngestionTaskStatus.QUEUED:
      return 'Queued';
    case IngestionTaskStatus.PROCESSING:
      return 'Processing';
    case IngestionTaskStatus.COMPLETED:
      return 'Completed';
    case IngestionTaskStatus.FAILED:
      return 'Failed';
    default:
      return status;
  }
}
