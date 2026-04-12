import { describe, expect, it } from 'vitest';
import { hashRequestPayload } from '@/lib/security';

describe('security hashing', () => {
  it('produces deterministic request hash independent of key order', () => {
    const left = hashRequestPayload({ a: 1, b: { x: 2, y: 3 } });
    const right = hashRequestPayload({ b: { y: 3, x: 2 }, a: 1 });
    expect(left).toBe(right);
  });
});
