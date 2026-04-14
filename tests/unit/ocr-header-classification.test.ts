import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeMetricLabel,
  normalizeRankingTypeLabel,
} from '@/lib/ocr/ocr-engine';
import { validateStrictRankingTypeMetricPair } from '@/lib/rankings/normalize';

interface SampleManifestEntry {
  file: string;
  headerText: string;
  metricLabel: string;
  expectedArchetype: 'rankboard' | 'governor-profile';
  expectedRankingType: string;
  expectedMetricKey: string;
}

describe('OCR header classification fixtures', () => {
  it('keeps sample screenshot fixtures aligned with strict ranking classification', () => {
    const fixturePath = resolve(
      process.cwd(),
      'tests/fixtures/ocr/sample-screenshot-manifest.json'
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as SampleManifestEntry[];

    expect(fixture.length).toBe(5);

    for (const entry of fixture) {
      const samplePath = resolve(process.cwd(), entry.file);
      expect(existsSync(samplePath)).toBe(true);

      const rankingType = normalizeRankingTypeLabel(entry.headerText);
      const metricKey = normalizeMetricLabel(entry.metricLabel);
      expect(rankingType).toBe(entry.expectedRankingType);
      expect(metricKey).toBe(entry.expectedMetricKey);

      if (entry.expectedArchetype === 'rankboard') {
        const strictPair = validateStrictRankingTypeMetricPair(
          entry.expectedRankingType,
          entry.expectedMetricKey
        );
        expect(strictPair.ok).toBe(true);
      }
    }
  });
});
