import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateGoldenSuite, GoldenOcrCase } from '@/lib/ocr/regression';

describe('OCR golden regression suite', () => {
  it('meets field-level and average confidence thresholds', () => {
    const fixturePath = resolve(process.cwd(), 'tests/fixtures/ocr/golden-profiles.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as GoldenOcrCase[];

    const result = evaluateGoldenSuite(fixture, {
      numericExactMatchThreshold: 0.98,
    });

    expect(result.total).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
    expect(result.numericThresholdPassed).toBe(true);
  });
});
