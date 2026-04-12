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

export function evaluateGoldenSuite(cases: GoldenOcrCase[]) {
  const results = cases.map((testCase) => evaluateGoldenCase(testCase));
  const failed = results.filter((result) => !result.passed);
  return {
    total: cases.length,
    passed: cases.length - failed.length,
    failed: failed.length,
    results,
  };
}
