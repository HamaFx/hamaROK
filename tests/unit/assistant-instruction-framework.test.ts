import { describe, expect, it } from 'vitest';
import { normalizeAssistantConfig } from '@/lib/assistant/config';
import { composeAssistantInstructions } from '@/lib/assistant/instruction-framework';

describe('assistant instruction framework', () => {
  it('composes instruction sections in deterministic order', () => {
    const workspaceConfig = normalizeAssistantConfig({
      instructionProfile: {
        goal: 'Keep writes precise',
        doRules: ['Use read tools first'],
      },
      rawInstruction: 'Never skip identity checks.',
    });

    const compiled = composeAssistantInstructions({
      callsite: 'assistant_planner',
      immutableSystemSafety: ['System A', 'System B'],
      workspaceConfig,
      threadInstruction: 'Thread focus: queue triage.',
      taskContext: 'Turn context goes here.',
    });

    expect(compiled.metadata.sectionOrder).toEqual([
      'immutable_system_safety',
      'workspace_freeform_instruction',
      'thread_instruction',
      'callsite_template_block',
      'turn_task_context',
    ]);
    expect(compiled.text).toContain('System A');
    expect(compiled.text).toContain('Goal: Keep writes precise');
    expect(compiled.text).toContain('Thread focus: queue triage.');
    expect(compiled.text).toContain('Callsite: assistant planner.');
    expect(compiled.text).toContain('Turn context goes here.');
  });
});

