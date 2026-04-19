import type {
  AssistantContextMode,
  AssistantInstructionPreset,
} from '@/lib/assistant/config';
import { resolveAssistantPresetPolicy } from '@/lib/assistant/config';
import type { AssistantInstructionCallsite } from '@/lib/assistant/instruction-framework';

export interface AdaptiveContextSource {
  id: string;
  title: string;
  content: string;
  summary?: string;
  critical?: boolean;
  priority?: number;
}

export interface AdaptiveContextDiagnostics {
  callsite: AssistantInstructionCallsite;
  budgetTier: AssistantInstructionPreset;
  mode: AssistantContextMode;
  budgetTokens: number;
  estimatedTokens: number;
  selectedSources: Array<{
    id: string;
    title: string;
    tokens: number;
    priority: number;
    critical: boolean;
    truncated: boolean;
  }>;
  droppedSources: Array<{
    id: string;
    title: string;
    reason: 'prompt_only' | 'budget';
  }>;
}

function sanitizeContextText(value: unknown, max = 30_000): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

export function estimateTokenCount(text: string): number {
  const normalized = sanitizeContextText(text, 120_000);
  if (!normalized) return 0;
  return Math.ceil(normalized.length / 4);
}

function resolveBudgetTokens(args: {
  callsite: AssistantInstructionCallsite;
  preset: AssistantInstructionPreset;
  mode: AssistantContextMode;
}): number {
  const preset = resolveAssistantPresetPolicy(args.preset);
  const base =
    args.callsite === 'assistant_planner'
      ? preset.contextBudgets.assistantPlanner
      : args.callsite === 'assistant_structured_fallback'
        ? preset.contextBudgets.assistantStructuredFallback
        : args.callsite === 'ingestion_extraction'
          ? preset.contextBudgets.ingestionExtraction
          : preset.contextBudgets.ocrDiagnostics;

  if (args.mode === 'full') {
    return Math.round(base * 1.3);
  }
  if (args.mode === 'prompt_only') {
    return 0;
  }
  return base;
}

export function buildAdaptiveContextPack(args: {
  callsite: AssistantInstructionCallsite;
  preset: AssistantInstructionPreset;
  mode: AssistantContextMode;
  sources: AdaptiveContextSource[];
}): {
  text: string;
  diagnostics: AdaptiveContextDiagnostics;
} {
  const budgetTokens = resolveBudgetTokens(args);
  if (args.mode === 'prompt_only' || budgetTokens <= 0) {
    return {
      text: '',
      diagnostics: {
        callsite: args.callsite,
        budgetTier: args.preset,
        mode: args.mode,
        budgetTokens,
        estimatedTokens: 0,
        selectedSources: [],
        droppedSources: args.sources.map((source) => ({
          id: source.id,
          title: source.title,
          reason: 'prompt_only' as const,
        })),
      },
    };
  }

  const normalizedSources = args.sources.map((source, index) => ({
    ...source,
    sourceIndex: index,
    title: sanitizeContextText(source.title, 180) || `source_${index + 1}`,
    content: sanitizeContextText(source.content),
    summary: sanitizeContextText(source.summary || '', 12_000),
    priority: Number.isFinite(source.priority) ? Number(source.priority) : 50,
    critical: Boolean(source.critical),
  }));

  const sorted = [...normalizedSources].sort((a, b) => {
    if (a.critical !== b.critical) return a.critical ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.sourceIndex - b.sourceIndex;
  });

  const selectedTextBlocks: string[] = [];
  const selectedSources: AdaptiveContextDiagnostics['selectedSources'] = [];
  const droppedSources: AdaptiveContextDiagnostics['droppedSources'] = [];

  let remainingBudget = budgetTokens;
  let estimatedTokens = 0;

  for (const source of sorted) {
    const fullBody = source.content;
    if (!fullBody) {
      droppedSources.push({
        id: source.id,
        title: source.title,
        reason: 'budget',
      });
      continue;
    }
    const fullTokens = estimateTokenCount(fullBody);

    let selectedBody = fullBody;
    let selectedTokens = fullTokens;
    let truncated = false;

    if (selectedTokens > remainingBudget) {
      if (source.summary) {
        const summaryTokens = estimateTokenCount(source.summary);
        if (summaryTokens <= remainingBudget) {
          selectedBody = source.summary;
          selectedTokens = summaryTokens;
          truncated = true;
        }
      }
    }

    if (selectedTokens > remainingBudget && source.critical) {
      const maxChars = Math.max(120, Math.floor(remainingBudget * 4));
      const clipped = sanitizeContextText(selectedBody, maxChars);
      const clippedTokens = estimateTokenCount(clipped);
      if (clipped && clippedTokens <= remainingBudget) {
        selectedBody = clipped;
        selectedTokens = clippedTokens;
        truncated = true;
      }
    }

    if (selectedTokens <= 0 || selectedTokens > remainingBudget) {
      droppedSources.push({
        id: source.id,
        title: source.title,
        reason: 'budget',
      });
      continue;
    }

    selectedTextBlocks.push(`[${source.title}]\n${selectedBody}`);
    selectedSources.push({
      id: source.id,
      title: source.title,
      tokens: selectedTokens,
      priority: source.priority,
      critical: source.critical,
      truncated,
    });
    estimatedTokens += selectedTokens;
    remainingBudget -= selectedTokens;
  }

  return {
    text: selectedTextBlocks.join('\n\n'),
    diagnostics: {
      callsite: args.callsite,
      budgetTier: args.preset,
      mode: args.mode,
      budgetTokens,
      estimatedTokens,
      selectedSources,
      droppedSources,
    },
  };
}

