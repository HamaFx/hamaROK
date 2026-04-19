import { describe, expect, it } from 'vitest';
import { buildAdaptiveContextPack } from '@/lib/assistant/context-engine';

describe('assistant context engine', () => {
  it('drops all sources in prompt_only mode', () => {
    const packed = buildAdaptiveContextPack({
      callsite: 'assistant_planner',
      preset: 'balanced',
      mode: 'prompt_only',
      sources: [
        {
          id: 'a',
          title: 'A',
          content: 'hello world',
          priority: 10,
        },
      ],
    });

    expect(packed.text).toBe('');
    expect(packed.diagnostics.selectedSources).toHaveLength(0);
    expect(packed.diagnostics.droppedSources).toHaveLength(1);
  });

  it('keeps critical sources and summarizes overflow', () => {
    const packed = buildAdaptiveContextPack({
      callsite: 'ingestion_extraction',
      preset: 'conservative',
      mode: 'smart',
      sources: [
        {
          id: 'critical',
          title: 'Critical',
          content: 'x'.repeat(1200),
          critical: true,
          priority: 100,
        },
        {
          id: 'table',
          title: 'Table',
          content: 'y'.repeat(9000),
          summary: 'table-summary',
          priority: 70,
        },
      ],
    });

    expect(packed.diagnostics.selectedSources.some((row) => row.id === 'critical')).toBe(true);
    expect(packed.text).toContain('[Critical]');
    expect(packed.diagnostics.estimatedTokens).toBeLessThanOrEqual(
      packed.diagnostics.budgetTokens
    );
  });
});

