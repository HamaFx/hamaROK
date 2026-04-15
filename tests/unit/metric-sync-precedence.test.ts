import { describe, expect, it } from 'vitest';
import { compareObservationPrecedence } from '@/lib/metric-sync';

describe('metric observation precedence', () => {
  it('prefers newer observation timestamps', () => {
    const older = {
      metricValue: BigInt(900),
      observedAt: new Date('2026-04-10T10:00:00.000Z'),
      sourceRefId: 'old',
    };
    const newer = {
      metricValue: BigInt(100),
      observedAt: new Date('2026-04-11T10:00:00.000Z'),
      sourceRefId: 'new',
    };

    expect(compareObservationPrecedence(older, newer)).toBe(1);
    expect(compareObservationPrecedence(newer, older)).toBe(-1);
  });

  it('uses larger metric value as tie-breaker when timestamps match', () => {
    const current = {
      metricValue: BigInt(1000),
      observedAt: new Date('2026-04-11T10:00:00.000Z'),
      sourceRefId: 'a',
    };
    const incoming = {
      metricValue: BigInt(1500),
      observedAt: new Date('2026-04-11T10:00:00.000Z'),
      sourceRefId: 'b',
    };

    expect(compareObservationPrecedence(current, incoming)).toBe(1);
  });

  it('uses stable sourceRefId ordering as final tie-breaker', () => {
    const current = {
      metricValue: BigInt(1000),
      observedAt: new Date('2026-04-11T10:00:00.000Z'),
      sourceRefId: 'ref-a',
    };
    const incomingHigherRef = {
      metricValue: BigInt(1000),
      observedAt: new Date('2026-04-11T10:00:00.000Z'),
      sourceRefId: 'ref-b',
    };
    const incomingSameRef = {
      metricValue: BigInt(1000),
      observedAt: new Date('2026-04-11T10:00:00.000Z'),
      sourceRefId: 'ref-a',
    };

    expect(compareObservationPrecedence(current, incomingHigherRef)).toBe(1);
    expect(compareObservationPrecedence(current, incomingSameRef)).toBe(0);
  });
});
