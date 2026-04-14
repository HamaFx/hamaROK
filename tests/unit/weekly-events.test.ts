import { describe, expect, it } from 'vitest';
import { getWeekIdentity, getWeekIdentityFromKey, parseWeekKey } from '@/lib/weekly-events';

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
});

