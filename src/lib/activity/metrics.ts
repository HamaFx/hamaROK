import { z } from 'zod';

export const WEEKLY_METRIC_KEYS = [
  'power_growth',
  'contribution_points',
  'fort_destroying',
  'kill_points_growth',
] as const;

export type WeeklyMetricKey = (typeof WEEKLY_METRIC_KEYS)[number];

export const weeklyMetricKeySchema = z.enum(WEEKLY_METRIC_KEYS);

export function isWeeklyMetricKey(value: string): value is WeeklyMetricKey {
  return (WEEKLY_METRIC_KEYS as readonly string[]).includes(value);
}
