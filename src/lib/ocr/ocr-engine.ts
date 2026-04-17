/**
 * OCR engine with multi-pass preprocessing, field-aware candidate fusion,
 * and optional fallback provider hook.
 */
import { createWorker, PSM, Worker } from 'tesseract.js';
import {
  loadImage,
  cropRegion,
  preprocessForOCR,
  canvasToDataUrl,
  type PreprocessOptions,
  type PreprocessTrace,
} from './image-preprocessor';
import {
  OCR_FIELD_KEYS,
  type OcrFieldKey,
  normalizeFieldValue,
  parseNumericStrict,
  toNumericValue,
  validateNormalizedValue,
} from './field-config';
import {
  type OcrRuntimeProfile,
  getTemplateRuntimeProfiles,
  selectBestRuntimeProfile,
} from './profiles';
import { splitGovernorNameAndAlliance } from '@/lib/alliances';

const ENGINE_VERSION = 'ocr-v3.0.0';
export type ScreenArchetype = 'governor-profile' | 'rankboard';

interface OcrPassPlan {
  id: string;
  psm: '6' | '7' | '8' | '13';
  preprocess: PreprocessOptions;
  whitelist?: string;
}

export interface OcrPassTrace {
  passId: string;
  psm: '6' | '7' | '8' | '13';
  confidence: number;
  rawText: string;
  normalizedText: string;
  durationMs: number;
  preprocess: PreprocessTrace;
  debugImageDataUrl?: string;
}

export interface OcrCandidateTrace {
  id: string;
  source: 'pass' | 'fallback';
  passId?: string;
  rawValue: string;
  normalizedValue: string;
  confidence: number;
  validity: {
    valid: boolean;
    reason?: string;
  };
  score: number;
  scoreBreakdown: Record<string, number>;
}

export interface OcrFusionDecision {
  strategy: 'score-fusion';
  selectedCandidateId: string;
  selectedScore: number;
  alternatives: Array<{
    candidateId: string;
    score: number;
    confidence: number;
    normalizedValue: string;
  }>;
  reasons: string[];
}

interface OcrFieldTrace {
  templateId: string;
  profileId: string;
  selectedPass: number;
  passes: OcrPassTrace[];
  fallbackUsed: boolean;
  lowConfidence: boolean;
  failureReasons: string[];
  candidates: OcrCandidateTrace[];
  fusionDecision: OcrFusionDecision;
}

export interface OcrFieldResult {
  value: string;
  confidence: number;
  croppedImage: string;
  trace: OcrFieldTrace;
}

export interface OcrScreenshotResult {
  governorId: OcrFieldResult;
  governorName: OcrFieldResult;
  power: OcrFieldResult;
  killPoints: OcrFieldResult;
  t4Kills: OcrFieldResult;
  t5Kills: OcrFieldResult;
  deads: OcrFieldResult;
  averageConfidence: number;
  templateId: string;
  profileId: string;
  profileSelection: ReturnType<typeof selectBestRuntimeProfile>;
  detectedArchetype?: ScreenArchetype;
  normalizationTrace: Record<string, OcrPassTrace[]>;
  preprocessingTrace: Record<string, OcrPassTrace[]>;
  candidates: Record<string, OcrCandidateTrace[]>;
  fusionDecision: Record<string, OcrFusionDecision>;
  lowConfidence: boolean;
  failureReasons: string[];
  totalDurationMs: number;
  engineVersion: string;
}

export interface RankingCandidateTrace {
  id: string;
  passId: string;
  rawValue: string;
  normalizedValue: string;
  confidence: number;
  score: number;
  valid: boolean;
  reason?: string;
}

export interface RankingRowOcrResult {
  rowIndex: number;
  sourceRank: number | null;
  governorNameRaw: string;
  governorNameNormalized: string;
  allianceRaw?: string | null;
  titleRaw?: string | null;
  metricRaw: string;
  metricValue: string;
  confidence: number;
  identityStatus: 'UNRESOLVED';
  candidates: {
    rank: RankingCandidateTrace[];
    governorName: RankingCandidateTrace[];
    metricValue: RankingCandidateTrace[];
  };
  failureReasons: string[];
  ocrTrace: Record<string, unknown>;
}

export interface RankingScreenshotResult {
  screenArchetype: 'rankboard';
  engineVersion: string;
  headerText: string;
  rankingType: string;
  metricKey: string;
  rows: RankingRowOcrResult[];
  averageConfidence: number;
  lowConfidence: boolean;
  profileId: string;
  templateId: string;
  profileSelection: ReturnType<typeof selectBestRuntimeProfile>;
  preprocessingTrace: Record<string, unknown>;
  rowCandidates: Record<string, unknown>;
  metadata?: {
    classificationConfidence: number;
    droppedRowCount: number;
    guardFailures: string[];
    detectedBoardTokens: string[];
    droppedReasonCount?: Record<string, number>;
    slotCount?: number;
    detectedRows?: number;
    validRows?: number;
    rankSequenceCorrections?: number;
    metricDigitCountOutliers?: number;
    metricMonotonicViolations?: number;
    metricMonotonicCorrections?: number;
    uniformity?: {
      suspicious: boolean;
      dominantValue: string | null;
      dominantCount: number;
      dominantRatio: number;
    };
  };
  totalDurationMs: number;
}

export interface OcrFallbackResult {
  value: string;
  confidence: number;
}

export type OcrFallbackHandler = (args: {
  fieldKey: OcrFieldKey;
  croppedImage: string;
  currentValue: string;
  currentConfidence: number;
}) => Promise<OcrFallbackResult | null>;

export interface ProcessScreenshotOptions {
  onProgress?: (field: string, index: number, total: number) => void;
  fallback?: OcrFallbackHandler;
  profiles?: OcrRuntimeProfile[];
  preferredProfileId?: string | null;
  includeDebugArtifacts?: boolean;
}

let worker: Worker | null = null;

function toConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 1) return Math.max(0, Math.min(100, value * 100));
  return Math.max(0, Math.min(100, value));
}

function shouldIncludeDebugArtifacts(explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit;
  return (
    process.env.NEXT_PUBLIC_OCR_DEBUG_ARTIFACTS === '1' ||
    process.env.OCR_DEBUG_ARTIFACTS === '1'
  );
}

function resolvePsmMode(psm: '6' | '7' | '8' | '13'): PSM {
  if (psm === '6') return PSM.SINGLE_BLOCK;
  if (psm === '7') return PSM.SINGLE_LINE;
  if (psm === '8') return PSM.SINGLE_WORD;
  // RAW_LINE may not exist in every bound enum shape across runtimes.
  const rawLine = (PSM as unknown as Record<string, PSM>).RAW_LINE;
  return rawLine ?? PSM.SINGLE_LINE;
}

function getPassPlans(field: OcrFieldKey): OcrPassPlan[] {
  if (field === 'governorName') {
    return [
      {
        id: 'name-cv-line',
        psm: '7',
        preprocess: {
          variantId: 'name-cv-line',
          scale: 2.4,
          contrast: 1.25,
          adaptiveBlockSize: 35,
          adaptiveC: 11,
          morphology: 'open',
        },
      },
      {
        id: 'name-cv-word',
        psm: '8',
        preprocess: {
          variantId: 'name-cv-word',
          scale: 2.3,
          contrast: 1.35,
          adaptiveBlockSize: 31,
          adaptiveC: 10,
          morphology: 'close',
        },
      },
      {
        id: 'name-canvas-safe',
        psm: '7',
        preprocess: {
          variantId: 'name-canvas-safe',
          useOpenCv: false,
          scale: 2.2,
          contrast: 1.2,
          threshold: 122,
          morphology: 'none',
        },
      },
    ];
  }

  if (field === 'governorId') {
    return [
      {
        id: 'id-cv-tight',
        psm: '8',
        whitelist: '0123456789',
        preprocess: {
          variantId: 'id-cv-tight',
          scale: 2.8,
          contrast: 1.35,
          adaptiveBlockSize: 29,
          adaptiveC: 10,
          morphology: 'open',
        },
      },
      {
        id: 'id-cv-line',
        psm: '7',
        whitelist: '0123456789',
        preprocess: {
          variantId: 'id-cv-line',
          scale: 2.6,
          contrast: 1.25,
          adaptiveBlockSize: 31,
          adaptiveC: 12,
          morphology: 'close',
        },
      },
      {
        id: 'id-canvas-safe',
        psm: '7',
        whitelist: '0123456789',
        preprocess: {
          variantId: 'id-canvas-safe',
          useOpenCv: false,
          scale: 2.4,
          threshold: 118,
          contrast: 1.3,
          morphology: 'none',
        },
      },
    ];
  }

  return [
    {
      id: 'num-cv-tight',
      psm: '7',
      whitelist: '0123456789',
      preprocess: {
        variantId: 'num-cv-tight',
        scale: 2.7,
        contrast: 1.3,
        adaptiveBlockSize: 29,
        adaptiveC: 10,
        morphology: 'open',
      },
    },
    {
      id: 'num-cv-line',
      psm: '6',
      whitelist: '0123456789',
      preprocess: {
        variantId: 'num-cv-line',
        scale: 2.5,
        contrast: 1.25,
        adaptiveBlockSize: 33,
        adaptiveC: 12,
        morphology: 'close',
      },
    },
    {
      id: 'num-canvas-safe',
      psm: '7',
      whitelist: '0123456789',
      preprocess: {
        variantId: 'num-canvas-safe',
        useOpenCv: false,
        scale: 2.3,
        threshold: 120,
        contrast: 1.2,
        morphology: 'none',
      },
    },
  ];
}

export async function initializeWorker(): Promise<Worker> {
  if (worker) return worker;
  worker = await createWorker('eng');
  return worker;
}

