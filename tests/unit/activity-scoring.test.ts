import { describe, expect, it } from 'vitest';
import { deriveOverallComplianceStatus } from '@/lib/activity/scoring';

describe('activity scoring', () => {
  it('fails when any metric fails', () => {
    expect(
      deriveOverallComplianceStatus(['PASS', 'FAIL', 'NO_STANDARD', 'NO_BASELINE'])
    ).toBe('FAIL');
  });

  it('returns partial when pass exists but not all metrics pass', () => {
    expect(
      deriveOverallComplianceStatus(['PASS', 'NO_BASELINE', 'NO_STANDARD', 'PASS'])
    ).toBe('PARTIAL');
  });

  it('returns pass only when all metrics pass', () => {
    expect(deriveOverallComplianceStatus(['PASS', 'PASS', 'PASS', 'PASS'])).toBe('PASS');
  });

  it('returns no standard when no pass/fail metrics are present', () => {
    expect(
      deriveOverallComplianceStatus([
        'NO_BASELINE',
        'NO_BASELINE',
        'NO_STANDARD',
        'NO_STANDARD',
      ])
    ).toBe('NO_STANDARD');
  });
});
