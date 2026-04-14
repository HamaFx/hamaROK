import { describe, expect, it } from 'vitest';
import {
  getWeekIdentity,
  getWeekIdentityFromKey,
  normalizeWeekResetUtcOffset,
  parseWeekKey,
} from '@/lib/weekly-events';

describe('weekly event helpers', () => {
  it('computes ISO week key at Monday UTC boundary', () => {
    const monday = new Date('2026-04-13T00:00:00.000Z');
    const sunday = new Date('2026-04-19T23:59:59.000Z');

    const mondayWeek = getWeekIdentity(monday);
    const sundayWeek = getWeekIdentity(sunday);

    expect(mondayWeek.weekKey).toBe(sundayWeek.weekKey);
    expect(mondayWeek.startsAt.toISOString()).toBe('2026-04-13T00:00:00.000Z');
  });

  it('parses and rehydrates week key ranges', () => {
    const parsed = parseWeekKey('2026-W15');
    expect(parsed).toEqual({ isoYear: 2026, isoWeek: 15 });

    const identity = getWeekIdentityFromKey('2026-W15');
    expect(identity?.weekKey).toBe('2026-W15');
    expect(identity?.startsAt.toISOString()).toBe('2026-04-06T00:00:00.000Z');
    expect(identity?.endsAt.toISOString()).toBe('2026-04-13T00:00:00.000Z');
  });

  it('rejects invalid week keys', () => {
    expect(parseWeekKey('2026-15')).toBeNull();
    expect(parseWeekKey('abc')).toBeNull();
    expect(getWeekIdentityFromKey('2026-W77')).toBeNull();
  });

  it('supports custom game reset UTC offsets', () => {
    const boundary = new Date('2026-04-13T00:30:00.000Z');
    const identityUtc = getWeekIdentity(boundary, '+00:00');
    const identityPlus3 = getWeekIdentity(boundary, '+03:00');
    const identityMinus5 = getWeekIdentity(boundary, '-05:00');

    expect(identityUtc.weekKey).toBe('2026-W16');
    expect(identityPlus3.weekKey).toBe('2026-W16');
    expect(identityMinus5.weekKey).toBe('2026-W15');
    expect(identityPlus3.weekResetUtcOffset).toBe('+03:00');
  });

  it('normalizes valid offsets and rejects invalid formats', () => {
    expect(normalizeWeekResetUtcOffset('+3:00')).toBeNull();
    expect(normalizeWeekResetUtcOffset('+03:00')).toBe('+03:00');
    expect(normalizeWeekResetUtcOffset('-05:30')).toBe('-05:30');
    expect(normalizeWeekResetUtcOffset('+15:00')).toBeNull();
  });
});
