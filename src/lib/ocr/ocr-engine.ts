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

const ENGINE_VERSION = 'ocr-v3.0.0';
export type ScreenArchetype = 'governor-profile' | 'rankboard';

interface OcrPassPlan {
  id: string;
  psm: '6' | '7' | '8';
  preprocess: PreprocessOptions;
  whitelist?: string;
}

export interface OcrPassTrace {
  passId: string;
  psm: '6' | '7' | '8';
  confidence: number;
  rawText: string;
  normalizedText: string;
  durationMs: number;
  preprocess: PreprocessTrace;
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
}

let worker: Worker | null = null;

function toConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 1) return Math.max(0, Math.min(100, value * 100));
  return Math.max(0, Math.min(100, value));
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
  const psmMode =
    pass.psm === '6'
      ? PSM.SINGLE_BLOCK
      : pass.psm === '7'
        ? PSM.SINGLE_LINE
        : PSM.SINGLE_WORD;
  await w.setParameters({
    tessedit_pageseg_mode: psmMode,
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
    const header = cropRegion(img, {
      x: 0.26,
      y: 0.02,
      width: 0.48,
      height: 0.1,
    });
    const processed = await preprocessForOCR(header, {
      variantId: 'archetype-header',
      useOpenCv: false,
      scale: 2.2,
      threshold: 132,
      contrast: 1.35,
      invert: true,
    });
    const w = await initializeWorker();
    await w.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    const { data } = await w.recognize(processed.canvas);
    const text = String(data.text || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (text.includes('GOVERNOR PROFILE') || text.includes('PROFILE')) {
      return 'governor-profile';
    }
    if (text.includes('RANKINGS')) {
      return 'rankboard';
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function normalizeRankingTypeLabel(value: string): string {
  return (
    String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/RANKINGS?/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown'
  );
}

function normalizeMetricLabel(value: string): string {
  const cleaned = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'metric';
  return cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'metric';
}

function normalizeRankingName(value: string): string {
  return String(value || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[^A-Za-z0-9 _\-\[\]()#.'":|/\\*+&!?@]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

function normalizeRankDigits(value: string): string {
  return String(value || '').replace(/[^0-9]/g, '').slice(0, 4);
}

function normalizeMetricDigits(value: string): string {
  return String(value || '').replace(/[^0-9]/g, '').slice(0, 14);
}

async function recognizeGenericWithPass(
  canvas: HTMLCanvasElement,
  pass: { psm: '6' | '7' | '8'; whitelist?: string }
): Promise<{ rawText: string; confidence: number }> {
  const w = await initializeWorker();
  const psmMode =
    pass.psm === '6'
      ? PSM.SINGLE_BLOCK
      : pass.psm === '7'
        ? PSM.SINGLE_LINE
        : PSM.SINGLE_WORD;
  await w.setParameters({
    tessedit_pageseg_mode: psmMode,
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
    if (!args.normalized) {
      valid = false;
      reason = 'empty-name';
      score -= 0.45;
    } else {
      const lengthBonus = Math.min(0.2, args.normalized.length / 70);
      score += lengthBonus;
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

async function recognizeRankingField(args: {
  cropped: HTMLCanvasElement;
  kind: 'name' | 'metric' | 'rank';
}): Promise<{
  selectedValue: string;
  selectedConfidence: number;
  selectedRaw: string;
  traces: OcrPassTrace[];
  candidates: RankingCandidateTrace[];
  failureReasons: string[];
}> {
  const plans =
    args.kind === 'name'
      ? [
          {
            id: 'rank-name-line',
            psm: '7' as const,
            whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 []()_#.-:+/\\\\|*',
            preprocess: {
              variantId: 'rank-name-line',
              scale: 2.2,
              contrast: 1.25,
              adaptiveBlockSize: 33,
              adaptiveC: 11,
              morphology: 'open' as const,
            },
          },
          {
            id: 'rank-name-safe',
            psm: '7' as const,
            whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 []()_#.-:+/\\\\|*',
            preprocess: {
              variantId: 'rank-name-safe',
              useOpenCv: false,
              scale: 2.1,
              threshold: 126,
              contrast: 1.2,
              morphology: 'none' as const,
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
              adaptiveBlockSize: 31,
              adaptiveC: 12,
              morphology: 'close' as const,
            },
          },
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
              morphology: 'none' as const,
            },
          },
        ];

  const traces: OcrPassTrace[] = [];
  const candidates: RankingCandidateTrace[] = [];

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const processed = await preprocessForOCR(args.cropped, plan.preprocess);
    const started = performance.now();
    const recognized = await recognizeGenericWithPass(processed.canvas, {
      psm: plan.psm,
      whitelist: plan.whitelist,
    });
    const durationMs = performance.now() - started;
    const normalized =
      args.kind === 'name'
        ? normalizeRankingName(recognized.rawText)
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
  const selected = candidates[0];
  const failureReasons: string[] = [];
  if (!selected.valid && selected.reason) failureReasons.push(selected.reason);
  if (selected.confidence < 68) failureReasons.push('low-ocr-confidence');
  if (selected.score < 0.45) failureReasons.push('low-fusion-score');

  return {
    selectedValue: selected.normalizedValue,
    selectedConfidence: selected.confidence,
    selectedRaw: selected.rawValue,
    traces,
    candidates,
    failureReasons,
  };
}

function scoreCandidate(field: OcrFieldKey, candidate: OcrCandidateTrace): OcrCandidateTrace {
  const confidencePart = (candidate.confidence / 100) * 0.62;
  const breakdown: Record<string, number> = {
    confidence: confidencePart,
  };
  let score = confidencePart;

  if (field === 'governorName') {
    const value = candidate.normalizedValue;
    const lengthPart = value.length >= 1 && value.length <= 30 ? 0.12 : -0.18;
    const allowedChars = value.replace(/[^A-Za-z0-9 _\-\[\]()#.'":|/\\*+&!?@]/g, '');
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

    const headerCanvas = cropRegion(img, {
      x: 0.22,
      y: 0.01,
      width: 0.56,
      height: 0.1,
    });
    const headerField = await recognizeRankingField({
      cropped: headerCanvas,
      kind: 'name',
    });
    const headerText = headerField.selectedValue.toUpperCase();
    const rankingType = normalizeRankingTypeLabel(headerText);

    const metricHeaderCanvas = cropRegion(img, {
      x: 0.66,
      y: 0.2,
      width: 0.23,
      height: 0.06,
    });
    const metricHeaderField = await recognizeRankingField({
      cropped: metricHeaderCanvas,
      kind: 'name',
    });
    const metricHeaderText = metricHeaderField.selectedValue.toUpperCase();
    const metricKey = normalizeMetricLabel(metricHeaderText || headerText);

    const rows: RankingRowOcrResult[] = [];
    const preprocessingTrace: Record<string, unknown> = {
      header: headerField.traces,
      metricHeader: metricHeaderField.traces,
    };
    const rowCandidates: Record<string, unknown> = {};

    const rowStartY = 0.255;
    const rowStep = 0.116;
    const rowHeight = 0.088;
    const maxRows = 8;

    for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
      const y = rowStartY + rowIndex * rowStep;
      if (y + rowHeight > 0.98) break;

      const rankCrop = cropRegion(img, {
        x: 0.175,
        y,
        width: 0.095,
        height: rowHeight,
      });
      const nameCrop = cropRegion(img, {
        x: 0.265,
        y,
        width: 0.4,
        height: rowHeight,
      });
      const metricCrop = cropRegion(img, {
        x: 0.69,
        y,
        width: 0.22,
        height: rowHeight,
      });

      const [rankField, nameField, metricField] = await Promise.all([
        recognizeRankingField({ cropped: rankCrop, kind: 'rank' }),
        recognizeRankingField({ cropped: nameCrop, kind: 'name' }),
        recognizeRankingField({ cropped: metricCrop, kind: 'metric' }),
      ]);

      let sourceRank: number | null = rankField.selectedValue
        ? Number(rankField.selectedValue)
        : null;
      if (!sourceRank || !Number.isFinite(sourceRank)) {
        sourceRank = rowIndex + 1;
      }
      if (sourceRank < 1 || sourceRank > 5000) {
        sourceRank = null;
      }

      const governorNameRaw = normalizeRankingName(nameField.selectedValue);
      const governorNameNormalized = governorNameRaw
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      const metricRaw = metricField.selectedValue;
      const metricValue = normalizeMetricDigits(metricRaw);

      const lowSignal =
        !governorNameRaw &&
        !metricValue &&
        (nameField.selectedConfidence + metricField.selectedConfidence) / 2 < 55;
      if (lowSignal) {
        continue;
      }

      const failureReasons = [
        ...rankField.failureReasons.map((reason) => `rank:${reason}`),
        ...nameField.failureReasons.map((reason) => `name:${reason}`),
        ...metricField.failureReasons.map((reason) => `metric:${reason}`),
      ];

      const confidence =
        (rankField.selectedConfidence + nameField.selectedConfidence + metricField.selectedConfidence) /
        3;

      const row: RankingRowOcrResult = {
        rowIndex,
        sourceRank,
        governorNameRaw,
        governorNameNormalized,
        metricRaw: metricValue || metricRaw,
        metricValue,
        confidence,
        identityStatus: 'UNRESOLVED',
        candidates: {
          rank: rankField.candidates,
          governorName: nameField.candidates,
          metricValue: metricField.candidates,
        },
        failureReasons: [...new Set(failureReasons)],
        ocrTrace: {
          rank: rankField.traces,
          governorName: nameField.traces,
          metricValue: metricField.traces,
        },
      };

      rows.push(row);
      rowCandidates[`row-${rowIndex}`] = row.candidates;
      preprocessingTrace[`row-${rowIndex}`] = row.ocrTrace;
    }

    const averageConfidence =
      rows.length > 0
        ? rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length
        : 0;
    const lowConfidence =
      rows.length === 0 ||
      averageConfidence < 72 ||
      rows.some((row) => row.failureReasons.length > 0);

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
