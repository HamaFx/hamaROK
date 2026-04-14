export type WeeklyMetricComplianceStatus =
  | 'PASS'
  | 'FAIL'
  | 'NO_STANDARD'
  | 'NO_BASELINE';

export function deriveOverallComplianceStatus(
  statuses: WeeklyMetricComplianceStatus[]
): 'PASS' | 'FAIL' | 'PARTIAL' | 'NO_STANDARD' {
  if (statuses.some((status) => status === 'FAIL')) return 'FAIL';
  if (statuses.every((status) => status === 'PASS')) return 'PASS';
  if (statuses.some((status) => status === 'PASS')) return 'PARTIAL';
  return 'NO_STANDARD';
}
