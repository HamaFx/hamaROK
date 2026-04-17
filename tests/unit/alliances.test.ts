import { describe, expect, it } from 'vitest';
import {
  PRIMARY_KINGDOM_NUMBER,
  detectTrackedAlliance,
  resolveAllianceQueryFilters,
  splitGovernorNameAndAlliance,
} from '@/lib/alliances';

describe('alliance detection helpers', () => {
  it('detects tracked alliance from governor name tag', () => {
    const detected = detectTrackedAlliance({
      governorNameRaw: '[GODt] Gd Hama',
    });

    expect(detected?.tag).toBe('GODt');
    expect(detected?.canonicalLabel).toBe('[GODt] GOD of Thunder');
  });

  it('detects tracked alliance from alliance display text', () => {
    const detected = detectTrackedAlliance({
      allianceRaw: 'Legacy of Velmora',
    });

    expect(detected?.tag).toBe('V57');
    expect(detected?.canonicalLabel).toBe('[V57] Legacy of Velmora');
  });

  it('uses weak Gd prefix hint for GODt when bracket tag is missing', () => {
    const detected = detectTrackedAlliance({
      governorNameRaw: 'GdMarshall',
      allianceRaw: '',
    });

    expect(detected?.tag).toBe('GODt');
    expect(detected?.canonicalLabel).toBe('[GODt] GOD of Thunder');
  });

  it('splits alliance tag from governor name and keeps clean name', () => {
    const split = splitGovernorNameAndAlliance({
      governorNameRaw: '[P57R] xPortgas Ace',
      allianceRaw: null,
    });

    expect(split.governorNameRaw).toBe('xPortgas Ace');
    expect(split.allianceTag).toBe('P57R');
    expect(split.allianceRaw).toBe('[P57R] PHOENIX RISING 4057');
  });

  it('strips OCR-noisy tracked alliance prefixes from governor names', () => {
    const split = splitGovernorNameAndAlliance({
      governorNameRaw: '[V 57] : Monkey D Luffy',
      allianceRaw: null,
    });

    expect(split.governorNameRaw).toBe('Monkey D Luffy');
    expect(split.allianceTag).toBe('V57');
    expect(split.allianceRaw).toBe('[V57] Legacy of Velmora');
  });

  it('detects V57 aliases with apostrophe/backtick variants', () => {
    const apostrophe = detectTrackedAlliance({
      governorNameRaw: "[V'57] Monkey D Luffy",
    });
    const backtick = detectTrackedAlliance({
      governorNameRaw: '[V`57] Monkey D Luffy',
    });

    expect(apostrophe?.tag).toBe('V57');
    expect(backtick?.tag).toBe('V57');
  });

  it('normalizes alliance query filters with tracked aliases', () => {
    const filters = resolveAllianceQueryFilters(['god of thunder', '[V57]', 'P57R']);
    expect(filters).toEqual([
      '[GODt] GOD of Thunder',
      '[V57] Legacy of Velmora',
      '[P57R] PHOENIX RISING 4057',
    ]);
  });

  it('keeps fixed kingdom number for this deployment', () => {
    expect(PRIMARY_KINGDOM_NUMBER).toBe('4057');
  });
});
