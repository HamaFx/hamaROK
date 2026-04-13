export const FALLBACK_OCR_PROVIDER_VALUES = ['google_vision', 'openai'] as const;

export type FallbackOcrProvider = (typeof FALLBACK_OCR_PROVIDER_VALUES)[number];

const PROVIDER_ALIASES: Record<string, FallbackOcrProvider> = {
  openai: 'openai',
  google_vision: 'google_vision',
  'google-vision': 'google_vision',
  googlevision: 'google_vision',
};

export function normalizeFallbackOcrProvider(
  value: string | null | undefined
): FallbackOcrProvider | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return PROVIDER_ALIASES[normalized] ?? null;
}

export function getDefaultFallbackOcrModel(provider: FallbackOcrProvider): string {
  if (provider === 'google_vision') {
    return 'DOCUMENT_TEXT_DETECTION';
  }
  return 'gpt-5-mini';
}

export function getFallbackOcrEstimatedCostUsd(provider: FallbackOcrProvider): number {
  if (provider === 'google_vision') {
    // Vision OCR list price is $1.50 / 1000 units for text detection tiers.
    return 0.0015;
  }
  return 0.0035;
}
