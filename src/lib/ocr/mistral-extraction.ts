import { z } from 'zod';
import { OcrExtractionStatus } from '@prisma/client';
import {
  MistralImageInput,
  MistralOcrResponse,
  MistralJsonResponseFormat,
  runMistralOcr,
  runMistralStructuredOutput,
} from '@/lib/mistral/client';
import { buildAdaptiveContextPack } from '@/lib/assistant/context-engine';
import {
  parseAssistantConfigFromJson,
  type AssistantConfig,
} from '@/lib/assistant/config';
import { composeAssistantInstructions } from '@/lib/assistant/instruction-framework';

const ENGINE_VERSION = 'mistral-ocr-latest+mistral-large-latest';
const PRIMARY_KINGDOM_NUMBER = '4057';
const INGESTION_SYSTEM_GUARDRAILS = [
  'You are extracting deterministic data from Rise of Kingdoms screenshots.',
  'Never fabricate identifiers, names, or metric values.',
  'Prefer empty values over guesses when confidence is low.',
];

const rankingTypeMetricMap: Record<string, string> = {
  individual_power: 'power',
  mad_scientist: 'contribution_points',
  fort_destroyer: 'fort_destroying',
  kill_point: 'kill_points',
};

const extractionSchema = z.object({
  screenArchetype: z.enum(['governor_profile', 'ranking_board', 'unknown']).default('unknown'),
  confidence: z.number().min(0).max(100).default(0),
  failureReasons: z.array(z.string()).default([]),

  governorId: z.string().default(''),
  governorName: z.string().default(''),
  alliance: z.string().nullable().optional(),
  power: z.string().default(''),
  killPoints: z.string().default(''),
  t4Kills: z.string().default('0'),
  t5Kills: z.string().default('0'),
  deads: z.string().default('0'),

  rankingType: z
    .enum(['individual_power', 'mad_scientist', 'fort_destroyer', 'kill_point', 'unknown'])
    .default('unknown'),
  metricKey: z
    .enum(['power', 'contribution_points', 'fort_destroying', 'kill_points', 'metric'])
    .default('metric'),
  headerText: z.string().default(''),
  classificationConfidence: z.number().min(0).max(100).default(0),
  rows: z
    .array(
      z.object({
        sourceRank: z.number().int().min(1).max(5000).nullable().optional(),
        governorNameRaw: z.string().default(''),
        allianceRaw: z.string().nullable().optional(),
        titleRaw: z.string().nullable().optional(),
        metricRaw: z.string().default(''),
        metricValue: z.string().default(''),
        confidence: z.number().min(0).max(100).default(0),
      })
    )
    .default([]),
});

type StructuredExtraction = z.infer<typeof extractionSchema>;

const extractionJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'screenArchetype',
    'confidence',
    'failureReasons',
    'governorId',
    'governorName',
    'alliance',
    'power',
    'killPoints',
    't4Kills',
    't5Kills',
    'deads',
    'rankingType',
    'metricKey',
    'headerText',
    'classificationConfidence',
    'rows',
  ],
  properties: {
    screenArchetype: {
      type: 'string',
      enum: ['governor_profile', 'ranking_board', 'unknown'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    failureReasons: {
      type: 'array',
      items: { type: 'string' },
    },
    governorId: { type: 'string' },
    governorName: { type: 'string' },
    alliance: { type: ['string', 'null'] },
    power: { type: 'string' },
    killPoints: { type: 'string' },
    t4Kills: { type: 'string' },
    t5Kills: { type: 'string' },
    deads: { type: 'string' },
    rankingType: {
      type: 'string',
      enum: ['individual_power', 'mad_scientist', 'fort_destroyer', 'kill_point', 'unknown'],
    },
    metricKey: {
      type: 'string',
      enum: ['power', 'contribution_points', 'fort_destroying', 'kill_points', 'metric'],
    },
    headerText: { type: 'string' },
    classificationConfidence: { type: 'number', minimum: 0, maximum: 100 },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sourceRank',
          'governorNameRaw',
          'allianceRaw',
          'titleRaw',
          'metricRaw',
          'metricValue',
          'confidence',
        ],
        properties: {
          sourceRank: { type: ['integer', 'null'], minimum: 1, maximum: 5000 },
          governorNameRaw: { type: 'string' },
          allianceRaw: { type: ['string', 'null'] },
          titleRaw: { type: ['string', 'null'] },
          metricRaw: { type: 'string' },
          metricValue: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 100 },
        },
      },
    },
  },
};

