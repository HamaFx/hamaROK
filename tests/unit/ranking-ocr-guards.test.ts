import { describe, expect, it } from 'vitest';
import {
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
});
