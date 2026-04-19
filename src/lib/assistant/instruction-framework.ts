import type { AssistantConfig } from '@/lib/assistant/config';

export type AssistantInstructionCallsite =
  | 'assistant_planner'
  | 'assistant_structured_fallback'
  | 'ingestion_extraction'
  | 'ocr_diagnostics';

const CALLSITE_TEMPLATE_BLOCKS: Record<AssistantInstructionCallsite, string> = {
  assistant_planner: [
    'Callsite: assistant planner.',
    'Use typed read tools first when intent or identifiers are unclear.',
    'Prefer deterministic, minimal write plans grounded in evidence.',
    'Never claim a write was executed; writes require app confirmation.',
  ].join('\n'),
  assistant_structured_fallback: [
    'Callsite: assistant structured fallback.',
    'Return strictly schema-compliant JSON.',
    'When key fields are missing, return empty actions and explicit clarification hints.',
    'Do not invent identifiers.',
  ].join('\n'),
  ingestion_extraction: [
    'Callsite: ingestion extraction.',
    'Extract only observable screenshot facts.',
    'Prefer exact numeric strings; leave empty when uncertain.',
    'Avoid fabricated rows, names, or identifiers.',
  ].join('\n'),
  ocr_diagnostics: [
    'Callsite: OCR diagnostics.',
    'Explain extraction quality and failure modes clearly.',
    'Report confidence and missing fields explicitly.',
    'Do not invent corrected values.',
  ].join('\n'),
};

function sanitizeInstructionText(value: unknown, max = 8_000): string {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized.slice(0, max);
}

function buildWorkspaceFreeformInstruction(config: AssistantConfig): string {
  const lines: string[] = [];
  const profile = config.instructionProfile;
  if (profile.goal) lines.push(`Goal: ${sanitizeInstructionText(profile.goal, 500)}`);
  if (profile.style) lines.push(`Style: ${sanitizeInstructionText(profile.style, 500)}`);
  if (profile.doRules.length > 0) {
    lines.push(
      `Do rules:\n${profile.doRules
        .map((rule, index) => `${index + 1}. ${sanitizeInstructionText(rule, 300)}`)
        .join('\n')}`
    );
  }
  if (profile.dontRules.length > 0) {
    lines.push(
      `Do-not rules:\n${profile.dontRules
        .map((rule, index) => `${index + 1}. ${sanitizeInstructionText(rule, 300)}`)
        .join('\n')}`
    );
  }
  if (config.rawInstruction) {
    lines.push(`Workspace instruction:\n${sanitizeInstructionText(config.rawInstruction, 4_000)}`);
  }
  return lines.join('\n\n');
}

export function composeAssistantInstructions(args: {
  callsite: AssistantInstructionCallsite;
  immutableSystemSafety: string[];
  workspaceConfig?: AssistantConfig | null;
  threadInstruction?: string | null;
  taskContext?: string | null;
}): {
  text: string;
  metadata: {
    callsite: AssistantInstructionCallsite;
    sectionOrder: string[];
    sections: number;
  };
} {
  const sections: Array<{ id: string; text: string }> = [];
  const systemText = args.immutableSystemSafety
    .map((line) => sanitizeInstructionText(line, 500))
    .filter(Boolean)
    .join('\n');
  if (systemText) {
    sections.push({
      id: 'immutable_system_safety',
      text: systemText,
    });
  }

  if (args.workspaceConfig) {
    const workspaceText = buildWorkspaceFreeformInstruction(args.workspaceConfig);
    if (workspaceText) {
      sections.push({
        id: 'workspace_freeform_instruction',
        text: workspaceText,
      });
    }
  }

  const threadInstruction = sanitizeInstructionText(args.threadInstruction || '', 2_000);
  if (threadInstruction) {
    sections.push({
      id: 'thread_instruction',
      text: threadInstruction,
    });
  }

  sections.push({
    id: 'callsite_template_block',
    text: CALLSITE_TEMPLATE_BLOCKS[args.callsite],
  });

  const taskContext = sanitizeInstructionText(args.taskContext || '', 8_000);
  if (taskContext) {
    sections.push({
      id: 'turn_task_context',
      text: taskContext,
    });
  }

  return {
    text: sections.map((section) => section.text).join('\n\n'),
    metadata: {
      callsite: args.callsite,
      sectionOrder: sections.map((section) => section.id),
      sections: sections.length,
    },
  };
}

