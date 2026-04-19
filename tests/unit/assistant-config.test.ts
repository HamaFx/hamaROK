import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSISTANT_CONFIG,
  buildAssistantInstructionText,
  normalizeAssistantConfig,
  normalizeThreadAssistantConfig,
  resolveAssistantAnalyzerMode,
  resolveAssistantPresetPolicy,
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

  it('maps presets to deterministic policy knobs', () => {
    const conservative = resolveAssistantPresetPolicy('conservative');
    const balanced = resolveAssistantPresetPolicy('balanced');
    const aggressive = resolveAssistantPresetPolicy('aggressive');

    expect(conservative.maxReadToolLoops).toBeLessThan(balanced.maxReadToolLoops);
    expect(aggressive.maxReadToolLoops).toBeGreaterThan(balanced.maxReadToolLoops);
    expect(conservative.contextBudgets.assistantPlanner).toBeLessThan(
      balanced.contextBudgets.assistantPlanner
    );
    expect(aggressive.contextBudgets.assistantPlanner).toBeGreaterThan(
      balanced.contextBudgets.assistantPlanner
    );
  });

  it('preserves freeform instruction newlines while removing control chars', () => {
    const normalized = normalizeAssistantConfig({
      rawInstruction: 'Line 1\n\nLine 2\u0000',
    });

    expect(normalized.rawInstruction).toContain('Line 1');
    expect(normalized.rawInstruction).toContain('\n');
    expect(normalized.rawInstruction).toContain('Line 2');
    expect(normalized.rawInstruction).not.toContain('\u0000');
  });
});
