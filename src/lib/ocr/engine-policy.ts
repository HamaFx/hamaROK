export type OcrEngine = 'mistral' | 'legacy';

export interface ResolvedOcrEnginePolicy {
  requested: OcrEngine;
  effective: OcrEngine;
  reason: 'workspace_override' | 'env_default' | 'legacy_blocked';
  legacyAllowed: boolean;
  envRequested: OcrEngine;
  workspaceRequested: OcrEngine | null;
  locked: boolean;
}

function normalizeEngine(value: unknown): OcrEngine | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'mistral' || normalized === 'legacy') {
    return normalized;
  }
  return null;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

export function resolveOcrEnginePolicy(args: {
  envRequested?: unknown;
  workspaceRequested?: unknown;
  allowLegacy?: unknown;
}): ResolvedOcrEnginePolicy {
  const envRequested = normalizeEngine(args.envRequested) || 'mistral';
  const workspaceRequested = normalizeEngine(args.workspaceRequested);
  const requested = workspaceRequested || envRequested;
  const legacyAllowed = normalizeBoolean(args.allowLegacy);

  if (requested === 'legacy' && !legacyAllowed) {
    return {
      requested,
      effective: 'mistral',
      reason: 'legacy_blocked',
      legacyAllowed,
      envRequested,
      workspaceRequested,
      locked: true,
    };
  }

  return {
    requested,
    effective: requested,
    reason: workspaceRequested ? 'workspace_override' : 'env_default',
    legacyAllowed,
    envRequested,
    workspaceRequested,
    locked: false,
  };
}

