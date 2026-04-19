import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSISTANT_CONFIG,
  buildAssistantInstructionText,
  normalizeAssistantConfig,
  normalizeThreadAssistantConfig,
  resolveAssistantAnalyzerMode,
} from '@/lib/assistant/config';

describe('assistant config', () => {
  it('applies defaults when config is missing or invalid', () => {
    const normalized = normalizeAssistantConfig({
      screenshotAnalyzerDefault: 'invalid-mode',
      batch: {
        threshold: -5,
      },
      readLimits: {
        maxToolsPerTurn: 0,
      },
    });

    expect(normalized).toEqual(DEFAULT_ASSISTANT_CONFIG);
  });

  it('resolves analyzer mode with message > thread > workspace precedence', () => {
    const workspaceConfig = normalizeAssistantConfig({
      screenshotAnalyzerDefault: 'hybrid',
    });
    const threadConfig = normalizeThreadAssistantConfig({
      analyzerOverride: 'ocr_pipeline',
    });

    expect(
      resolveAssistantAnalyzerMode({
        workspaceConfig,
        threadConfig,
        messageOverride: null,
      })
    ).toBe('ocr_pipeline');

    expect(
      resolveAssistantAnalyzerMode({
        workspaceConfig,
        threadConfig,
        messageOverride: 'vision_model',
      })
    ).toBe('vision_model');
  });

  it('builds compiled instructions from guardrails + workspace + thread', () => {
    const workspaceConfig = normalizeAssistantConfig({
      instructionProfile: {
        goal: 'Track governor activity',
        style: 'short and direct',
        doRules: ['Use typed tools first'],
        dontRules: ['Do not guess IDs'],
      },
      rawInstruction: 'Prioritize weekly event context.',
    });
    const threadConfig = normalizeThreadAssistantConfig({
      threadInstructions: 'Focus this thread on OCR queue cleanup.',
    });

    const compiled = buildAssistantInstructionText({
      baseGuardrails: ['System guardrail A', 'System guardrail B'],
      workspaceConfig,
      threadConfig,
    });

    expect(compiled).toContain('System guardrail A');
    expect(compiled).toContain('Workspace goal: Track governor activity');
    expect(compiled).toContain('Do not guess IDs');
    expect(compiled).toContain('Thread instruction:');
    expect(compiled).toContain('OCR queue cleanup');
  });
});