function sanitizePrintable(value: unknown, max = 120): string {
  const cleaned = String(value ?? '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, max);
}

function digitsOnly(value: unknown, max = 18): string {
  return String(value ?? '')
    .replace(/[^0-9]/g, '')
    .slice(0, max);
}

function buildOcrPrompt(ocr: MistralOcrResponse, archetypeHint?: string | null): string {
  const pages = (ocr.pages || [])
    .slice(0, 4)
    .map((page) => {
      const markdown = String(page.markdown || '').slice(0, 9000);
      return `Page ${page.index}:\n${markdown}`;
    })
    .join('\n\n');

  return [
    'Analyze this Rise of Kingdoms screenshot OCR output.',
    `Archetype hint: ${sanitizePrintable(archetypeHint || 'unknown', 80) || 'unknown'}.`,
    'If this is a governor profile screenshot, extract governor fields.',
    'If this is a ranking board screenshot, extract ranking type, metric key, and rows.',
    'Rules:',
    '- IDs and metrics must be numeric strings (digits only).',
    '- Use empty string when unsure.',
    '- rankingType must be one of: individual_power, mad_scientist, fort_destroyer, kill_point, unknown.',
    '- metricKey must align to rankingType where possible.',
    '- rows should only include valid player rows (skip headers/artifacts).',
    '',
    pages,
  ].join('\n');
}

function buildExtractionInstructionBundle(args: {
  callsite: 'ingestion_extraction' | 'ocr_diagnostics';
  assistantConfig: AssistantConfig;
  archetypeHint?: string | null;
  ocr: MistralOcrResponse;
  promptInput: string;
}) {
  const contextPack = buildAdaptiveContextPack({
    callsite: args.callsite,
    preset: args.assistantConfig.instructionPreset,
    mode: args.assistantConfig.contextMode,
    sources: [
      {
        id: 'task_summary',
        title: 'Extraction Task',
        critical: true,
        priority: 100,
        content: [
          `Archetype hint: ${sanitizePrintable(args.archetypeHint || 'unknown', 120) || 'unknown'}`,
          `OCR model: ${sanitizePrintable(args.ocr.model, 120) || 'mistral-ocr-latest'}`,
          `Pages detected: ${Array.isArray(args.ocr.pages) ? args.ocr.pages.length : 0}`,
        ].join('\n'),
      },
      {
        id: 'ocr_preview',
        title: 'OCR Preview',
        critical: true,
        priority: 90,
        content: args.promptInput,
        summary: args.promptInput.slice(0, 2500),
      },
    ],
  });
  const instructionBundle = composeAssistantInstructions({
    callsite: args.callsite,
    immutableSystemSafety: INGESTION_SYSTEM_GUARDRAILS,
    workspaceConfig: args.assistantConfig,
    taskContext: [
      `Preset: ${args.assistantConfig.instructionPreset}`,
      `Context budget: ${contextPack.diagnostics.estimatedTokens}/${contextPack.diagnostics.budgetTokens} tokens`,
      `Callsite: ${args.callsite}`,
    ].join('\n'),
  });

  return {
    contextPack,
    instructionBundle,
  };
}

function toProfilePayload(extraction: StructuredExtraction, ocr: MistralOcrResponse) {
  const governorId = digitsOnly(extraction.governorId, 16);
  const governorName = sanitizePrintable(extraction.governorName, 80);

  const power = digitsOnly(extraction.power);
  const killPoints = digitsOnly(extraction.killPoints);
  const t4Kills = digitsOnly(extraction.t4Kills);
  const t5Kills = digitsOnly(extraction.t5Kills);
  const deads = digitsOnly(extraction.deads);

  const fields = {
    governorId: {
      value: governorId,
      confidence: extraction.confidence,
    },
    governorName: {
      value: governorName,
      confidence: extraction.confidence,
    },
    power: {
      value: power,
      confidence: extraction.confidence,
    },
    killPoints: {
      value: killPoints,
      confidence: extraction.confidence,
    },
    t4Kills: {
      value: t4Kills,
      confidence: extraction.confidence,
    },
    t5Kills: {
      value: t5Kills,
      confidence: extraction.confidence,
    },
    deads: {
      value: deads,
      confidence: extraction.confidence,
    },
    alliance: {
      value: sanitizePrintable(extraction.alliance || '', 80),
      confidence: extraction.confidence,
    },
  } as Record<string, unknown>;

  const normalized = {
    governorId,
    governorName,
    power,
    killPoints,
    t4Kills,
    t5Kills,
    deads,
    alliance: sanitizePrintable(extraction.alliance || '', 80),
    kingdomNumber: PRIMARY_KINGDOM_NUMBER,
  } as Record<string, unknown>;

  const failureReasons = [...new Set(extraction.failureReasons || [])]
    .map((item) => sanitizePrintable(item, 220))
    .filter(Boolean);

  const lowConfidence =
    extraction.confidence < 75 ||
    !governorId ||
    !governorName ||
    !power ||
    !killPoints;

  return {
    provider: 'MISTRAL',
    status: OcrExtractionStatus.RAW,
    governorIdRaw: governorId || null,
    governorNameRaw: governorName || null,
    confidence: extraction.confidence,
    profileId: null,
    engineVersion: ENGINE_VERSION,
    lowConfidence,
    failureReasons,
    fields,
    normalized,
    validation: [],
    preprocessingTrace: {
      ocrModel: ocr.model,
      pages: ocr.pages?.length || 0,
    },
    candidates: {
      source: 'mistral-large-latest',
    },
    fusionDecision: {
      strategy: 'mistral-structured',
    },
  };
}

function toRankingPayload(extraction: StructuredExtraction, ocr: MistralOcrResponse) {
  const rankingType = extraction.rankingType || 'unknown';
  const expectedMetric = rankingTypeMetricMap[rankingType];
  const metricKey = expectedMetric || extraction.metricKey || 'metric';

  const rows = (extraction.rows || [])
    .map((row) => {
      const metricValue = digitsOnly(row.metricValue);
      const metricRaw = sanitizePrintable(row.metricRaw || row.metricValue, 80);
      const governorNameRaw = sanitizePrintable(row.governorNameRaw, 80);
      if (!governorNameRaw || !metricValue) return null;

      return {
        sourceRank:
          typeof row.sourceRank === 'number' && Number.isFinite(row.sourceRank)
            ? Math.max(1, Math.min(5000, Math.floor(row.sourceRank)))
            : null,
        governorNameRaw,
        allianceRaw: row.allianceRaw ? sanitizePrintable(row.allianceRaw, 80) : null,
        titleRaw: row.titleRaw ? sanitizePrintable(row.titleRaw, 80) : null,
        metricRaw,
        metricValue,
        confidence: Math.max(0, Math.min(100, Number(row.confidence || extraction.confidence || 0))),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const failureReasons = [...new Set(extraction.failureReasons || [])]
    .map((item) => sanitizePrintable(item, 220))
    .filter(Boolean);

  return {
    rankingType,
    metricKey,
    headerText: sanitizePrintable(extraction.headerText, 120),
    rows,
    metadata: {
      classificationConfidence: extraction.classificationConfidence,
      detectedBoardTokens: [],
      guardFailures: rows.length > 0 ? [] : ['insufficient-valid-rows'],
      droppedRowCount: 0,
      worker: 'mistral-structured',
      ocrModel: ocr.model,
      pages: ocr.pages?.length || 0,
    },
    failureReasons,
  };
}

function inferArchetype(
  extraction: StructuredExtraction,
  archetypeHint?: string | null
): 'governor_profile' | 'ranking_board' {
  if (extraction.screenArchetype === 'governor_profile') return 'governor_profile';
  if (extraction.screenArchetype === 'ranking_board') return 'ranking_board';

  const hint = String(archetypeHint || '').toLowerCase();
  if (hint.includes('profile')) return 'governor_profile';
  if (hint.includes('ranking')) return 'ranking_board';

  if ((extraction.rows || []).length > 0) return 'ranking_board';
  return 'governor_profile';
}

export async function runMistralIngestionExtraction(args: {
  image: MistralImageInput;
  archetypeHint?: string | null;
  ocrModel?: string;
  extractionModel?: string;
  assistantConfig?: unknown;
  callsite?: 'ingestion_extraction' | 'ocr_diagnostics';
}): Promise<
  | {
      ingestionDomain: 'PROFILE_SNAPSHOT';
      screenArchetype: 'governor_profile';
      profile: Record<string, unknown>;
      metadata: Record<string, unknown>;
      ocr: MistralOcrResponse;
    }
  | {
      ingestionDomain: 'RANKING_CAPTURE';
      screenArchetype: 'ranking_board';
      ranking: Record<string, unknown>;
      metadata: Record<string, unknown>;
      ocr: MistralOcrResponse;
    }
> {
  const assistantConfig = parseAssistantConfigFromJson(args.assistantConfig);
  const callsite = args.callsite || 'ingestion_extraction';
  const ocr = await runMistralOcr({
    image: args.image,
    model: args.ocrModel || 'mistral-ocr-latest',
    includeImageBase64: false,
    documentAnnotationFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'rok_screenshot_annotation',
        strict: true,
        schema: extractionJsonSchema,
      },
    } as MistralJsonResponseFormat,
    documentAnnotationPrompt:
      'Return strict JSON values for screenshot fields and ranking rows according to the schema.',
  });

  const promptInput = buildOcrPrompt(ocr, args.archetypeHint);
  const { contextPack, instructionBundle } = buildExtractionInstructionBundle({
    callsite,
    assistantConfig,
    archetypeHint: args.archetypeHint,
    ocr,
    promptInput,
  });
  const structured = await runMistralStructuredOutput<StructuredExtraction>({
    instructions: instructionBundle.text,
    input: promptInput,
    schemaName: 'rok_screenshot_extraction',
    schema: extractionJsonSchema,
    model: args.extractionModel || 'mistral-large-latest',
    completionArgs: {
      tool_choice: 'auto',
      parallel_tool_calls: false,
    },
    metadata: {
      callsite,
      instructionSections: instructionBundle.metadata.sectionOrder,
      contextDiagnostics: contextPack.diagnostics,
    },
    store: false,
  });

  const parsed = extractionSchema.parse(structured.parsed);
  const archetype = inferArchetype(parsed, args.archetypeHint);

  const metadata = {
    worker: 'mistral',
    ocrModel: ocr.model,
    extractionModel: args.extractionModel || 'mistral-large-latest',
    pages: ocr.pages?.length || 0,
    callsite,
    instructionPreset: assistantConfig.instructionPreset,
    instructionSections: instructionBundle.metadata.sectionOrder,
    contextDiagnostics: contextPack.diagnostics,
  };

  if (archetype === 'ranking_board') {
    const rankingPayload = toRankingPayload(parsed, ocr);
    return {
      ingestionDomain: 'RANKING_CAPTURE',
      screenArchetype: 'ranking_board',
      ranking: rankingPayload,
      metadata,
      ocr,
    };
  }

  const profilePayload = toProfilePayload(parsed, ocr);
  return {
    ingestionDomain: 'PROFILE_SNAPSHOT',
    screenArchetype: 'governor_profile',
    profile: profilePayload,
    metadata,
    ocr,
  };
}

export async function runMistralDiagnostics(args: {
  image: MistralImageInput;
  archetypeHint?: string | null;
  ocrModel?: string;
  extractionModel?: string;
  assistantConfig?: unknown;
}) {
  const result = await runMistralIngestionExtraction({
    ...args,
    callsite: 'ocr_diagnostics',
  });

  if (result.ingestionDomain === 'RANKING_CAPTURE') {
    return {
      engineVersion: ENGINE_VERSION,
      screenArchetype: 'rankboard',
      rankingType: (result.ranking as Record<string, unknown>).rankingType || 'unknown',
      metricKey: (result.ranking as Record<string, unknown>).metricKey || 'metric',
      rows: (result.ranking as Record<string, unknown>).rows || [],
      lowConfidence: Boolean(
        Array.isArray((result.ranking as Record<string, unknown>).rows)
          ? ((result.ranking as Record<string, unknown>).rows as unknown[]).length === 0
          : true
      ),
      failureReasons: (result.ranking as Record<string, unknown>).failureReasons || [],
      metadata: (result.ranking as Record<string, unknown>).metadata || {},
      preprocessingTrace: result.metadata,
      rowCandidates: {},
      profileSelection: null,
    };
  }

  const profile = result.profile as Record<string, unknown>;
  return {
    engineVersion: ENGINE_VERSION,
    screenArchetype: 'governor-profile',
    profileSelection: null,
    normalized: profile.normalized || {},
    validation: profile.validation || [],
    lowConfidence: Boolean(profile.lowConfidence),
    lowConfidenceFields: [],
    failureReasons: profile.failureReasons || [],
    preprocessingTrace: profile.preprocessingTrace || result.metadata,
    candidates: profile.candidates || {},
    fusionDecision: profile.fusionDecision || {},
    passthrough: {
      averageConfidence: profile.confidence || 0,
    },
  };
}
