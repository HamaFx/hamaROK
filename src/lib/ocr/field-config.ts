export const OCR_FIELD_KEYS = [
  'governorId',
  'governorName',
  'power',
  'killPoints',
  't4Kills',
  't5Kills',
  'deads',
] as const;

export type OcrFieldKey = (typeof OCR_FIELD_KEYS)[number];

export interface OcrFieldConstraint {
  kind: 'numeric' | 'text';
  minDigits?: number;
  maxDigits?: number;
  minValue?: bigint;
  maxValue?: bigint;
  allowedRegex?: RegExp;
}

const TEXT_ALLOWED = /^[A-Za-z0-9 _\-\[\]()#.'":|/\\*+&!?@,`~^]{1,40}$/;

export const OCR_FIELD_CONSTRAINTS: Record<OcrFieldKey, OcrFieldConstraint> = {
  governorId: {
    kind: 'numeric',
    minDigits: 6,
    maxDigits: 12,
    minValue: BigInt(100000),
    maxValue: BigInt(999999999999),
  },
  governorName: {
    kind: 'text',
    allowedRegex: TEXT_ALLOWED,
  },
  power: {
    kind: 'numeric',
    minDigits: 5,
    maxDigits: 11,
    minValue: BigInt(100000),
    maxValue: BigInt(3000000000),
  },
  killPoints: {
    kind: 'numeric',
    minDigits: 1,
    maxDigits: 11,
    minValue: BigInt(0),
    maxValue: BigInt(5000000000),
  },
  t4Kills: {
    kind: 'numeric',
    minDigits: 1,
    maxDigits: 10,
    minValue: BigInt(0),
    maxValue: BigInt(2000000000),
  },
  t5Kills: {
    kind: 'numeric',
    minDigits: 1,
    maxDigits: 10,
    minValue: BigInt(0),
    maxValue: BigInt(2000000000),
  },
  deads: {
    kind: 'numeric',
    minDigits: 1,
    maxDigits: 10,
    minValue: BigInt(0),
    maxValue: BigInt(2000000000),
  },
};

export interface NumericParse {
  digits: string;
  value: bigint | null;
  hasDigits: boolean;
}

export function parseNumericStrict(raw: string): NumericParse {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '');
  if (!digits) {
    return { digits, value: null, hasDigits: false };
  }
  try {
    return { digits, value: BigInt(digits), hasDigits: true };
  } catch {
    return { digits, value: null, hasDigits: true };
  }
}

export function sanitizeGovernorName(raw: string): string {
  return String(raw ?? '')
    .replace(/[^A-Za-z0-9 _\-\[\]()#.'":|/\\*+&!?@,`~^]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

export function normalizeFieldValue(field: OcrFieldKey, raw: string): string {
  if (field === 'governorName') {
    return sanitizeGovernorName(raw);
  }
  return parseNumericStrict(raw).digits;
}

export function validateNormalizedValue(
  field: OcrFieldKey,
  normalized: string
): { valid: boolean; reason?: string } {
  const constraint = OCR_FIELD_CONSTRAINTS[field];
  if (constraint.kind === 'text') {
    const name = sanitizeGovernorName(normalized);
    if (!name) return { valid: false, reason: 'name-empty' };
    if (constraint.allowedRegex && !constraint.allowedRegex.test(name)) {
      return { valid: false, reason: 'name-invalid-chars' };
    }
    return { valid: true };
  }

  const parsed = parseNumericStrict(normalized);
  if (!parsed.hasDigits || parsed.value == null) {
    return { valid: false, reason: 'missing-digits' };
  }

  if (
    typeof constraint.minDigits === 'number' &&
    parsed.digits.length < constraint.minDigits
  ) {
    return { valid: false, reason: 'digits-too-short' };
  }

  if (
    typeof constraint.maxDigits === 'number' &&
    parsed.digits.length > constraint.maxDigits
  ) {
    return { valid: false, reason: 'digits-too-long' };
  }

  if (constraint.minValue != null && parsed.value < constraint.minValue) {
    return { valid: false, reason: 'below-range' };
  }
  if (constraint.maxValue != null && parsed.value > constraint.maxValue) {
    return { valid: false, reason: 'above-range' };
  }

  return { valid: true };
}

export function toNumericValue(field: OcrFieldKey, normalized: string): bigint | null {
  if (field === 'governorName') return null;
  return parseNumericStrict(normalized).value;
}
