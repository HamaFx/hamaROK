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

export const assistantInstructionPresetSchema = z.enum([
  'conservative',
  'balanced',
  'aggressive',
]);
export type AssistantInstructionPreset = z.infer<typeof assistantInstructionPresetSchema>;

export const assistantEmbeddingRetrievalModeSchema = z.enum([
  'hybrid',
  'semantic',
  'lexical',
]);
export type AssistantEmbeddingRetrievalMode = z.infer<typeof assistantEmbeddingRetrievalModeSchema>;

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
  instructionPreset: assistantInstructionPresetSchema.optional(),
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
  embedding: z
    .object({
      enabled: z.boolean().optional(),
      model: z.string().min(1).max(120).optional(),
      dimension: z.number().int().min(64).max(4096).optional(),
      retrievalMode: assistantEmbeddingRetrievalModeSchema.optional(),
      maxCandidates: z.number().int().min(1).max(200).optional(),
      fallbackOnly: z.boolean().optional(),
      autoLinkThreshold: z.number().min(0.7).max(1).optional(),
      batch: z
        .object({
          enabled: z.boolean().optional(),
          threshold: z.number().int().min(20).max(100000).optional(),
        })
        .optional(),
    })
    .optional(),
});

export interface AssistantConfig {
  screenshotAnalyzerDefault: AssistantAnalyzerMode;
  contextMode: AssistantContextMode;
  suggestionMode: AssistantSuggestionMode;
  instructionPreset: AssistantInstructionPreset;
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
  embedding: {
    enabled: boolean;
    model: string;
    dimension: number;
    retrievalMode: AssistantEmbeddingRetrievalMode;
    maxCandidates: number;
    fallbackOnly: boolean;
    autoLinkThreshold: number;
    batch: {
      enabled: boolean;
      threshold: number;
    };
  };
}

const DEFAULT_VISION_MODEL = 'mistral-large-latest';

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  screenshotAnalyzerDefault: 'hybrid',
  contextMode: 'smart',
  suggestionMode: 'signal',
  instructionPreset: 'balanced',
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
  embedding: {
    enabled: true,
    model: 'mistral-embed-2312',
    dimension: 1024,
    retrievalMode: 'hybrid',
    maxCandidates: 24,
    fallbackOnly: true,
    autoLinkThreshold: 0.93,
    batch: {
      enabled: true,
      threshold: 80,
    },
  },
};

function sanitizePrintable(value: unknown, max = 2000): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\p{C}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function sanitizeFreeform(value: unknown, max = 4000): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
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
    instructionPreset: base.instructionPreset || DEFAULT_ASSISTANT_CONFIG.instructionPreset,
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
    rawInstruction: sanitizeFreeform(base.rawInstruction, 4000),
    embedding: {
      enabled:
        typeof base.embedding?.enabled === 'boolean'
          ? base.embedding.enabled
          : DEFAULT_ASSISTANT_CONFIG.embedding.enabled,
      model:
        sanitizePrintable(base.embedding?.model, 120) || DEFAULT_ASSISTANT_CONFIG.embedding.model,
      dimension:
        Number.isFinite(base.embedding?.dimension) && Number(base.embedding?.dimension) > 0
          ? Number(base.embedding?.dimension)
          : DEFAULT_ASSISTANT_CONFIG.embedding.dimension,
      retrievalMode:
        base.embedding?.retrievalMode || DEFAULT_ASSISTANT_CONFIG.embedding.retrievalMode,
      maxCandidates:
        Number.isFinite(base.embedding?.maxCandidates) && Number(base.embedding?.maxCandidates) > 0
          ? Number(base.embedding?.maxCandidates)
          : DEFAULT_ASSISTANT_CONFIG.embedding.maxCandidates,
      fallbackOnly:
        typeof base.embedding?.fallbackOnly === 'boolean'
          ? base.embedding.fallbackOnly
          : DEFAULT_ASSISTANT_CONFIG.embedding.fallbackOnly,
      autoLinkThreshold:
        Number.isFinite(base.embedding?.autoLinkThreshold) &&
        Number(base.embedding?.autoLinkThreshold) > 0
          ? Number(base.embedding?.autoLinkThreshold)
          : DEFAULT_ASSISTANT_CONFIG.embedding.autoLinkThreshold,
      batch: {
        enabled:
          typeof base.embedding?.batch?.enabled === 'boolean'
            ? base.embedding.batch.enabled
            : DEFAULT_ASSISTANT_CONFIG.embedding.batch.enabled,
        threshold:
          Number.isFinite(base.embedding?.batch?.threshold) &&
          Number(base.embedding?.batch?.threshold) > 0
            ? Number(base.embedding?.batch?.threshold)
            : DEFAULT_ASSISTANT_CONFIG.embedding.batch.threshold,
      },
    },
  };
}

export function serializeAssistantConfig(config: AssistantConfig): Record<string, unknown> {
  return {
    screenshotAnalyzerDefault: config.screenshotAnalyzerDefault,
    contextMode: config.contextMode,
    suggestionMode: config.suggestionMode,
    instructionPreset: config.instructionPreset,
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
    embedding: {
      enabled: config.embedding.enabled,
      model: config.embedding.model,
      dimension: config.embedding.dimension,
      retrievalMode: config.embedding.retrievalMode,
      maxCandidates: config.embedding.maxCandidates,
      fallbackOnly: config.embedding.fallbackOnly,
      autoLinkThreshold: config.embedding.autoLinkThreshold,
      batch: {
        enabled: config.embedding.batch.enabled,
        threshold: config.embedding.batch.threshold,
      },
    },
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
    threadInstructions: sanitizeFreeform(data.threadInstructions, 2000),
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

export interface AssistantPresetPolicy {
  maxReadToolLoops: number;
  contextBudgets: {
    assistantPlanner: number;
    assistantStructuredFallback: number;
    ingestionExtraction: number;
    ocrDiagnostics: number;
  };
  suggestionSignalThreshold: number;
  extractionFallbackAggressiveness: 'low' | 'medium' | 'high';
}

const ASSISTANT_PRESET_POLICIES: Record<AssistantInstructionPreset, AssistantPresetPolicy> = {
  conservative: {
    maxReadToolLoops: 2,
    contextBudgets: {
      assistantPlanner: 2600,
      assistantStructuredFallback: 3200,
      ingestionExtraction: 1400,
      ocrDiagnostics: 1700,
    },
    suggestionSignalThreshold: 70,
    extractionFallbackAggressiveness: 'low',
  },
  balanced: {
    maxReadToolLoops: 4,
    contextBudgets: {
      assistantPlanner: 4200,
      assistantStructuredFallback: 5200,
      ingestionExtraction: 1800,
      ocrDiagnostics: 2200,
    },
    suggestionSignalThreshold: 50,
    extractionFallbackAggressiveness: 'medium',
  },
  aggressive: {
    maxReadToolLoops: 6,
    contextBudgets: {
      assistantPlanner: 6200,
      assistantStructuredFallback: 7600,
      ingestionExtraction: 2400,
      ocrDiagnostics: 3000,
    },
    suggestionSignalThreshold: 30,
    extractionFallbackAggressiveness: 'high',
  },
};

export function resolveAssistantPresetPolicy(
  preset: AssistantInstructionPreset
): AssistantPresetPolicy {
  return ASSISTANT_PRESET_POLICIES[preset] || ASSISTANT_PRESET_POLICIES.balanced;
}

export function parseAssistantConfigFromJson(value: unknown): AssistantConfig {
  return normalizeAssistantConfig(asJsonObject(value));
}
