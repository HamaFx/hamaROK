export interface GoldenFieldCase {
  expected: string;
  actual: string;
  confidence: number;
  minConfidence: number;
}

export interface GoldenOcrCase {
  id: string;
  templateId: string;
  minAverageConfidence: number;
  fields: Record<string, GoldenFieldCase>;
}

export interface GoldenCaseResult {
  id: string;
  passed: boolean;
  averageConfidence: number;
  failedFields: Array<{
    field: string;
    reason: string;
    expected: string;
    actual: string;
    confidence: number;
    minConfidence: number;
  }>;
}

const NUMERIC_FIELDS = new Set([
  'governorId',
  'power',
  'killPoints',
  't4Kills',
  't5Kills',
  'deads',
]);

function normalizeText(value: string) {
  return value.replace(/\s+/g, '').trim().toLowerCase();
}

export function evaluateGoldenCase(testCase: GoldenOcrCase): GoldenCaseResult {
  const fields = Object.entries(testCase.fields);
  const failedFields: GoldenCaseResult['failedFields'] = [];
  const averageConfidence =
    fields.reduce((acc, [, field]) => acc + field.confidence, 0) / Math.max(1, fields.length);

  for (const [fieldName, field] of fields) {
    if (normalizeText(field.actual) !== normalizeText(field.expected)) {
      failedFields.push({
        field: fieldName,
        reason: 'text-mismatch',
        expected: field.expected,
        actual: field.actual,
        confidence: field.confidence,
        minConfidence: field.minConfidence,
      });
      continue;
    }

    if (field.confidence < field.minConfidence) {
      failedFields.push({
        field: fieldName,
        reason: 'confidence-too-low',
        expected: field.expected,
        actual: field.actual,
        confidence: field.confidence,
        minConfidence: field.minConfidence,
      });
    }
  }

  if (averageConfidence < testCase.minAverageConfidence) {
    failedFields.push({
      field: '*average*',
      reason: 'average-confidence-too-low',
      expected: String(testCase.minAverageConfidence),
      actual: String(averageConfidence),
      confidence: averageConfidence,
      minConfidence: testCase.minAverageConfidence,
    });
  }

  return {
    id: testCase.id,
    passed: failedFields.length === 0,
    averageConfidence,
    failedFields,
  };
}

export function evaluateGoldenSuite(
  cases: GoldenOcrCase[],
  options?: { numericExactMatchThreshold?: number }
) {
  const results = cases.map((testCase) => evaluateGoldenCase(testCase));
  const failed = results.filter((result) => !result.passed);

  let numericTotal = 0;
  let numericExact = 0;
  for (const testCase of cases) {
    for (const [fieldName, field] of Object.entries(testCase.fields)) {
      if (!NUMERIC_FIELDS.has(fieldName)) continue;
      numericTotal += 1;
      const expected = normalizeText(field.expected).replace(/[^0-9]/g, '');
      const actual = normalizeText(field.actual).replace(/[^0-9]/g, '');
      if (expected === actual) numericExact += 1;
    }
  }

  const numericExactRate = numericTotal > 0 ? numericExact / numericTotal : 1;
  const numericExactMatchThreshold = options?.numericExactMatchThreshold ?? 0.98;
  const numericThresholdPassed = numericExactRate >= numericExactMatchThreshold;

  return {
    total: cases.length,
    passed: cases.length - failed.length,
    failed: failed.length,
    numericTotal,
    numericExact,
    numericExactRate,
    numericExactMatchThreshold,
    numericThresholdPassed,
    results,
  };
}
