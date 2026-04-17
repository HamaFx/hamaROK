import { describe, expect, it } from 'vitest';
import {
  analyzeRankingMetricGrouping,
  evaluateRankingMetricDigitCountPlausibility,
  evaluateRankingMetricUniformity,
  extractRankingMetricDigits,
  isRankingHeaderNameToken,
  normalizeMetricLabel,
  normalizeRankingTypeLabel,
} from '@/lib/ocr/ocr-engine';

describe('ranking OCR guard helpers', () => {
  it('maps OCR-noisy headers and metrics to strict board pairs', () => {
    expect(normalizeRankingTypeLabel('MADSCIENTIST RANKINGS')).toBe('mad_scientist');
    expect(normalizeRankingTypeLabel('KILLPOINTS RANKINGS')).toBe('kill_point');
    expect(normalizeMetricLabel('Tech Contribution')).toBe('contribution_points');
    expect(normalizeMetricLabel('Forts Destroyed')).toBe('fort_destroying');
  });

  it('rejects label-only metric text without raw digits', () => {
    const labelOnly = extractRankingMetricDigits('Contribution Points');
    expect(labelOnly.hasRawDigit).toBe(false);
    expect(labelOnly.digits).toBe('');

    const numeric = extractRankingMetricDigits('1O8,2S3');
    expect(numeric.hasRawDigit).toBe(true);
    expect(numeric.digits).toBe('108253');
    expect(numeric.hasSeparatorHint).toBe(true);
    expect(numeric.separatorGroupingValid).toBe(true);
  });

  it('tracks comma-like grouping plausibility for metric strings', () => {
    const valid = analyzeRankingMetricGrouping('54,268,607');
    expect(valid.hasSeparatorHint).toBe(true);
    expect(valid.separatorGroupingValid).toBe(true);

    const invalid = analyzeRankingMetricGrouping("54'26 8607");
    expect(invalid.hasSeparatorHint).toBe(true);
    expect(invalid.separatorGroupingValid).toBe(false);
  });

  it('flags ranking header tokens used as player names', () => {
    expect(isRankingHeaderNameToken('Name')).toBe(true);
    expect(isRankingHeaderNameToken('Contribution Points')).toBe(true);
    expect(isRankingHeaderNameToken('Monkey D Luffy')).toBe(false);
  });

  it('detects suspiciously uniform metrics while allowing normal variation', () => {
    const suspicious = evaluateRankingMetricUniformity(
      ['777777', '777777', '777777', '777777', '700001'],
      {
        dominanceRatio: 0.75,
        dominanceMinCount: 4,
      }
    );
    expect(suspicious.suspicious).toBe(true);

    const normal = evaluateRankingMetricUniformity(
      ['781234', '779100', '776500', '772200', '769999'],
      {
        dominanceRatio: 0.75,
        dominanceMinCount: 4,
      }
    );
    expect(normal.suspicious).toBe(false);
  });

  it('flags digit-length outliers for individual power metrics', () => {
    const plausibility = evaluateRankingMetricDigitCountPlausibility([
      '54268607',
      '53712011',
      '54890765',
      '526807',
    ]);

    expect(plausibility.baselineDigits).toBe(8);
    expect(plausibility.outlierIndices).toEqual([3]);
  });
});
