import { describe, expect, it } from 'vitest';
import { inferReviewSeverity, parseExtractionValues, toApprovedSnapshotPayload } from '@/lib/review-queue';

describe('review queue helpers', () => {
  it('classifies high severity when confidence is low and validation errors exist', () => {
    const values = parseExtractionValues({
      fields: {
        governorId: { value: '12345', confidence: 42 },
        governorName: { value: 'A', confidence: 40 },
        power: { value: '1000', confidence: 41 },
      },
      normalized: null,
      governorIdRaw: '12345',
      governorNameRaw: 'A',
      confidence: 0.41,
    });

    const severity = inferReviewSeverity({
      extractionStatus: 'RAW',
      values,
      validation: [
        {
          field: 'governorId',
          value: '12345',
          isValid: false,
          confidence: 42,
          warning: 'Governor ID should be 6-12 digits',
          severity: 'error',
        },
      ],
    });

    expect(severity.level).toBe('HIGH');
    expect(severity.reasons.length).toBeGreaterThan(0);
  });

  it('builds approved payload and normalizes numeric values', () => {
    const values = parseExtractionValues({
      fields: {
        governorId: { value: 'ID: 987654321', confidence: 90 },
        governorName: { value: ' Nova ', confidence: 92 },
        power: { value: '125,000,000', confidence: 88 },
        killPoints: { value: '400,000,000', confidence: 88 },
        t4Kills: { value: '4,500,000', confidence: 85 },
        t5Kills: { value: '2,200,000', confidence: 86 },
        deads: { value: '900,000', confidence: 87 },
      },
      normalized: null,
      governorIdRaw: null,
      governorNameRaw: null,
      confidence: 90,
    });

    const payload = toApprovedSnapshotPayload(values);
    expect(payload.governorId).toBe('987654321');
    expect(payload.governorName).toBe('Nova');
    expect(payload.power).toBe(BigInt('125000000'));
    expect(payload.killPoints).toBe(BigInt('400000000'));
  });
});
