import { OcrExtractionStatus } from '@prisma/client';
import type { ValidationResult } from '@/lib/ocr/validators';

export interface ReviewFieldValue {
  value: string;
  confidence: number;
  croppedImage?: string;
  trace?: unknown;
  previousValue?: string | null;
  changed?: boolean;
}

export interface ParsedExtractionValues {
  governorId: ReviewFieldValue;
  governorName: ReviewFieldValue;
  power: ReviewFieldValue;
  killPoints: ReviewFieldValue;
  t4Kills: ReviewFieldValue;
  t5Kills: ReviewFieldValue;
  deads: ReviewFieldValue;
}

export interface ReviewSeverity {
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
}

function toNumberConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value <= 1) return Math.max(0, Math.min(100, value * 100));
  return Math.max(0, Math.min(100, value));
}

function parseField(
  key: string,
  source: Record<string, unknown>,
  confidenceFallback = 0,
  valueFallback = ''
): ReviewFieldValue {
  const raw = source[key];
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return {
      value: String(obj.value ?? valueFallback ?? ''),
      confidence: toNumberConfidence(obj.confidence ?? confidenceFallback),
      croppedImage:
        typeof obj.croppedImage === 'string' ? obj.croppedImage : undefined,
      trace: obj.trace,
    };
  }

  return {
    value: String(raw ?? valueFallback ?? ''),
    confidence: toNumberConfidence(confidenceFallback),
  };
}

export function parseExtractionValues(args: {
  fields: unknown;
  normalized: unknown;
  governorIdRaw?: string | null;
  governorNameRaw?: string | null;
  confidence: number;
}): ParsedExtractionValues {
  const base =
    args.normalized && typeof args.normalized === 'object'
      ? (args.normalized as Record<string, unknown>)
      : args.fields && typeof args.fields === 'object'
        ? (args.fields as Record<string, unknown>)
        : {};

  const sharedConfidence = toNumberConfidence(args.confidence);

  return {
    governorId: parseField('governorId', base, sharedConfidence, args.governorIdRaw || ''),
    governorName: parseField(
      'governorName',
      base,
      sharedConfidence,
      args.governorNameRaw || ''
    ),
    power: parseField('power', base, sharedConfidence),
    killPoints: parseField('killPoints', base, sharedConfidence),
    t4Kills: parseField('t4Kills', base, sharedConfidence),
    t5Kills: parseField('t5Kills', base, sharedConfidence),
    deads: parseField('deads', base, sharedConfidence),
  };
}

export function parseValidation(value: unknown): ValidationResult[] {
  if (!Array.isArray(value)) return [];
  const output: ValidationResult[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const severity =
      item.severity === 'ok' || item.severity === 'warning' || item.severity === 'error'
        ? item.severity
        : 'warning';
    output.push({
      field: String(item.field || ''),
      value: String(item.value || ''),
      isValid: Boolean(item.isValid),
      confidence: toNumberConfidence(item.confidence),
      warning: item.warning ? String(item.warning) : undefined,
      severity,
    });
  }
  return output;
}

export function inferReviewSeverity(args: {
  extractionStatus: OcrExtractionStatus;
  values: ParsedExtractionValues;
  validation: ValidationResult[];
}): ReviewSeverity {
  const reasons: string[] = [];

  if (args.extractionStatus === OcrExtractionStatus.REJECTED) {
    reasons.push('Marked as rejected.');
    return { level: 'LOW', reasons };
  }

  const confidenceValues = [
    args.values.governorId.confidence,
    args.values.governorName.confidence,
    args.values.power.confidence,
    args.values.killPoints.confidence,
    args.values.t4Kills.confidence,
    args.values.t5Kills.confidence,
    args.values.deads.confidence,
  ];

  const minConfidence = Math.min(...confidenceValues);
  if (minConfidence < 55) {
    reasons.push(`Very low confidence field (${Math.round(minConfidence)}%).`);
  } else if (minConfidence < 75) {
    reasons.push(`Low confidence field (${Math.round(minConfidence)}%).`);
  }

  const errors = args.validation.filter((v) => v.severity === 'error');
  const warnings = args.validation.filter((v) => v.severity === 'warning');

  if (errors.length > 0) {
    reasons.push(`${errors.length} validation error(s).`);
  }
  if (warnings.length > 0) {
    reasons.push(`${warnings.length} validation warning(s).`);
  }

  if (errors.length > 0 || minConfidence < 55) {
    return { level: 'HIGH', reasons };
  }
  if (warnings.length > 0 || minConfidence < 75) {
    return { level: 'MEDIUM', reasons };
  }

  reasons.push('OCR confidence and validation are healthy.');
  return { level: 'LOW', reasons };
}

export interface ApprovedSnapshotPayload {
  governorId: string;
  governorName: string;
  power: bigint;
  killPoints: bigint;
  t4Kills: bigint;
  t5Kills: bigint;
  deads: bigint;
}

function cleanNumeric(raw: string): bigint {
  const digits = String(raw || '').replace(/[^0-9-]/g, '');
  if (!digits || digits === '-') return BigInt(0);
  return BigInt(digits);
}

export function toApprovedSnapshotPayload(values: ParsedExtractionValues): ApprovedSnapshotPayload {
  return {
    governorId: values.governorId.value.replace(/[^0-9]/g, ''),
    governorName: values.governorName.value.trim() || 'Unknown',
    power: cleanNumeric(values.power.value),
    killPoints: cleanNumeric(values.killPoints.value),
    t4Kills: cleanNumeric(values.t4Kills.value),
    t5Kills: cleanNumeric(values.t5Kills.value),
    deads: cleanNumeric(values.deads.value),
  };
}
