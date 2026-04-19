import { z } from 'zod';

export const assistantAnalyzerModeSchema = z.enum([
  'hybrid',
  'ocr_pipeline',
  'vision_model',
]);
export type AssistantAnalyzerMode = z.infer<typeof assistantAnalyzerModeSchema>;

export const assistantAnalyzerOverrideSchema = z.enum([
  'inherit',
  'hybrid',
  'ocr_pipeline',
  'vision_model',
]);
export type AssistantAnalyzerOverride = z.infer<typeof assistantAnalyzerOverrideSchema>;

export const assistantContextModeSchema = z.enum(['smart', 'full', 'prompt_only']);
export type AssistantContextMode = z.infer<typeof assistantContextModeSchema>;

export const assistantSuggestionModeSchema = z.enum(['signal', 'always', 'on_demand']);
export type AssistantSuggestionMode = z.infer<typeof assistantSuggestionModeSchema>;

const stringOrNullSchema = z.union([z.string(), z.null()]).optional();
const instructionRulesSchema = z.array(z.string()).max(20).optional();

const assistantInstructionProfileSchema = z
  .object({
    goal: stringOrNullSchema,
    style: stringOrNullSchema,
    doRules: instructionRulesSchema,
    dontRules: instructionRulesSchema,
  })
  .optional();

export const assistantConfigSchema = z.object({
  screenshotAnalyzerDefault: assistantAnalyzerModeSchema.optional(),
  contextMode: assistantContextModeSchema.optional(),
  suggestionMode: assistantSuggestionModeSchema.optional(),
  visionModel: z.string().min(1).max(120).optional(),
  batch: z
    .object({
      enabled: z.boolean().optional(),
      threshold: z.number().int().min(20).max(5000).optional(),
    })
    .optional(),
  readLimits: z
    .object({
      maxToolsPerTurn: z.number().int().min(1).max(30).optional(),
      maxRowsPerTool: z.number().int().min(1).max(200).optional(),
    })
    .optional(),
  instructionProfile: assistantInstructionProfileSchema,
  rawInstruction: stringOrNullSchema,
});

export interface AssistantConfig {
  screenshotAnalyzerDefault: AssistantAnalyzerMode;
  contextMode: AssistantContextMode;
  suggestionMode: AssistantSuggestionMode;
  visionModel: string;
  batch: {
    enabled: boolean;
    threshold: number;
  };
  readLimits: {
    maxToolsPerTurn: number;
    maxRowsPerTool: number;
  };
  instructionProfile: {
    goal: string;
    style: string;
    doRules: string[];
    dontRules: string[];
  };
  rawInstruction: string;
}

const DEFAULT_VISION_MODEL = 'mistral-large-latest';

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  screenshotAnalyzerDefault: 'hybrid',
  contextMode: 'smart',
  suggestionMode: 'signal',
  visionModel: DEFAULT_VISION_MODEL,
  batch: {
    enabled: true,
    threshold: 80,
  },
  readLimits: {
    maxToolsPerTurn: 12,
    maxRowsPerTool: 60,
  },
  instructionProfile: {
    goal: '',
    style: '',
    doRules: [],
    dontRules: [],
  },
  rawInstruction: '',
};

