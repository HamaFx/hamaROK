import { describe, expect, it } from 'vitest';
import { buildAwsOcrControlPayload } from '@/lib/aws/ocr-control';

describe('aws ocr control payload', () => {
  it('sets force=false by default', () => {
    const payload = buildAwsOcrControlPayload({ action: 'START' });
    expect(payload.action).toBe('START');
    expect(payload.force).toBe(false);
    expect(payload.source).toBe('ui');
  });

  it('propagates force=true for manual start', () => {
    const payload = buildAwsOcrControlPayload({
      action: 'START',
      source: 'manual-ui',
      force: true,
    });

    expect(payload.force).toBe(true);
    expect(payload.source).toBe('manual-ui');
    expect(typeof payload.requestedAt).toBe('string');
  });
});
