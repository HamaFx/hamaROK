import { describe, expect, it } from 'vitest';
import { resolveOcrEnginePolicy } from '@/lib/ocr/engine-policy';

describe('ocr engine policy resolver', () => {
  it('defaults to mistral when no inputs provided', () => {
    const policy = resolveOcrEnginePolicy({});
    expect(policy.requested).toBe('mistral');
    expect(policy.effective).toBe('mistral');
    expect(policy.reason).toBe('env_default');
    expect(policy.locked).toBe(false);
  });

  it('allows owner legacy override when env allows legacy', () => {
    const policy = resolveOcrEnginePolicy({
      envRequested: 'mistral',
      workspaceRequested: 'legacy',
      allowLegacy: true,
    });
    expect(policy.requested).toBe('legacy');
    expect(policy.effective).toBe('legacy');
    expect(policy.reason).toBe('workspace_override');
    expect(policy.locked).toBe(false);
  });

  it('forces legacy request back to mistral when legacy is blocked', () => {
    const policy = resolveOcrEnginePolicy({
      envRequested: 'mistral',
      workspaceRequested: 'legacy',
      allowLegacy: false,
    });
    expect(policy.requested).toBe('legacy');
    expect(policy.effective).toBe('mistral');
    expect(policy.reason).toBe('legacy_blocked');
    expect(policy.locked).toBe(true);
  });
});

