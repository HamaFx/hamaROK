import { describe, expect, it } from 'vitest';
import { handleApiError } from '@/lib/api-response';
import { isWeeklySchemaCapabilityError } from '@/lib/weekly-schema-guard';

describe('weekly schema precondition guards', () => {
  it('detects weekly schema capability error signatures', () => {
    expect(isWeeklySchemaCapabilityError({ code: 'P2022' })).toBe(true);
    expect(isWeeklySchemaCapabilityError(new Error('column "weekKey" does not exist'))).toBe(true);
    expect(isWeeklySchemaCapabilityError(new Error('relation "MetricObservation" does not exist'))).toBe(
      true
    );
    expect(isWeeklySchemaCapabilityError(new Error('some other runtime failure'))).toBe(false);
  });

  it('maps schema errors to PRECONDITION_FAILED response', async () => {
    const response = handleApiError(new Error('invalid input value for enum "ActivityMetricKey"'));
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string };
    };

    expect(response.status).toBe(412);
    expect(payload.error?.code).toBe('PRECONDITION_FAILED');
    expect(String(payload.error?.message || '')).toContain('Required database schema updates');
  });
});
