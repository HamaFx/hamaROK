import { describe, expect, it } from 'vitest';
import {
  getDefaultFallbackOcrModel,
  getFallbackOcrEstimatedCostUsd,
  normalizeFallbackOcrProvider,
} from '@/lib/ocr/fallback-config';

describe('fallback OCR provider config', () => {
  it('normalizes provider aliases to canonical values', () => {
    expect(normalizeFallbackOcrProvider('openai')).toBe('openai');
    expect(normalizeFallbackOcrProvider('google_vision')).toBe('google_vision');
    expect(normalizeFallbackOcrProvider('google-vision')).toBe('google_vision');
    expect(normalizeFallbackOcrProvider('googlevision')).toBe('google_vision');
    expect(normalizeFallbackOcrProvider('  GOOGLE_VISION  ')).toBe('google_vision');
    expect(normalizeFallbackOcrProvider('unknown')).toBeNull();
  });

  it('provides provider-specific defaults', () => {
    expect(getDefaultFallbackOcrModel('openai')).toBe('gpt-5-mini');
    expect(getDefaultFallbackOcrModel('google_vision')).toBe(
      'DOCUMENT_TEXT_DETECTION'
    );
  });

  it('uses lower estimated cost for Google Vision text fallback', () => {
    expect(getFallbackOcrEstimatedCostUsd('google_vision')).toBeLessThan(
      getFallbackOcrEstimatedCostUsd('openai')
    );
  });
});
