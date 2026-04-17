import { describe, expect, it } from 'vitest';
import {
  normalizeFieldValue,
  parseNumericStrict,
  sanitizeGovernorName,
  validateNormalizedValue,
} from '@/lib/ocr/field-config';

describe('ocr field constraints', () => {
  it('normalizes numeric fields to digits only', () => {
    expect(normalizeFieldValue('power', '12,345,678')).toBe('12345678');
    expect(normalizeFieldValue('governorId', 'ID: 00112233')).toBe('00112233');
  });

  it('validates governorId hard constraints', () => {
    expect(validateNormalizedValue('governorId', '12345').valid).toBe(false);
    expect(validateNormalizedValue('governorId', '123456').valid).toBe(true);
    expect(validateNormalizedValue('governorId', '1234567890123').valid).toBe(false);
  });

  it('parses bigint-safe numeric strings', () => {
    const parsed = parseNumericStrict('9,876,543,210');
    expect(parsed.value).toBe(BigInt('9876543210'));
    expect(parsed.hasDigits).toBe(true);
  });

  it('supports richer governor names up to 40 characters', () => {
    const name = "[V`57] Monkey D Luffy, Captain of ~Wano^";
    const sanitized = sanitizeGovernorName(name);
    expect(sanitized).toBe("[V`57] Monkey D Luffy, Captain of ~Wano^");
    expect(validateNormalizedValue('governorName', sanitized).valid).toBe(true);

    const long = `${'A'.repeat(25)} ${'B'.repeat(25)}`;
    expect(sanitizeGovernorName(long).length).toBe(40);
  });
});