async function recognizeWithPass(
  canvas: HTMLCanvasElement,
  field: OcrFieldKey,
  pass: OcrPassPlan
): Promise<{ rawText: string; confidence: number }> {
  const w = await initializeWorker();
  await w.setParameters({
    tessedit_pageseg_mode: resolvePsmMode(pass.psm),
    tessedit_char_whitelist:
      pass.whitelist ?? (field === 'governorName' ? '' : '0123456789'),
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
  const { data } = await w.recognize(canvas);
  return {
    rawText: String(data.text || '').trim(),
    confidence: toConfidence(data.confidence || 0),
  };
}

async function detectScreenshotArchetype(
  img: HTMLImageElement
): Promise<ScreenArchetype | undefined> {
  try {
    const headerRegions = [
      { x: 0.19, y: 0.006, width: 0.62, height: 0.11 },
      { x: 0.24, y: 0.012, width: 0.52, height: 0.09 },
    ];
    const headerReads = await Promise.all(
      headerRegions.map(async (region, index) => {
        const header = cropRegion(img, region);
        const processed = await preprocessForOCR(header, {
          variantId: `archetype-header-${index}`,
          useOpenCv: false,
          scale: 2.2,
          threshold: 132,
          contrast: 1.35,
          invert: true,
        });
        const recognized = await recognizeGenericWithPass(processed.canvas, {
          psm: '7',
          whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789',
        });
        return {
          text: String(recognized.rawText || '').toUpperCase().replace(/\s+/g, ' ').trim(),
          confidence: recognized.confidence,
        };
      })
    );
    headerReads.sort((a, b) => b.confidence - a.confidence);
    const text = [headerReads[0]?.text, headerReads[1]?.text].filter(Boolean).join(' ');
    const compact = text.replace(/\s+/g, '');
    if (text.includes('GOVERNOR PROFILE') || text.includes('PROFILE')) {
      return 'governor-profile';
    }
    if (
      text.includes('RANKINGS') ||
      text.includes('MAD SCIENTIST') ||
      compact.includes('MADSCIENTIST') ||
      text.includes('FORT DESTROYER') ||
      compact.includes('FORTDESTROYER') ||
      text.includes('INDIVIDUAL POWER') ||
      compact.includes('INDIVIDUALPOWER') ||
      text.includes('KILL POINT')
    ) {
      return 'rankboard';
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const RANKING_TYPE_HEADER_MAP: Record<string, string> = {
  'individual power': 'individual_power',
  'individualpower': 'individual_power',
  'mad scientist': 'mad_scientist',
  'madscientist': 'mad_scientist',
  'fort destroyer': 'fort_destroyer',
  'fortdestroyer': 'fort_destroyer',
  'fort destroy': 'fort_destroyer',
  'governor profile': 'governor_profile_power',
  'kill point': 'kill_point',
  'killpoint': 'kill_point',
  'kill points': 'kill_point',
  'killpoints': 'kill_point',
};

const RANKING_NAME_HEADER_TOKENS = new Set([
  'NAME',
  'RANK',
  'RANKING',
  'RANKINGS',
  'POWER',
  'CONTRIBUTION',
  'CONTRIBUTIONPOINTS',
  'FORT',
  'FORTS',
  'FORTDESTROYED',
  'FORTSDESTROYED',
  'KILLPOINT',
  'KILLPOINTS',
  'METRIC',
  'GOVERNORPROFILE',
]);

interface RankingRowRule {
  minMetricDigits: number;
  minRows: number;
  uniformDominanceRatio: number;
  uniformDominanceMinCount: number;
}

const RANKING_ROW_RULES: Record<string, RankingRowRule> = {
  individual_power: {
    minMetricDigits: 5,
    minRows: 3,
    uniformDominanceRatio: 0.8,
    uniformDominanceMinCount: 4,
  },
  mad_scientist: {
    minMetricDigits: 2,
    minRows: 3,
    uniformDominanceRatio: 0.8,
    uniformDominanceMinCount: 4,
  },
  fort_destroyer: {
    minMetricDigits: 1,
    minRows: 3,
    uniformDominanceRatio: 0.8,
    uniformDominanceMinCount: 4,
  },
  kill_point: {
    minMetricDigits: 4,
    minRows: 3,
    uniformDominanceRatio: 0.8,
    uniformDominanceMinCount: 4,
  },
};

export function normalizeRankingTypeLabel(value: string): string {
  const cleaned = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/RANKINGS?/g, '')
    .trim()
    .toLowerCase();
  if (!cleaned) return 'unknown';
  // Check known headers first
  for (const [pattern, type] of Object.entries(RANKING_TYPE_HEADER_MAP)) {
    if (cleaned.includes(pattern)) return type;
  }
  return cleaned.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

const METRIC_LABEL_MAP: Record<string, string> = {
  'power': 'power',
  'contribution': 'contribution_points',
  'contribution points': 'contribution_points',
  'tech contribution': 'contribution_points',
  'fort': 'fort_destroying',
  'fort destroy': 'fort_destroying',
  'destroy': 'fort_destroying',
  'fort destroying': 'fort_destroying',
  'kill points': 'kill_points',
  'kill point': 'kill_points',
};

const STRICT_RANKING_TYPE_METRIC_MAP: Record<string, string> = {
  individual_power: 'power',
  mad_scientist: 'contribution_points',
  fort_destroyer: 'fort_destroying',
  kill_point: 'kill_points',
};

export function normalizeMetricLabel(value: string): string {
  const cleaned = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!cleaned) return 'metric';
  // Check known metric labels first
  for (const [pattern, key] of Object.entries(METRIC_LABEL_MAP)) {
    if (cleaned.includes(pattern)) return key;
  }
  return cleaned.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'metric';
}

function validateStrictRankingTypeMetricPair(
  rankingType: string,
  metricKey: string
): { ok: boolean; reason?: string } {
  const expectedMetric = STRICT_RANKING_TYPE_METRIC_MAP[rankingType];
  if (!expectedMetric) {
    return {
      ok: false,
      reason: `Unsupported rankingType "${rankingType}".`,
    };
  }
  if (metricKey !== expectedMetric) {
    return {
      ok: false,
      reason: `rankingType "${rankingType}" requires metricKey "${expectedMetric}" (received "${metricKey}").`,
    };
  }
  return { ok: true };
}

const RANKING_NAME_WHITELIST =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 []()_#.\'-:+/\\\\|*&!?@",`~^,';

function normalizeRankingName(value: string): string {
  return String(value || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[^A-Za-z0-9 _\-\[\]()#.'":|/\\*+&!?@,`~^]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function cleanupRankingName(value: string): string {
  let cleaned = normalizeRankingName(value)
    .replace(/([|*_-])\1{2,}/g, '$1')
    .replace(/[|*_-]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = cleaned
    .replace(/(?<=\d)[OQ](?=\d)/g, '0')
    .replace(/(?<=\d)[I|L](?=\d)/g, '1')
    .replace(/(?<=[A-Za-z])0(?=[A-Za-z])/g, 'O')
    .replace(/(?<=[A-Za-z])1(?=[A-Za-z])/g, 'l')
    .replace(/(?<=\d)S(?=\d)/g, '5')
    .replace(/(?<=[A-Za-z])5(?=[A-Za-z])/g, 'S')
    .replace(/\s+/g, ' ')
    .trim();

  return normalizeRankingName(cleaned);
}

function extractLikelyAlliancePrefix(value: string): string | null {
  const cleaned = cleanupRankingName(value);
  if (!cleaned) return null;

  const bracketed = cleaned.match(/[\[\(]\s*([A-Za-z0-9'`]{2,7})\s*[\]\)]?/);
  if (bracketed?.[1]) {
    return `[${bracketed[1]}]`;
  }

  const leadingToken = cleaned.match(/^([A-Za-z0-9'`]{2,6})\b/);
  if (!leadingToken?.[1]) return null;
  const token = leadingToken[1];
  const tagLike =
    token === token.toUpperCase() || /[0-9]/.test(token) || /['`]/.test(token);
  return tagLike ? `[${token}]` : null;
}

function hasAlliancePrefix(name: string): boolean {
  return /^[\[\(]\s*[A-Za-z0-9'`]{2,8}\s*[\]\)]/.test(String(name || '').trim());
}

function prependAlliancePrefix(name: string, prefix: string): string {
  if (!prefix) return cleanupRankingName(name);
  const normalizedName = cleanupRankingName(name);
  if (!normalizedName) return cleanupRankingName(prefix);
  if (hasAlliancePrefix(normalizedName)) return normalizedName;
  return cleanupRankingName(`${prefix} ${normalizedName}`);
}

function normalizeRankDigits(value: string): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[OQD]/g, '0')
    .replace(/[I|L]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/[^0-9]/g, '')
    .slice(0, 4);
}

function normalizeMetricDigits(value: string): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[OQD]/g, '0')
    .replace(/[I|L]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/G/g, '6')
    .replace(/Z/g, '2')
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
}

function normalizeArtifactToken(value: string): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function analyzeRankingMetricGrouping(value: string): {
  hasSeparatorHint: boolean;
  separatorGroupingValid: boolean;
  groups: string[];
} {
  const raw = String(value || '');
  const hasSeparatorHint = /[0-9OQDILSBGZ][.,'`\s]+[0-9OQDILSBGZ]/i.test(raw);
  if (!hasSeparatorHint) {
    return {
      hasSeparatorHint: false,
      separatorGroupingValid: true,
      groups: [],
    };
  }

  const groups = raw
    .split(/[.,'`\s]+/)
    .map((part) => normalizeMetricDigits(part))
    .filter(Boolean);

  if (groups.length < 2) {
    return {
      hasSeparatorHint: true,
      separatorGroupingValid: false,
      groups,
    };
  }

  const [head, ...tail] = groups;
  const separatorGroupingValid = head.length >= 1 && head.length <= 3 && tail.every((part) => part.length === 3);
  return {
    hasSeparatorHint: true,
    separatorGroupingValid,
    groups,
  };
}

export function isRankingHeaderNameToken(value: string): boolean {
  const token = normalizeArtifactToken(value);
  if (!token) return true;
  return RANKING_NAME_HEADER_TOKENS.has(token);
}

export function extractRankingMetricDigits(value: string): {
  digits: string;
  hasRawDigit: boolean;
  hasSeparatorHint: boolean;
  separatorGroupingValid: boolean;
} {
  const raw = String(value || '');
  const hasRawDigit = /[0-9]/.test(raw);
  const grouping = analyzeRankingMetricGrouping(raw);
  if (!hasRawDigit) {
    return {
      digits: '',
      hasRawDigit: false,
      hasSeparatorHint: grouping.hasSeparatorHint,
      separatorGroupingValid: grouping.separatorGroupingValid,
    };
  }
  return {
    digits: normalizeMetricDigits(raw),
    hasRawDigit: true,
    hasSeparatorHint: grouping.hasSeparatorHint,
    separatorGroupingValid: grouping.separatorGroupingValid,
  };
}

export function evaluateRankingMetricDigitCountPlausibility(
  metricValues: string[],
  tolerance = 1
): {
  baselineDigits: number;
  outlierIndices: number[];
} {
  const lengths = metricValues.map((value) => normalizeMetricDigits(value).length);
  const nonZero = lengths.filter((length) => length > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) {
    return { baselineDigits: 0, outlierIndices: [] };
  }
  const baselineDigits = nonZero[Math.floor(nonZero.length / 2)];
  const outlierIndices = lengths
    .map((length, index) => ({ length, index }))
    .filter(({ length }) => length > 0 && Math.abs(length - baselineDigits) > tolerance)
    .map(({ index }) => index);
  return { baselineDigits, outlierIndices };
}

function detectBoardTokens(value: string): string[] {
  const normalized = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];
  const compact = normalized.replace(/\s+/g, '');

  const tokens: string[] = [];
  for (const pattern of Object.keys(RANKING_TYPE_HEADER_MAP)) {
    if (pattern.includes('profile')) continue;
    const p = pattern.toUpperCase();
    const pCompact = p.replace(/\s+/g, '');
    if (normalized.includes(p) || compact.includes(pCompact)) {
      tokens.push(p);
    }
  }
  return [...new Set(tokens)];
}

function isMetricHeaderArtifact(rawMetricText: string, metricHeaderText: string): boolean {
  const rawToken = normalizeArtifactToken(rawMetricText);
  if (!rawToken) return true;

  const metricToken = normalizeArtifactToken(metricHeaderText);
  if (metricToken && (rawToken === metricToken || metricToken.includes(rawToken))) {
    return true;
  }

  return [
    'POWER',
    'CONTRIBUTION',
    'CONTRIBUTIONPOINTS',
    'FORT',
    'FORTDESTROYED',
    'FORTSDESTROYED',
    'KILLPOINT',
    'KILLPOINTS',
    'NAME',
    'METRIC',
  ].includes(rawToken);
}

export function evaluateRankingMetricUniformity(
  metricValues: string[],
  options?: {
    dominanceRatio?: number;
    dominanceMinCount?: number;
  }
): {
  suspicious: boolean;
  dominantValue: string | null;
  dominantCount: number;
  dominantRatio: number;
} {
  const cleaned = metricValues.map((value) => String(value || '').trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return {
      suspicious: false,
      dominantValue: null,
      dominantCount: 0,
      dominantRatio: 0,
    };
  }

  const counts = new Map<string, number>();
  for (const value of cleaned) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [dominantValue, dominantCount] = sorted[0];
  const dominantRatio = dominantCount / cleaned.length;
  const dominanceRatioThreshold =
    typeof options?.dominanceRatio === 'number' ? options.dominanceRatio : 0.8;
  const dominanceMinCount =
    typeof options?.dominanceMinCount === 'number' ? options.dominanceMinCount : 4;

  return {
    suspicious:
      cleaned.length >= dominanceMinCount &&
      dominantCount >= dominanceMinCount &&
      dominantRatio >= dominanceRatioThreshold,
    dominantValue,
    dominantCount,
    dominantRatio,
  };
}

async function recognizeGenericWithPass(
  canvas: HTMLCanvasElement,
  pass: { psm: '6' | '7' | '8' | '13'; whitelist?: string }
): Promise<{ rawText: string; confidence: number }> {
  const w = await initializeWorker();
  await w.setParameters({
    tessedit_pageseg_mode: resolvePsmMode(pass.psm),
    tessedit_char_whitelist: pass.whitelist ?? '',
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
  const { data } = await w.recognize(canvas);
  return {
    rawText: String(data.text || '').trim(),
    confidence: toConfidence(data.confidence || 0),
  };
}

function scoreRankingCandidate(args: {
  raw: string;
  normalized: string;
  confidence: number;
  kind: 'name' | 'metric' | 'rank';
}): { score: number; valid: boolean; reason?: string } {
  let score = (args.confidence / 100) * 0.7;
  let valid = true;
  let reason: string | undefined;

  if (args.kind === 'name') {
    const normalizedName = cleanupRankingName(args.normalized);
    if (!normalizedName) {
      valid = false;
      reason = 'empty-name';
      score -= 0.45;
    } else {
      const lengthBonus = Math.min(0.2, normalizedName.length / 70);
      score += lengthBonus;
      if (normalizedName.length < 4) {
        score -= 0.18;
      }
    }
  } else {
    if (!args.normalized) {
      valid = false;
      reason = args.kind === 'rank' ? 'missing-rank' : 'missing-metric-digits';
      score -= 0.5;
    } else {
      score += 0.18;
    }

    if (args.kind === 'rank') {
      const rank = Number(args.normalized);
      if (!Number.isFinite(rank) || rank < 1 || rank > 5000) {
        valid = false;
        reason = 'rank-out-of-range';
        score -= 0.35;
      }
    }
  }

  return { score, valid, reason };
}

function cropCanvasSubRegion(
  source: HTMLCanvasElement,
  region: { x: number; y: number; width: number; height: number }
): HTMLCanvasElement {
  const clampedX = Math.max(0, Math.min(1, region.x));
  const clampedY = Math.max(0, Math.min(1, region.y));
  const clampedW = Math.max(0.01, Math.min(1 - clampedX, region.width));
  const clampedH = Math.max(0.01, Math.min(1 - clampedY, region.height));

  const sx = Math.round(source.width * clampedX);
  const sy = Math.round(source.height * clampedY);
  const sw = Math.max(1, Math.round(source.width * clampedW));
  const sh = Math.max(1, Math.round(source.height * clampedH));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create 2D context for ranking OCR sub-crop.');
  }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

async function recognizeRankingField(args: {
  cropped: HTMLCanvasElement;
  kind: 'name' | 'metric' | 'rank';
  includeDebugArtifacts?: boolean;
}): Promise<{
  selectedValue: string;
  selectedConfidence: number;
  selectedRaw: string;
  traces: OcrPassTrace[];
  candidates: RankingCandidateTrace[];
  failureReasons: string[];
}> {
  interface RankingPassPlan {
    id: string;
    psm: '6' | '7' | '8' | '13';
    whitelist: string;
    preprocess: PreprocessOptions;
    focusRegion?: { x: number; y: number; width: number; height: number };
  }

  const includeDebugArtifacts = shouldIncludeDebugArtifacts(args.includeDebugArtifacts);

  const plans: RankingPassPlan[] =
    args.kind === 'name'
      ? [
          {
            id: 'rank-name-line',
            psm: '7' as const,
            whitelist: RANKING_NAME_WHITELIST,
            preprocess: {
              variantId: 'rank-name-line',
              scale: 2.2,
              contrast: 1.25,
              textChannelMode: 'auto-ranking' as const,
              sharpen: true,
              adaptiveBlockSize: 33,
              adaptiveC: 11,
              morphology: 'open' as const,
            },
          },
          {
            id: 'rank-name-raw-line',
            psm: '13' as const,
            whitelist: RANKING_NAME_WHITELIST,
            preprocess: {
              variantId: 'rank-name-raw-line',
              scale: 2.35,
              contrast: 1.28,
              textChannelMode: 'auto-ranking' as const,
              sharpen: true,
              adaptiveBlockSize: 31,
              adaptiveC: 10,
              morphology: 'open' as const,
            },
          },
          {
            id: 'rank-name-block',
            psm: '6' as const,
            whitelist: RANKING_NAME_WHITELIST,
            preprocess: {
              variantId: 'rank-name-block',
              scale: 2.5,
              contrast: 1.35,
              textChannelMode: 'auto-ranking' as const,
              sharpen: true,
              adaptiveBlockSize: 31,
              adaptiveC: 10,
              morphology: 'close' as const,
            },
          },
          {
            id: 'rank-name-safe',
            psm: '7' as const,
            whitelist: RANKING_NAME_WHITELIST,
            preprocess: {
              variantId: 'rank-name-safe',
              useOpenCv: false,
              scale: 2.1,
              threshold: 126,
              contrast: 1.2,
              textChannelMode: 'auto-ranking' as const,
              morphology: 'none' as const,
            },
          },
          {
            id: 'rank-name-left-zoom',
            psm: '7' as const,
            whitelist: RANKING_NAME_WHITELIST,
            focusRegion: { x: 0, y: 0, width: 0.4, height: 1 },
            preprocess: {
              variantId: 'rank-name-left-zoom',
              scale: 3.0,
              contrast: 1.35,
              textChannelMode: 'auto-ranking' as const,
              sharpen: true,
              adaptiveBlockSize: 29,
              adaptiveC: 9,
              morphology: 'close' as const,
            },
          },
        ]
      : [
          {
            id: args.kind === 'rank' ? 'rank-num-word' : 'rank-metric-word',
            psm: '8' as const,
            whitelist: '0123456789',
            preprocess: {
              variantId: args.kind === 'rank' ? 'rank-num-word' : 'rank-metric-word',
              scale: 2.5,
              contrast: 1.3,
              textChannelMode: 'auto-ranking' as const,
              sharpen: true,
              adaptiveBlockSize: 29,
              adaptiveC: 10,
              morphology: 'open' as const,
            },
          },
          {
            id: args.kind === 'rank' ? 'rank-num-line' : 'rank-metric-line',
            psm: '7' as const,
            whitelist: '0123456789',
            preprocess: {
              variantId: args.kind === 'rank' ? 'rank-num-line' : 'rank-metric-line',
              scale: 2.3,
              contrast: 1.2,
              textChannelMode: 'auto-ranking' as const,
              sharpen: true,
              adaptiveBlockSize: 31,
              adaptiveC: 12,
              morphology: 'close' as const,
            },
          },
          ...(args.kind === 'metric'
            ? [
                {
                  id: 'rank-metric-raw-line',
                  psm: '13' as const,
                  whitelist: '0123456789',
                  preprocess: {
                    variantId: 'rank-metric-raw-line',
                    scale: 2.45,
                    contrast: 1.26,
                    textChannelMode: 'auto-ranking' as const,
                    sharpen: true,
                    adaptiveBlockSize: 29,
                    adaptiveC: 10,
                    morphology: 'open' as const,
                  },
                },
              ]
            : []),
          {
            id: args.kind === 'rank' ? 'rank-num-safe' : 'rank-metric-safe',
            psm: '7' as const,
            whitelist: '0123456789',
            preprocess: {
              variantId: args.kind === 'rank' ? 'rank-num-safe' : 'rank-metric-safe',
              useOpenCv: false,
              scale: 2.2,
              threshold: 120,
              contrast: 1.2,
              textChannelMode: 'auto-ranking' as const,
              morphology: 'none' as const,
            },
          },
        ];

  const traces: OcrPassTrace[] = [];
  const candidates: RankingCandidateTrace[] = [];

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const passCanvas = plan.focusRegion
      ? cropCanvasSubRegion(args.cropped, plan.focusRegion)
      : args.cropped;
    const processed = await preprocessForOCR(passCanvas, plan.preprocess);
    const started = performance.now();
    const recognized = await recognizeGenericWithPass(processed.canvas, {
      psm: plan.psm,
      whitelist: plan.whitelist,
    });
    const durationMs = performance.now() - started;
    const normalized =
      args.kind === 'name'
        ? cleanupRankingName(recognized.rawText)
        : args.kind === 'rank'
          ? normalizeRankDigits(recognized.rawText)
          : normalizeMetricDigits(recognized.rawText);
    const scored = scoreRankingCandidate({
      raw: recognized.rawText,
      normalized,
      confidence: recognized.confidence,
      kind: args.kind,
    });

    traces.push({
      passId: plan.id,
      psm: plan.psm,
      confidence: recognized.confidence,
      rawText: recognized.rawText,
      normalizedText: normalized,
      durationMs,
      preprocess: processed.trace,
      debugImageDataUrl: includeDebugArtifacts ? canvasToDataUrl(processed.canvas) : undefined,
    });

    candidates.push({
      id: `${args.kind}:${plan.id}:${i}`,
      passId: plan.id,
      rawValue: recognized.rawText,
      normalizedValue: normalized,
      confidence: recognized.confidence,
      score: scored.score,
      valid: scored.valid,
      reason: scored.reason,
    });
  }

  candidates.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  let selected = candidates[0];
  let selectedValue = selected.normalizedValue;

  if (args.kind === 'name') {
    const leftZoomCandidate = candidates.find(
      (candidate) =>
        candidate.passId === 'rank-name-left-zoom' && candidate.valid && candidate.normalizedValue
    );
    const primaryCandidate =
      candidates.find(
        (candidate) =>
          candidate.passId !== 'rank-name-left-zoom' &&
          candidate.valid &&
          candidate.normalizedValue.length > 0
      ) || selected;
    if (selected.passId === 'rank-name-left-zoom' && primaryCandidate) {
      selected = primaryCandidate;
    }
    selectedValue = cleanupRankingName(selected.normalizedValue);

    if (leftZoomCandidate) {
      const prefix = extractLikelyAlliancePrefix(leftZoomCandidate.normalizedValue);
      if (prefix) {
        selectedValue = prependAlliancePrefix(selectedValue, prefix);
      }
    }
  }

  const failureReasons: string[] = [];
  if (!selected.valid && selected.reason) failureReasons.push(selected.reason);
  if (selected.confidence < 68) failureReasons.push('low-ocr-confidence');
  if (selected.score < 0.45) failureReasons.push('low-fusion-score');

  return {
    selectedValue: selectedValue,
    selectedConfidence: selected.confidence,
    selectedRaw: selected.rawValue,
    traces,
    candidates,
    failureReasons,
  };
}

interface RankingLayoutPreset {
  rowStartY: number;
  rowStep: number;
  rowHeight: number;
  maxRows: number;
  rankRegion: { x: number; width: number; yOffset: number; heightFactor: number };
  nameMainRegion: { x: number; width: number; yOffset: number; heightFactor: number };
  nameSubRegion: { x: number; width: number; yOffset: number; heightFactor: number };
  metricRegion: { x: number; width: number; yOffset: number; heightFactor: number };
}

interface RankingLayoutScore {
  layout: RankingLayoutPreset;
  score: number;
  reasons: string[];
}

function buildRankingLayoutCandidates(aspectRatio: number): RankingLayoutPreset[] {
  const starts = aspectRatio >= 2
    ? [0.24, 0.248, 0.256, 0.264, 0.272]
    : [0.238, 0.245, 0.252, 0.259, 0.266];
  const steps = aspectRatio >= 2 ? [0.098, 0.108, 0.114, 0.12] : [0.098, 0.102, 0.108, 0.12];

  const candidates: RankingLayoutPreset[] = [];
  for (const rowStartY of starts) {
    for (const rowStep of steps) {
      candidates.push({
        rowStartY,
        rowStep,
        rowHeight: aspectRatio >= 2 ? 0.092 : 0.088,
        maxRows: 12,
        rankRegion: {
          x: 0.19,
          width: 0.07,
          yOffset: 0.06,
          heightFactor: 0.62,
        },
        nameMainRegion: {
          x: 0.255,
          width: 0.42,
          yOffset: 0.08,
          heightFactor: 0.44,
        },
        nameSubRegion: {
          x: 0.265,
          width: 0.36,
          yOffset: 0.54,
          heightFactor: 0.3,
        },
        metricRegion: {
          x: 0.69,
          width: 0.22,
          yOffset: 0.1,
          heightFactor: 0.44,
        },
      });
    }
  }

  return candidates;
}

async function recognizeQuickRankingField(args: {
  cropped: HTMLCanvasElement;
  kind: 'name' | 'metric' | 'rank';
}): Promise<{ value: string; confidence: number }> {
  const processed = await preprocessForOCR(args.cropped, {
    variantId:
      args.kind === 'name'
        ? 'rank-quick-name'
        : args.kind === 'rank'
          ? 'rank-quick-rank'
          : 'rank-quick-metric',
    useOpenCv: false,
    textChannelMode: 'auto-ranking',
    scale: args.kind === 'name' ? 1.9 : args.kind === 'rank' ? 2.2 : 2.0,
    threshold: args.kind === 'name' ? 126 : args.kind === 'rank' ? 118 : 122,
    contrast: 1.2,
    morphology: 'none',
  });
  const recognized = await recognizeGenericWithPass(processed.canvas, {
    psm: args.kind === 'name' ? '7' : '8',
    whitelist:
      args.kind === 'name'
        ? RANKING_NAME_WHITELIST
        : '0123456789',
  });

  const value =
    args.kind === 'name'
      ? cleanupRankingName(recognized.rawText)
      : args.kind === 'rank'
        ? normalizeRankDigits(recognized.rawText)
        : normalizeMetricDigits(recognized.rawText);

  return {
    value,
    confidence: recognized.confidence,
  };
}

function cropRankingSubRegion(args: {
  img: HTMLImageElement;
  rowY: number;
  rowHeight: number;
  region: { x: number; width: number; yOffset: number; heightFactor: number };
}): HTMLCanvasElement {
  return cropRegion(args.img, {
    x: args.region.x,
    y: args.rowY + args.rowHeight * args.region.yOffset,
    width: args.region.width,
    height: args.rowHeight * args.region.heightFactor,
  });
}

function clusterSlotIndices(indices: number[]): number[] {
  if (indices.length === 0) return [];
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const out: number[] = [];
  let cluster: number[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const value = sorted[i];
    if (value - cluster[cluster.length - 1] <= 1) {
      cluster.push(value);
      continue;
    }
    out.push(cluster[Math.floor(cluster.length / 2)]);
    cluster = [value];
  }
  out.push(cluster[Math.floor(cluster.length / 2)]);
  return out;
}

async function detectRankingRowSlots(args: {
  img: HTMLImageElement;
  layout: RankingLayoutPreset;
  rowRule: RankingRowRule;
}) {
  const scored: Array<{
    index: number;
    score: number;
    rankAnchor: boolean;
    metricAnchor: boolean;
    nameAnchor: boolean;
  }> = [];
  const rankAnchors: number[] = [];
  const looseAnchors: number[] = [];

  for (let i = 0; i < args.layout.maxRows; i++) {
    const rowY = args.layout.rowStartY + i * args.layout.rowStep;
    if (rowY + args.layout.rowHeight > 0.98) break;

    const rankCrop = cropRankingSubRegion({
      img: args.img,
      rowY,
      rowHeight: args.layout.rowHeight,
      region: args.layout.rankRegion,
    });
    const nameCrop = cropRankingSubRegion({
      img: args.img,
      rowY,
      rowHeight: args.layout.rowHeight,
      region: args.layout.nameMainRegion,
    });
    const metricCrop = cropRankingSubRegion({
      img: args.img,
      rowY,
      rowHeight: args.layout.rowHeight,
      region: args.layout.metricRegion,
    });

    const [quickRank, quickName, quickMetric] = await Promise.all([
      recognizeQuickRankingField({ cropped: rankCrop, kind: 'rank' }),
      recognizeQuickRankingField({ cropped: nameCrop, kind: 'name' }),
      recognizeQuickRankingField({ cropped: metricCrop, kind: 'metric' }),
    ]);

    const rankNumber = Number(quickRank.value);
    const rankAnchor =
      quickRank.value.length >= 1 &&
      Number.isFinite(rankNumber) &&
      rankNumber >= 1 &&
      rankNumber <= 5000 &&
      quickRank.confidence >= 52;
    const nameAnchor = quickName.value.length >= 2 && quickName.confidence >= 52;
    const metricAnchor =
      quickMetric.value.length >= Math.min(2, args.rowRule.minMetricDigits) &&
      quickMetric.confidence >= 50;

    let score = 0;
    if (rankAnchor) score += 2.4;
    if (metricAnchor) score += 1.3;
    if (nameAnchor) score += 0.9;
    score += (quickRank.confidence + quickMetric.confidence + quickName.confidence) / 270;

    if (rankAnchor) rankAnchors.push(i);
    if (metricAnchor || nameAnchor || rankAnchor) {
      looseAnchors.push(i);
    }

    scored.push({
      index: i,
      score,
      rankAnchor,
      metricAnchor,
      nameAnchor,
    });
  }

  const fromRank = clusterSlotIndices(rankAnchors);
  const clusteredLoose = clusterSlotIndices(looseAnchors);
  const selected = new Set<number>(fromRank);

  if (selected.size < args.rowRule.minRows) {
    for (const index of clusteredLoose) {
      selected.add(index);
      if (selected.size >= args.rowRule.minRows) break;
    }
  }

  const rankedScored = [...scored].sort((a, b) => b.score - a.score);
  for (const candidate of rankedScored) {
    if (selected.size >= Math.max(args.rowRule.minRows + 2, 6)) break;
    selected.add(candidate.index);
  }

  for (const candidate of scored) {
    if (selected.size >= args.layout.maxRows) break;
    selected.add(candidate.index);
  }

  const indices = [...selected].sort((a, b) => a - b).slice(0, args.layout.maxRows);
  return {
    indices,
    scored,
  };
}

async function scoreRankingLayoutCandidate(
  img: HTMLImageElement,
  layout: RankingLayoutPreset
): Promise<RankingLayoutScore> {
  let score = 0;
  const reasons: string[] = [];
  let emptyRows = 0;

  const sampleRows = 3;
  for (let i = 0; i < sampleRows; i++) {
    const rowY = layout.rowStartY + i * layout.rowStep;
    if (rowY + layout.rowHeight > 0.97) break;

    const nameCrop = cropRankingSubRegion({
      img,
      rowY,
      rowHeight: layout.rowHeight,
      region: layout.nameMainRegion,
    });
    const metricCrop = cropRankingSubRegion({
      img,
      rowY,
      rowHeight: layout.rowHeight,
      region: layout.metricRegion,
    });

    const [nameQuick, metricQuick] = await Promise.all([
      recognizeQuickRankingField({ cropped: nameCrop, kind: 'name' }),
      recognizeQuickRankingField({ cropped: metricCrop, kind: 'metric' }),
    ]);

    const nameLooksValid = nameQuick.value.length >= 2;
    const metricLooksValid = metricQuick.value.length >= 2;

    if (nameLooksValid) score += 1.0;
    if (metricLooksValid) score += 1.25;
    score += (nameQuick.confidence + metricQuick.confidence) / 220;

    if (!nameLooksValid && !metricLooksValid) {
      emptyRows += 1;
    }
  }

  if (emptyRows > 0) {
    score -= emptyRows * 0.9;
    reasons.push(`empty-samples:${emptyRows}`);
  }

  reasons.push(`start:${layout.rowStartY.toFixed(3)}`, `step:${layout.rowStep.toFixed(3)}`);
  return {
    layout,
    score,
    reasons,
  };
}

async function selectBestRankingLayout(
  img: HTMLImageElement
): Promise<{ selected: RankingLayoutPreset; scores: RankingLayoutScore[] }> {
  const aspectRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const candidates = buildRankingLayoutCandidates(aspectRatio);
  const scores: RankingLayoutScore[] = [];

  for (const candidate of candidates) {
    scores.push(await scoreRankingLayoutCandidate(img, candidate));
  }

  scores.sort((a, b) => b.score - a.score);
  return {
    selected: scores[0]?.layout || candidates[0],
    scores,
  };
}

function sanitizeSubtitleValue(value: string): string {
  const cleaned = normalizeRankingName(value).replace(/[-_]/g, '').trim();
  return cleaned;
}

function classifySubtitle(value: string): { allianceRaw: string | null; titleRaw: string | null } {
  const subtitle = sanitizeSubtitleValue(value);
  if (!subtitle) return { allianceRaw: null, titleRaw: null };

  const normalized = subtitle.toLowerCase();
  const titleHints = [
    'leader',
    'warlord',
    'envoy',
    'officer',
    'council',
    'r4',
    'r5',
    'king',
    'queen',
  ];

  if (titleHints.some((hint) => normalized === hint || normalized.startsWith(`${hint} `))) {
    return {
      allianceRaw: null,
      titleRaw: subtitle,
    };
  }

  return {
    allianceRaw: subtitle,
    titleRaw: null,
  };
}

function addRowFailureReason(row: RankingRowOcrResult, reason: string): void {
  if (!row.failureReasons.includes(reason)) {
    row.failureReasons.push(reason);
  }
}

function parseMetricBigInt(value: string): bigint | null {
  const digits = normalizeMetricDigits(value);
  if (!digits) return null;
  try {
    return BigInt(digits);
  } catch {
    return null;
  }
}

function applySequentialRankValidation(rows: RankingRowOcrResult[]): number {
  if (rows.length === 0) return 0;

  const anchorIndex = rows.findIndex(
    (row) => typeof row.sourceRank === 'number' && Number.isFinite(row.sourceRank) && row.sourceRank > 0
  );
  const anchorRank = anchorIndex >= 0 ? (rows[anchorIndex].sourceRank as number) : 1;
  const baseRank = Math.max(1, anchorRank - Math.max(0, anchorIndex));

  let corrected = 0;
  for (let i = 0; i < rows.length; i++) {
    const expected = baseRank + i;
    if (rows[i].sourceRank !== expected) {
      rows[i].sourceRank = expected;
      rows[i].confidence = Math.max(0, rows[i].confidence - 5);
      addRowFailureReason(rows[i], 'rank:sequence-corrected');
      corrected += 1;
    }
  }

  return corrected;
}

function selectMonotonicMetricCandidate(args: {
  row: RankingRowOcrResult;
  prevValue: bigint;
  nextValue: bigint | null;
  minMetricDigits: number;
}): { value: string; raw: string; confidence: number } | null {
  const sortedCandidates = [...args.row.candidates.metricValue].sort(
    (a, b) => b.score - a.score || b.confidence - a.confidence
  );

  for (const candidate of sortedCandidates) {
    const digits = normalizeMetricDigits(candidate.normalizedValue || candidate.rawValue);
    if (!digits || digits.length < args.minMetricDigits) continue;
    let numeric: bigint;
    try {
      numeric = BigInt(digits);
    } catch {
      continue;
    }
    if (numeric > args.prevValue) continue;
    if (args.nextValue != null && numeric < args.nextValue) continue;
    return {
      value: digits,
      raw: candidate.rawValue || digits,
      confidence: candidate.confidence,
    };
  }

  return null;
}

function applyIndividualPowerMetricGuards(
  rows: RankingRowOcrResult[],
  rowRule: RankingRowRule
): {
  digitCountOutliers: number;
  monotonicViolations: number;
  monotonicCorrections: number;
} {
  const digitCount = evaluateRankingMetricDigitCountPlausibility(rows.map((row) => row.metricValue), 1);
  for (const index of digitCount.outlierIndices) {
    const row = rows[index];
    if (!row) continue;
    row.confidence = Math.max(0, row.confidence - 8);
    addRowFailureReason(row, 'metric:digit-count-outlier');
  }

  const values = rows.map((row) => parseMetricBigInt(row.metricValue));
  const violations: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const current = values[i];
    if (prev == null || current == null) continue;
    if (current > prev) {
      violations.push(i);
    }
  }

  let monotonicCorrections = 0;
  if (violations.length === 1) {
    const index = violations[0];
    const row = rows[index];
    const prevValue = values[index - 1];
    const nextValue = index + 1 < values.length ? values[index + 1] : null;
    if (row && prevValue != null) {
      const replacement = selectMonotonicMetricCandidate({
        row,
        prevValue,
        nextValue,
        minMetricDigits: rowRule.minMetricDigits,
      });
      if (replacement) {
        row.metricValue = replacement.value;
        row.metricRaw = replacement.raw;
        row.confidence = Math.max(0, Math.min(100, (row.confidence + replacement.confidence) / 2));
        addRowFailureReason(row, 'metric:monotonic-corrected');
        monotonicCorrections += 1;
      } else {
        row.confidence = Math.max(0, row.confidence - 7);
        addRowFailureReason(row, 'metric:monotonic-violation');
      }
    }
  } else if (violations.length > 1) {
    for (const index of violations) {
      const row = rows[index];
      if (!row) continue;
      row.confidence = Math.max(0, row.confidence - 7);
      addRowFailureReason(row, 'metric:monotonic-violation');
    }
  }

  return {
    digitCountOutliers: digitCount.outlierIndices.length,
    monotonicViolations: violations.length,
    monotonicCorrections,
  };
}

function selectBestMetricLabel(values: string[]): string {
  const cleaned = values
    .map((value) =>
      String(value || '')
        .trim()
        .toUpperCase()
        .replace(/\b\d[\d,]*\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .filter((value) => value !== 'NAME');
  if (cleaned.length === 0) return 'METRIC';

  cleaned.sort((a, b) => b.length - a.length);
  return cleaned[0];
}

function scoreCandidate(field: OcrFieldKey, candidate: OcrCandidateTrace): OcrCandidateTrace {
  const confidencePart = (candidate.confidence / 100) * 0.62;
  const breakdown: Record<string, number> = {
    confidence: confidencePart,
  };
  let score = confidencePart;

  if (field === 'governorName') {
    const value = candidate.normalizedValue;
    const lengthPart = value.length >= 1 && value.length <= 40 ? 0.12 : -0.18;
    const allowedChars = value.replace(/[^A-Za-z0-9 _\-\[\]()#.'":|/\\*+&!?@,`~^]/g, '');
    const charRatio = value.length > 0 ? allowedChars.length / value.length : 0;
    const charPart = charRatio * 0.2;
    const validityPart = candidate.validity.valid ? 0.1 : -0.28;
    score += lengthPart + charPart + validityPart;
    breakdown.length = lengthPart;
    breakdown.allowedCharRatio = charPart;
    breakdown.validity = validityPart;
    candidate.score = score;
    candidate.scoreBreakdown = breakdown;
    return candidate;
  }

  const parsed = parseNumericStrict(candidate.normalizedValue);
  if (!parsed.hasDigits || parsed.value == null) {
    score -= 0.45;
    breakdown.digits = -0.45;
  } else {
    score += 0.1;
    breakdown.digits = 0.1;
  }

  const length = parsed.digits.length;
  let lengthPart = 0;
  if (field === 'governorId') {
    if (length >= 6 && length <= 12) {
      lengthPart = 0.16;
    } else {
      lengthPart = -0.22;
    }
  } else if (length >= 1 && length <= 11) {
    lengthPart = 0.08;
  } else {
    lengthPart = -0.16;
  }
  score += lengthPart;
  breakdown.length = lengthPart;

  const validityPart = candidate.validity.valid ? 0.14 : -0.35;
  score += validityPart;
  breakdown.validity = validityPart;

  candidate.score = score;
  candidate.scoreBreakdown = breakdown;
  return candidate;
}

function fuseFieldCandidates(
  field: OcrFieldKey,
  candidates: OcrCandidateTrace[]
): {
  selected: OcrCandidateTrace;
  fusionDecision: OcrFusionDecision;
  lowConfidence: boolean;
  failureReasons: string[];
  selectedPassIndex: number;
} {
  const scored = candidates.map((entry) => scoreCandidate(field, { ...entry }));
  scored.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  const selected = scored[0];
  const second = scored[1];
  const reasons: string[] = [];

  if (!selected.validity.valid) {
    reasons.push(selected.validity.reason || 'validation-failed');
  }
  if (selected.confidence < 70) {
    reasons.push('low-ocr-confidence');
  }
  if (selected.score < 0.55) {
    reasons.push('low-fusion-score');
  }
  if (second && Math.abs(selected.score - second.score) < 0.03) {
    reasons.push('ambiguous-candidates');
  }

  const lowConfidence = reasons.length > 0;
  const fusionDecision: OcrFusionDecision = {
    strategy: 'score-fusion',
    selectedCandidateId: selected.id,
    selectedScore: selected.score,
    alternatives: scored.slice(0, 4).map((entry) => ({
      candidateId: entry.id,
      score: entry.score,
      confidence: entry.confidence,
      normalizedValue: entry.normalizedValue,
    })),
    reasons: reasons.length > 0 ? reasons : ['selected-highest-fusion-score'],
  };

  return {
    selected,
    fusionDecision,
    lowConfidence,
    failureReasons: reasons,
    selectedPassIndex: Math.max(
      0,
      scored.findIndex((candidate) => candidate.id === selected.id)
    ),
  };
}

function buildNumericConsistencyCandidatePool(
  fieldResult: OcrFieldResult
): OcrCandidateTrace[] {
  return [...fieldResult.trace.candidates]
    .filter((candidate) => parseNumericStrict(candidate.normalizedValue).value != null)
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
    .slice(0, 3);
}

function applyCrossFieldConsistency(
  results: Record<OcrFieldKey, OcrFieldResult>
): string[] {
  const kpPool = buildNumericConsistencyCandidatePool(results.killPoints);
  const t4Pool = buildNumericConsistencyCandidatePool(results.t4Kills);
  const t5Pool = buildNumericConsistencyCandidatePool(results.t5Kills);
  if (kpPool.length === 0 || t4Pool.length === 0 || t5Pool.length === 0) return [];

  let best: {
    kp: OcrCandidateTrace;
    t4: OcrCandidateTrace;
    t5: OcrCandidateTrace;
    objective: number;
    penalty: number;
  } | null = null;

  for (const kp of kpPool) {
    for (const t4 of t4Pool) {
      for (const t5 of t5Pool) {
        const kpValue = toNumericValue('killPoints', kp.normalizedValue) || BigInt(0);
        const t4Value = toNumericValue('t4Kills', t4.normalizedValue) || BigInt(0);
        const t5Value = toNumericValue('t5Kills', t5.normalizedValue) || BigInt(0);
        const sum = t4Value + t5Value;
        const inconsistent = kpValue < sum;
        const diff = inconsistent ? Number(sum - kpValue) : 0;
        const denom = Math.max(1, Number(kpValue || BigInt(1)));
        const penalty = inconsistent ? 1.25 + Math.min(2, diff / denom) : 0;
        const objective = kp.score + t4.score + t5.score - penalty;
        if (!best || objective > best.objective) {
          best = { kp, t4, t5, objective, penalty };
        }
      }
    }
  }

  if (!best) return [];

  const updates: Array<{ field: OcrFieldKey; candidate: OcrCandidateTrace }> = [
    { field: 'killPoints', candidate: best.kp },
    { field: 't4Kills', candidate: best.t4 },
    { field: 't5Kills', candidate: best.t5 },
  ];

  const reasons: string[] = [];
  for (const update of updates) {
    const current = results[update.field];
    if (current.trace.fusionDecision.selectedCandidateId === update.candidate.id) continue;
    current.value = update.candidate.normalizedValue;
    current.confidence = update.candidate.confidence;
    current.trace.fusionDecision.selectedCandidateId = update.candidate.id;
    current.trace.fusionDecision.selectedScore = update.candidate.score;
    current.trace.fusionDecision.reasons = [
      ...new Set([
        ...current.trace.fusionDecision.reasons,
        'cross-field-consistency-adjustment',
      ]),
    ];
    current.trace.lowConfidence = current.trace.lowConfidence || best.penalty > 0;
    reasons.push(`${update.field}:adjusted-for-consistency`);
  }

  return reasons;
}

async function processField(args: {
  img: HTMLImageElement;
  field: OcrFieldKey;
  regions: Record<string, { x: number; y: number; width: number; height: number }>;
  templateId: string;
  profileId: string;
  fallback?: OcrFallbackHandler;
  includeDebugArtifacts?: boolean;
}): Promise<OcrFieldResult> {
  const region = args.regions[args.field];
  const cropped = cropRegion(args.img, region);
  const croppedImage = canvasToDataUrl(cropped);
  const passes = getPassPlans(args.field);

  const passTraces: OcrPassTrace[] = [];
  const candidates: OcrCandidateTrace[] = [];

  for (let i = 0; i < passes.length; i++) {
    const pass = passes[i];
    const processed = await preprocessForOCR(cropped, pass.preprocess);
    const started = performance.now();
    const recognized = await recognizeWithPass(processed.canvas, args.field, pass);
    const durationMs = performance.now() - started;
    const normalizedText = normalizeFieldValue(args.field, recognized.rawText);
    const validity = validateNormalizedValue(args.field, normalizedText);

    passTraces.push({
      passId: pass.id,
      psm: pass.psm,
      confidence: recognized.confidence,
      rawText: recognized.rawText,
      normalizedText,
      durationMs,
      preprocess: processed.trace,
      debugImageDataUrl: shouldIncludeDebugArtifacts(args.includeDebugArtifacts)
        ? canvasToDataUrl(processed.canvas)
        : undefined,
    });

    candidates.push({
      id: `${args.field}:${pass.id}:${i}`,
      source: 'pass',
      passId: pass.id,
      rawValue: recognized.rawText,
      normalizedValue: normalizedText,
      confidence: recognized.confidence,
      validity,
      score: 0,
      scoreBreakdown: {},
    });
  }

  const fusion = fuseFieldCandidates(args.field, candidates);
  let selected = fusion.selected;
  let fallbackUsed = false;

  if (args.fallback && (fusion.lowConfidence || fusion.selected.confidence < 65)) {
    const fallbackResult = await args.fallback({
      fieldKey: args.field,
      croppedImage,
      currentValue: fusion.selected.normalizedValue,
      currentConfidence: fusion.selected.confidence,
    });
    if (fallbackResult) {
      const normalizedFallback = normalizeFieldValue(args.field, fallbackResult.value);
      const fallbackCandidate: OcrCandidateTrace = scoreCandidate(args.field, {
        id: `${args.field}:fallback`,
        source: 'fallback',
        rawValue: fallbackResult.value,
        normalizedValue: normalizedFallback,
        confidence: toConfidence(fallbackResult.confidence),
        validity: validateNormalizedValue(args.field, normalizedFallback),
        score: 0,
        scoreBreakdown: {},
      });
      candidates.push(fallbackCandidate);
      if (fallbackCandidate.score > selected.score) {
        selected = fallbackCandidate;
        fallbackUsed = true;
      }
    }
  }

  const selectedPass = Math.max(
    0,
    passTraces.findIndex((pass) => pass.passId === selected.passId)
  );
  const failureReasons = [...fusion.failureReasons];
  if (!selected.validity.valid && selected.validity.reason) {
    failureReasons.push(selected.validity.reason);
  }

  return {
    value: selected.normalizedValue,
    confidence: selected.confidence,
    croppedImage,
    trace: {
      templateId: args.templateId,
      profileId: args.profileId,
      selectedPass,
      passes: passTraces,
      fallbackUsed,
      lowConfidence:
        fusion.lowConfidence || !selected.validity.valid || selected.confidence < 70,
      failureReasons: [...new Set(failureReasons)],
      candidates: [...candidates].sort((a, b) => b.score - a.score),
      fusionDecision: {
        ...fusion.fusionDecision,
        selectedCandidateId: selected.id,
        selectedScore: selected.score,
      },
    },
  };
}

function parseOptions(
  arg1?: ((field: string, index: number, total: number) => void) | ProcessScreenshotOptions,
  arg2?: OcrFallbackHandler
): ProcessScreenshotOptions {
  if (!arg1) return {};
  if (typeof arg1 === 'function') {
    return { onProgress: arg1, fallback: arg2 };
  }
  return arg1;
}

export async function detectScreenArchetype(
  file: File
): Promise<ScreenArchetype | undefined> {
  const img = await loadImage(file);
  try {
    return await detectScreenshotArchetype(img);
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

export async function processRankingScreenshot(
  file: File,
  options?: Omit<ProcessScreenshotOptions, 'fallback'>
): Promise<RankingScreenshotResult> {
  const runStarted = performance.now();
  const img = await loadImage(file);
  const includeDebugArtifacts = shouldIncludeDebugArtifacts(options?.includeDebugArtifacts);

  try {
    const detectedArchetype = await detectScreenshotArchetype(img);
    if (detectedArchetype !== 'rankboard') {
      throw new Error('Screenshot does not match ranking board archetype.');
    }

    const profileSelection = selectBestRuntimeProfile({
      width: img.naturalWidth,
      height: img.naturalHeight,
      profiles: options?.profiles || getTemplateRuntimeProfiles(),
      preferredProfileId: options?.preferredProfileId,
      preferredArchetype: 'rankboard',
    });

    const profile = profileSelection.profile;
    const templateId = profile.sourceTemplateId || profile.profileKey;
    const profileId = profile.id;

    const headerRegions = [
      { x: 0.2, y: 0.01, width: 0.6, height: 0.1 },
      { x: 0.24, y: 0.015, width: 0.52, height: 0.09 },
    ];
    const headerReads = await Promise.all(
      headerRegions.map((region) =>
        recognizeRankingField({
          cropped: cropRegion(img, region),
          kind: 'name',
          includeDebugArtifacts,
        })
      )
    );
    const headerTextCandidates = headerReads
      .map((read) => String(read.selectedValue || '').trim().toUpperCase())
      .filter(Boolean);
    const headerText =
      headerTextCandidates.find((value) => value.includes('RANK')) ||
      [...headerTextCandidates].sort((a, b) => b.length - a.length)[0] ||
      'RANKINGS';
    const detectedBoardTokens = detectBoardTokens(headerText);
    const rankingType = normalizeRankingTypeLabel(headerText);

    const metricHeaderRegions = [
      { x: 0.585, y: 0.132, width: 0.31, height: 0.068 },
      { x: 0.66, y: 0.2, width: 0.23, height: 0.06 },
    ];
    const metricHeaderReads = await Promise.all(
      metricHeaderRegions.map((region) =>
        recognizeRankingField({
          cropped: cropRegion(img, region),
          kind: 'name',
          includeDebugArtifacts,
        })
      )
    );
    const metricHeaderText = selectBestMetricLabel(
      metricHeaderReads.map((read) => read.selectedValue)
    );
    const metricKey = normalizeMetricLabel(metricHeaderText || headerText);
    const strictPair = validateStrictRankingTypeMetricPair(rankingType, metricKey);
    if (!strictPair.ok) {
      throw new Error(
        `unsupported-header: ${
          strictPair.reason ||
          `Unsupported ranking header/metric combination (${rankingType} / ${metricKey}).`
        }`
      );
    }
    const rowRule = RANKING_ROW_RULES[rankingType] || {
      minMetricDigits: 1,
      minRows: 3,
      uniformDominanceRatio: 0.8,
      uniformDominanceMinCount: 4,
    };
    const classificationConfidence =
      (headerReads.reduce((sum, item) => sum + item.selectedConfidence, 0) /
        Math.max(1, headerReads.length)) *
        0.65 +
      (metricHeaderReads.reduce((sum, item) => sum + item.selectedConfidence, 0) /
        Math.max(1, metricHeaderReads.length)) *
        0.35;

    const layoutSelection = await selectBestRankingLayout(img);
    const layout = layoutSelection.selected;
    const slotSelection = await detectRankingRowSlots({
      img,
      layout,
      rowRule,
    });
    const slotIndices = slotSelection.indices;

    const rows: RankingRowOcrResult[] = [];
    let droppedRowCount = 0;
    const droppedReasonCount: Record<string, number> = {};
    let detectedRows = 0;
    const dropRow = (reason: string) => {
      droppedRowCount += 1;
      droppedReasonCount[reason] = (droppedReasonCount[reason] || 0) + 1;
    };
    const preprocessingTrace: Record<string, unknown> = {
      header: headerReads.map((read) => read.traces),
      metricHeader: metricHeaderReads.map((read) => read.traces),
      layout: layoutSelection.scores.map((entry) => ({
        score: entry.score,
        reasons: entry.reasons,
      })),
      selectedLayout: {
        rowStartY: layout.rowStartY,
        rowStep: layout.rowStep,
        rowHeight: layout.rowHeight,
      },
      slotSelection: slotSelection.scored.map((entry) => ({
        index: entry.index,
        score: entry.score,
        rankAnchor: entry.rankAnchor,
        metricAnchor: entry.metricAnchor,
        nameAnchor: entry.nameAnchor,
      })),
      selectedSlots: slotIndices,
      classificationConfidence,
      detectedBoardTokens,
      debugArtifactsEnabled: includeDebugArtifacts,
    };
    const rowCandidates: Record<string, unknown> = {};

    const dedupeKeys = new Set<string>();
    for (const slotIndex of slotIndices) {
      const rowY = layout.rowStartY + slotIndex * layout.rowStep;
      if (rowY + layout.rowHeight > 0.98) break;
      detectedRows += 1;

      const rankCrop = cropRankingSubRegion({
        img,
        rowY,
        rowHeight: layout.rowHeight,
        region: layout.rankRegion,
      });
      const nameMainCrop = cropRankingSubRegion({
        img,
        rowY,
        rowHeight: layout.rowHeight,
        region: layout.nameMainRegion,
      });
      const nameSubCrop = cropRankingSubRegion({
        img,
        rowY,
        rowHeight: layout.rowHeight,
        region: layout.nameSubRegion,
      });
      const metricCrop = cropRankingSubRegion({
        img,
        rowY,
        rowHeight: layout.rowHeight,
        region: layout.metricRegion,
      });

      const [rankField, nameMainField, nameSubField, metricField] = await Promise.all([
        recognizeRankingField({ cropped: rankCrop, kind: 'rank', includeDebugArtifacts }),
        recognizeRankingField({ cropped: nameMainCrop, kind: 'name', includeDebugArtifacts }),
        recognizeRankingField({ cropped: nameSubCrop, kind: 'name', includeDebugArtifacts }),
        recognizeRankingField({ cropped: metricCrop, kind: 'metric', includeDebugArtifacts }),
      ]);

      const rankDigits = normalizeRankDigits(rankField.selectedValue);
      let sourceRank: number | null = rankDigits ? Number(rankDigits) : null;
      if (!sourceRank || !Number.isFinite(sourceRank) || sourceRank < 1 || sourceRank > 5000) {
        const previous = rows[rows.length - 1]?.sourceRank ?? null;
        sourceRank = previous && previous > 0 ? previous + 1 : slotIndex + 1;
      }

      const governorNameSource = cleanupRankingName(nameMainField.selectedValue);
      const subtitleRaw = sanitizeSubtitleValue(nameSubField.selectedValue);
      const subtitleParts = classifySubtitle(subtitleRaw);
      const allianceSplit = splitGovernorNameAndAlliance({
        governorNameRaw: governorNameSource,
        allianceRaw: subtitleParts.allianceRaw,
        subtitleRaw,
      });
      const governorNameRaw = cleanupRankingName(
        allianceSplit.governorNameRaw || governorNameSource
      );
      const invalidNameToken = isRankingHeaderNameToken(governorNameRaw);
      const governorNameNormalized = governorNameRaw
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      const metricRaw = String(metricField.selectedRaw || metricField.selectedValue || '').trim();
      const metricEvidence = extractRankingMetricDigits(metricRaw);
      const metricValue = metricEvidence.digits;
      const metricHeaderArtifact =
        !metricEvidence.hasRawDigit &&
        isMetricHeaderArtifact(metricRaw, metricHeaderText || headerText);

      const lowSignal =
        !governorNameRaw &&
        !metricValue &&
        (nameMainField.selectedConfidence + metricField.selectedConfidence) / 2 < 55;
      if (lowSignal) {
        dropRow('low-signal');
        continue;
      }

      if (invalidNameToken) {
        dropRow('header-row-artifact');
        continue;
      }
      if (!metricEvidence.hasRawDigit) {
        dropRow(metricHeaderArtifact ? 'header-row-artifact' : 'metric-no-raw-digit');
        continue;
      }
      if (metricHeaderArtifact) {
        dropRow('header-row-artifact');
        continue;
      }
      if (metricValue.length < rowRule.minMetricDigits) {
        dropRow('metric-too-short');
        continue;
      }

      const dedupeKey = `${sourceRank || 0}:${governorNameNormalized}:${metricValue}`;
      if (dedupeKeys.has(dedupeKey)) {
        dropRow('duplicate');
        continue;
      }
      dedupeKeys.add(dedupeKey);

      const failureReasons = [
        ...rankField.failureReasons.map((reason) => `rank:${reason}`),
        ...nameMainField.failureReasons.map((reason) => `name:${reason}`),
        ...metricField.failureReasons.map((reason) => `metric:${reason}`),
      ];
      if (invalidNameToken) failureReasons.push('name:header-token');
      if (!metricEvidence.hasRawDigit) failureReasons.push('metric:no-raw-digit');
      if (metricHeaderArtifact) failureReasons.push('metric:header-label-artifact');
      if (metricValue.length < rowRule.minMetricDigits) {
        failureReasons.push('metric:metric-too-short');
      }
      if (metricEvidence.hasSeparatorHint && !metricEvidence.separatorGroupingValid) {
        failureReasons.push('metric:separator-grouping-invalid');
      }

      let confidence =
        (rankField.selectedConfidence +
          nameMainField.selectedConfidence +
          metricField.selectedConfidence +
          nameSubField.selectedConfidence * 0.35) /
        3.35;
      if (metricEvidence.hasSeparatorHint && !metricEvidence.separatorGroupingValid) {
        confidence = Math.max(0, confidence - 7);
      }

      const row: RankingRowOcrResult = {
        rowIndex: slotIndex,
        sourceRank,
        governorNameRaw,
        governorNameNormalized,
        allianceRaw: allianceSplit.allianceRaw || subtitleParts.allianceRaw,
        titleRaw: subtitleParts.titleRaw,
        metricRaw: metricRaw || metricValue,
        metricValue,
        confidence,
        identityStatus: 'UNRESOLVED',
        candidates: {
          rank: rankField.candidates,
          governorName: nameMainField.candidates,
          metricValue: metricField.candidates,
        },
        failureReasons: [...new Set(failureReasons)],
        ocrTrace: {
          rank: rankField.traces,
          governorName: nameMainField.traces,
          subtitle: nameSubField.traces,
          metricValue: metricField.traces,
          allianceDetection: {
            tag: allianceSplit.allianceTag,
            trackedAlliance: allianceSplit.trackedAlliance,
            source: allianceSplit.detectionSource,
            confidence: allianceSplit.confidence,
          },
        },
      };

      rows.push(row);
      rowCandidates[`row-${slotIndex}`] = {
        ...row.candidates,
        subtitle: nameSubField.candidates,
      };
      preprocessingTrace[`row-${slotIndex}`] = row.ocrTrace;
    }

    rows.sort((a, b) => a.rowIndex - b.rowIndex);
    const rankSequenceCorrections = applySequentialRankValidation(rows);
    const individualPowerGuards =
      rankingType === 'individual_power'
        ? applyIndividualPowerMetricGuards(rows, rowRule)
        : {
            digitCountOutliers: 0,
            monotonicViolations: 0,
            monotonicCorrections: 0,
          };

    const guardFailures: string[] = [];
    if (rows.length < rowRule.minRows) {
      guardFailures.push('insufficient-valid-rows');
      if ((droppedReasonCount['header-row-artifact'] || 0) > 0) {
        guardFailures.push('header-row-artifact');
      }
    }
    const uniformity = evaluateRankingMetricUniformity(rows.map((row) => row.metricValue), {
      dominanceRatio: rowRule.uniformDominanceRatio,
      dominanceMinCount: rowRule.uniformDominanceMinCount,
    });
    if (rows.length >= rowRule.minRows && uniformity.suspicious) {
      guardFailures.push('uniform-metric-suspect');
    }

    const averageConfidence =
      rows.length > 0
        ? rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length
        : 0;
    const lowConfidence =
      rows.length === 0 ||
      averageConfidence < 72 ||
      rows.some((row) => row.failureReasons.length > 0) ||
      guardFailures.length > 0;

    preprocessingTrace.guardFailures = guardFailures;
    preprocessingTrace.droppedRowCount = droppedRowCount;
    preprocessingTrace.droppedReasonCount = droppedReasonCount;
    preprocessingTrace.slotCount = slotIndices.length;
    preprocessingTrace.detectedRows = detectedRows;
    preprocessingTrace.validRows = rows.length;
    preprocessingTrace.uniformity = uniformity;
    preprocessingTrace.rankSequenceCorrections = rankSequenceCorrections;
    preprocessingTrace.metricDigitCountOutliers = individualPowerGuards.digitCountOutliers;
    preprocessingTrace.metricMonotonicViolations = individualPowerGuards.monotonicViolations;
    preprocessingTrace.metricMonotonicCorrections = individualPowerGuards.monotonicCorrections;

    if (guardFailures.length > 0) {
      throw new Error(`ranking-guard-failure: ${guardFailures.join(', ')}`);
    }

    return {
      screenArchetype: 'rankboard',
      engineVersion: ENGINE_VERSION,
      headerText: headerText || 'RANKINGS',
      rankingType,
      metricKey,
      rows,
      averageConfidence,
      lowConfidence,
      profileId,
      templateId,
      profileSelection,
      preprocessingTrace,
      rowCandidates,
      metadata: {
        classificationConfidence,
        droppedRowCount,
        guardFailures,
        detectedBoardTokens,
        droppedReasonCount,
        slotCount: slotIndices.length,
        detectedRows,
        validRows: rows.length,
        uniformity,
        rankSequenceCorrections,
        metricDigitCountOutliers: individualPowerGuards.digitCountOutliers,
        metricMonotonicViolations: individualPowerGuards.monotonicViolations,
        metricMonotonicCorrections: individualPowerGuards.monotonicCorrections,
      },
      totalDurationMs: performance.now() - runStarted,
    };
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

export async function processScreenshot(
  file: File,
  arg1?: ((field: string, index: number, total: number) => void) | ProcessScreenshotOptions,
  arg2?: OcrFallbackHandler
): Promise<OcrScreenshotResult> {
  const options = parseOptions(arg1, arg2);
  const runStarted = performance.now();
  const img = await loadImage(file);
  const detectedArchetype = await detectScreenshotArchetype(img);
  const profileSelection = selectBestRuntimeProfile({
    width: img.naturalWidth,
    height: img.naturalHeight,
    profiles: options.profiles || getTemplateRuntimeProfiles(),
    preferredProfileId: options.preferredProfileId,
    preferredArchetype: detectedArchetype,
  });

  const profile = profileSelection.profile;
  const templateId = profile.sourceTemplateId || profile.profileKey;
  const profileId = profile.id;

  const fields = OCR_FIELD_KEYS;
  const results = {} as Record<OcrFieldKey, OcrFieldResult>;
  const normalizationTrace: Record<string, OcrPassTrace[]> = {};
  const candidates: Record<string, OcrCandidateTrace[]> = {};
  const fusionDecision: Record<string, OcrFusionDecision> = {};
  let totalConfidence = 0;

  for (let i = 0; i < fields.length; i++) {
    const key = fields[i];
    options.onProgress?.(key, i, fields.length);
    results[key] = await processField({
      img,
      field: key,
      regions: profile.regions,
      templateId,
      profileId,
      fallback: options.fallback,
      includeDebugArtifacts: options.includeDebugArtifacts,
    });
    normalizationTrace[key] = results[key].trace.passes;
    candidates[key] = results[key].trace.candidates;
    fusionDecision[key] = results[key].trace.fusionDecision;
    totalConfidence += results[key].confidence;
  }

  const consistencyReasons = applyCrossFieldConsistency(results);
  const fieldFailureReasons = Object.values(results).flatMap((field) =>
    field.trace.failureReasons.map((reason) => `${field.trace.profileId}:${reason}`)
  );
  const lowConfidence =
    Object.values(results).some((field) => field.trace.lowConfidence) ||
    totalConfidence / fields.length < 75;

  URL.revokeObjectURL(img.src);

  return {
    governorId: results.governorId,
    governorName: results.governorName,
    power: results.power,
    killPoints: results.killPoints,
    t4Kills: results.t4Kills,
    t5Kills: results.t5Kills,
    deads: results.deads,
    averageConfidence: totalConfidence / fields.length,
    templateId,
    profileId,
    profileSelection,
    detectedArchetype,
    normalizationTrace,
    preprocessingTrace: normalizationTrace,
    candidates,
    fusionDecision,
    lowConfidence,
    failureReasons: [...new Set([...fieldFailureReasons, ...consistencyReasons])],
    totalDurationMs: performance.now() - runStarted,
    engineVersion: ENGINE_VERSION,
  };
}

export async function terminateWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
