import { describe, expect, it } from 'vitest';
import { IngestionTaskStatus } from '@prisma/client';
import {
  canTransitionTaskStatus,
  deriveIngestionDomainFromArchetype,
  nextFailureStatus,
  normalizeArchetypeHint,
} from '@/lib/ingestion-task';

describe('ingestion-task helpers', () => {
  it('normalizes archetype hints and routes ingestion domain', () => {
    expect(normalizeArchetypeHint('GOVERNOR PROFILE')).toBe('governor_profile');
    expect(normalizeArchetypeHint('individual power rankings')).toBe('ranking_board');
    expect(normalizeArchetypeHint('something else')).toBe('unknown');

    expect(deriveIngestionDomainFromArchetype('governor_profile')).toBe('PROFILE_SNAPSHOT');
    expect(deriveIngestionDomainFromArchetype('ranking_board')).toBe('RANKING_CAPTURE');
  });

  it('enforces task state transition guardrails', () => {
    expect(canTransitionTaskStatus(IngestionTaskStatus.QUEUED, IngestionTaskStatus.PROCESSING)).toBe(true);
    expect(canTransitionTaskStatus(IngestionTaskStatus.QUEUED, IngestionTaskStatus.COMPLETED)).toBe(false);
    expect(canTransitionTaskStatus(IngestionTaskStatus.PROCESSING, IngestionTaskStatus.QUEUED)).toBe(true);
    expect(canTransitionTaskStatus(IngestionTaskStatus.PROCESSING, IngestionTaskStatus.FAILED)).toBe(true);
    expect(canTransitionTaskStatus(IngestionTaskStatus.COMPLETED, IngestionTaskStatus.QUEUED)).toBe(false);
  });

  it('returns queue/failed status based on retry attempts', () => {
    expect(nextFailureStatus(1, 3)).toBe(IngestionTaskStatus.QUEUED);
    expect(nextFailureStatus(2, 3)).toBe(IngestionTaskStatus.QUEUED);
    expect(nextFailureStatus(3, 3)).toBe(IngestionTaskStatus.FAILED);
  });
});
