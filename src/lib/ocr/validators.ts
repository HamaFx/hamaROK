/**
 * Data validation for OCR results
 */

export interface ValidationResult {
  field: string;
  value: string;
  isValid: boolean;
  confidence: number;
  warning?: string;
  severity: 'ok' | 'warning' | 'error';
}

/**
 * Validate extracted governor data
 */
export function validateGovernorData(data: {
  governorId: string;
  name: string;
  power: string;
  killPoints: string;
  t4Kills: string;
  t5Kills: string;
  deads: string;
  confidences: Record<string, number>;
}): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Governor ID: 6-12 digits
  const cleanId = data.governorId.replace(/[^0-9]/g, '');
  results.push({
    field: 'governorId',
    value: data.governorId,
    isValid: /^\d{6,12}$/.test(cleanId),
    confidence: data.confidences.governorId || 0,
    warning: /^\d{6,12}$/.test(cleanId) ? undefined : 'Governor ID should be 6-12 digits',
    severity: /^\d{6,12}$/.test(cleanId) ? 'ok' : 'error',
  });

  // Name: not empty, reasonable length
  results.push({
    field: 'name',
    value: data.name,
    isValid: data.name.length >= 1 && data.name.length <= 30,
    confidence: data.confidences.name || 0,
    warning: data.name.length < 1 ? 'Name is empty' : data.name.length > 30 ? 'Name seems too long' : undefined,
    severity: data.name.length >= 1 && data.name.length <= 30 ? 'ok' : 'warning',
  });

  // Numeric fields validation
  const numericFields = [
    { key: 'power', label: 'Power', min: 100_000, max: 3_000_000_000 },
    { key: 'killPoints', label: 'Kill Points', min: 0, max: 5_000_000_000 },
    { key: 't4Kills', label: 'T4 Kills', min: 0, max: 2_000_000_000 },
    { key: 't5Kills', label: 'T5 Kills', min: 0, max: 2_000_000_000 },
    { key: 'deads', label: 'Deads', min: 0, max: 2_000_000_000 },
  ];

  for (const field of numericFields) {
    const raw = String((data as unknown as Record<string, unknown>)[field.key] || '');
    const num = Number(raw.replace(/[^0-9]/g, ''));
    const isValidNum = !isNaN(num) && num >= field.min && num <= field.max;

    let severity: 'ok' | 'warning' | 'error' = 'ok';
    let warning: string | undefined;

    if (isNaN(num) || raw.replace(/[^0-9]/g, '').length === 0) {
      severity = 'error';
      warning = `${field.label} could not be parsed as a number`;
    } else if (num < field.min) {
      severity = 'warning';
      warning = `${field.label} (${num.toLocaleString()}) seems too low`;
    } else if (num > field.max) {
      severity = 'warning';
      warning = `${field.label} (${num.toLocaleString()}) seems too high`;
    }

    results.push({
      field: field.key,
      value: raw,
      isValid: isValidNum,
      confidence: data.confidences[field.key] || 0,
      warning,
      severity,
    });
  }

  // Cross-field validation: Kill Points should be >= T4 + T5 kills
  const kp = Number(data.killPoints.replace(/[^0-9]/g, ''));
  const t4 = Number(data.t4Kills.replace(/[^0-9]/g, ''));
  const t5 = Number(data.t5Kills.replace(/[^0-9]/g, ''));
  if (!isNaN(kp) && !isNaN(t4) && !isNaN(t5) && kp < t4 + t5) {
    const existing = results.find((r) => r.field === 'killPoints');
    if (existing) {
      existing.severity = 'warning';
      existing.warning = 'Kill points less than T4+T5 sum — check values';
    }
  }

  return results;
}

/**
 * Clean a numeric string from OCR: remove non-digits except commas
 */
export function cleanNumericOcr(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}