function sanitizePrintable(value: unknown, max = 2000): string {
  return String(value ?? '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function sanitizeRuleList(value: unknown, maxItems = 20, maxChars = 240): string[] {
  if (!Array.isArray(value)) return [];
  const rows: string[] = [];
  for (const entry of value) {
    const line = sanitizePrintable(entry, maxChars);
    if (!line) continue;
    rows.push(line);
    if (rows.length >= maxItems) break;
  }
  return rows;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function normalizeAssistantConfig(value: unknown): AssistantConfig {
  const parsed = assistantConfigSchema.safeParse(value);
  const base = parsed.success ? parsed.data : {};

  const profile = base.instructionProfile || {};
  return {
    screenshotAnalyzerDefault:
      base.screenshotAnalyzerDefault || DEFAULT_ASSISTANT_CONFIG.screenshotAnalyzerDefault,
    contextMode: base.contextMode || DEFAULT_ASSISTANT_CONFIG.contextMode,
    suggestionMode: base.suggestionMode || DEFAULT_ASSISTANT_CONFIG.suggestionMode,
    visionModel: sanitizePrintable(base.visionModel, 120) || DEFAULT_ASSISTANT_CONFIG.visionModel,
    batch: {
      enabled:
        typeof base.batch?.enabled === 'boolean'
          ? base.batch.enabled
          : DEFAULT_ASSISTANT_CONFIG.batch.enabled,
      threshold:
        Number.isFinite(base.batch?.threshold) && Number(base.batch?.threshold) > 0
          ? Number(base.batch?.threshold)
          : DEFAULT_ASSISTANT_CONFIG.batch.threshold,
    },
    readLimits: {
      maxToolsPerTurn:
        Number.isFinite(base.readLimits?.maxToolsPerTurn) &&
        Number(base.readLimits?.maxToolsPerTurn) > 0
          ? Number(base.readLimits?.maxToolsPerTurn)
          : DEFAULT_ASSISTANT_CONFIG.readLimits.maxToolsPerTurn,
      maxRowsPerTool:
        Number.isFinite(base.readLimits?.maxRowsPerTool) &&
        Number(base.readLimits?.maxRowsPerTool) > 0
          ? Number(base.readLimits?.maxRowsPerTool)
          : DEFAULT_ASSISTANT_CONFIG.readLimits.maxRowsPerTool,
    },
    instructionProfile: {
      goal: sanitizePrintable(profile.goal, 400),
      style: sanitizePrintable(profile.style, 400),
      doRules: sanitizeRuleList(profile.doRules),
      dontRules: sanitizeRuleList(profile.dontRules),
    },
    rawInstruction: sanitizePrintable(base.rawInstruction, 4000),
  };
}

export function serializeAssistantConfig(config: AssistantConfig): Record<string, unknown> {
  return {
    screenshotAnalyzerDefault: config.screenshotAnalyzerDefault,
    contextMode: config.contextMode,
    suggestionMode: config.suggestionMode,
    visionModel: config.visionModel,
    batch: {
      enabled: config.batch.enabled,
      threshold: config.batch.threshold,
    },
    readLimits: {
      maxToolsPerTurn: config.readLimits.maxToolsPerTurn,
      maxRowsPerTool: config.readLimits.maxRowsPerTool,
    },
    instructionProfile: {
      goal: config.instructionProfile.goal,
      style: config.instructionProfile.style,
      doRules: config.instructionProfile.doRules,
      dontRules: config.instructionProfile.dontRules,
    },
    rawInstruction: config.rawInstruction,
  };
}

export const threadAssistantConfigSchema = z.object({
  threadInstructions: z.union([z.string(), z.null()]).optional(),
  analyzerOverride: assistantAnalyzerOverrideSchema.optional(),
});

export interface ThreadAssistantConfig {
  threadInstructions: string;
  analyzerOverride: AssistantAnalyzerOverride;
}

export const DEFAULT_THREAD_ASSISTANT_CONFIG: ThreadAssistantConfig = {
  threadInstructions: '',
  analyzerOverride: 'inherit',
};

export function normalizeThreadAssistantConfig(value: unknown): ThreadAssistantConfig {
  const parsed = threadAssistantConfigSchema.safeParse(value);
  const data = parsed.success ? parsed.data : {};
  return {
    threadInstructions: sanitizePrintable(data.threadInstructions, 2000),
    analyzerOverride: data.analyzerOverride || DEFAULT_THREAD_ASSISTANT_CONFIG.analyzerOverride,
  };
}

export function serializeThreadAssistantConfig(
  config: ThreadAssistantConfig
): Record<string, unknown> {
  return {
    threadInstructions: config.threadInstructions,
    analyzerOverride: config.analyzerOverride,
  };
}

export function resolveAssistantAnalyzerMode(args: {
  workspaceConfig: AssistantConfig;
  threadConfig?: ThreadAssistantConfig | null;
  messageOverride?: AssistantAnalyzerMode | null;
}): AssistantAnalyzerMode {
  if (args.messageOverride) {
    return args.messageOverride;
  }
  if (
    args.threadConfig &&
    args.threadConfig.analyzerOverride &&
    args.threadConfig.analyzerOverride !== 'inherit'
  ) {
    return args.threadConfig.analyzerOverride;
  }
  return args.workspaceConfig.screenshotAnalyzerDefault;
}

export function buildAssistantInstructionText(args: {
  baseGuardrails: string[];
  workspaceConfig: AssistantConfig;
  threadConfig?: ThreadAssistantConfig | null;
}): string {
  const profile = args.workspaceConfig.instructionProfile;
  const sections: string[] = [];
  if (profile.goal) sections.push(`Workspace goal: ${profile.goal}`);
  if (profile.style) sections.push(`Response style: ${profile.style}`);
  if (profile.doRules.length > 0) {
    sections.push(`Do rules:\n${profile.doRules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}`);
  }
  if (profile.dontRules.length > 0) {
    sections.push(
      `Do-not rules:\n${profile.dontRules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}`
    );
  }
  if (args.workspaceConfig.rawInstruction) {
    sections.push(`Workspace custom instruction:\n${args.workspaceConfig.rawInstruction}`);
  }
  if (args.threadConfig?.threadInstructions) {
    sections.push(`Thread instruction:\n${args.threadConfig.threadInstructions}`);
  }

  return [...args.baseGuardrails, ...sections].join('\n\n');
}

export function parseAssistantConfigFromJson(value: unknown): AssistantConfig {
  return normalizeAssistantConfig(asJsonObject(value));
}

