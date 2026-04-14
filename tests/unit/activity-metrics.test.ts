import { describe, expect, it } from 'vitest';
import {
  isWeeklyMetricKey,
  WEEKLY_METRIC_KEYS,
  weeklyMetricKeySchema,
} from '@/lib/activity/metrics';

describe('activity metric key schema', () => {
  it('exposes all supported weekly metrics', () => {
    expect(WEEKLY_METRIC_KEYS).toEqual([
      'power_growth',
      'contribution_points',
      'fort_destroying',
      'kill_points_growth',
    ]);
  });

  it('accepts supported keys and rejects unknown keys', () => {
    expect(weeklyMetricKeySchema.safeParse('fort_destroying').success).toBe(true);
    expect(weeklyMetricKeySchema.safeParse('kill_points_growth').success).toBe(true);
    expect(weeklyMetricKeySchema.safeParse('unknown_metric').success).toBe(false);
    expect(isWeeklyMetricKey('power_growth')).toBe(true);
    expect(isWeeklyMetricKey('unknown_metric')).toBe(false);
  });
});
