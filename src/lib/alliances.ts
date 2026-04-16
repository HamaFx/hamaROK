export const PRIMARY_KINGDOM_NUMBER = '4057';

export interface TrackedAlliance {
  tag: 'GODt' | 'V57' | 'P57R';
  name: string;
  kingdomNumber: typeof PRIMARY_KINGDOM_NUMBER;
  aliases: string[];
}

export interface AllianceDetection {
  tracked: boolean;
  tag: string;
  name: string;
  canonicalLabel: string;
  source: 'name-tag' | 'alliance-hint' | 'text-alias';
  confidence: number;
}

export interface SplitGovernorAllianceResult {
  governorNameRaw: string;
  allianceRaw: string | null;
  allianceTag: string | null;
  trackedAlliance: boolean;
  detectionSource: AllianceDetection['source'] | null;
  confidence: number;
}

export const TRACKED_ALLIANCES: TrackedAlliance[] = [
  {
    tag: 'GODt',
    name: 'GOD of Thunder',
    kingdomNumber: PRIMARY_KINGDOM_NUMBER,
    aliases: [
      'GODT',
      'GOD OF THUNDER',
      'GOD OFTHUNDER',
      'GODTHUNDER',
      '[GODT]',
    ],
  },
  {
    tag: 'V57',
    name: 'Legacy of Velmora',
    kingdomNumber: PRIMARY_KINGDOM_NUMBER,
    aliases: [
      'V57',
      '[V57]',
      '[V 57]',
      'LEGACY OF VELMORA',
      'LEGACY VELMORA',
      'VELMORA',
    ],
  },
  {
    tag: 'P57R',
    name: 'PHOENIX RISING 4057',
    kingdomNumber: PRIMARY_KINGDOM_NUMBER,
    aliases: [
      'P57R',
      '[P57R]',
      'PHOENIX RISING',
      'PHOENIX RISING 4057',
      'PHOENIXRISING',
      'PHOENIXRISING4057',
    ],
  },
];

const TAG_LOOKUP = new Map(
  TRACKED_ALLIANCES.map((alliance) => [normalizeAllianceToken(alliance.tag), alliance])
);

const ALIAS_LOOKUP = new Map<string, TrackedAlliance>();
for (const alliance of TRACKED_ALLIANCES) {
  for (const alias of alliance.aliases) {
    ALIAS_LOOKUP.set(normalizeAllianceToken(alias), alliance);
  }
}

export function normalizeAllianceToken(value: string): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function formatAllianceLabel(alliance: Pick<TrackedAlliance, 'tag' | 'name'>): string {
  return `[${alliance.tag}] ${alliance.name}`;
}

export function sanitizeGovernorNameForAlliance(value: string): string {
  return String(value || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

export function sanitizeAllianceDisplay(value: string): string {
  return String(value || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[^A-Za-z0-9 _\-\[\]()#.'":|/\\*+&!?@]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function detectByBracketTag(value: string): TrackedAlliance | null {
  const match = String(value || '').match(/[\[\(]([^\]\)]{2,12})[\]\)]?/);
  if (!match) return null;
  const normalized = normalizeAllianceToken(match[1]);
  return TAG_LOOKUP.get(normalized) || null;
}

function detectByAlias(value: string): TrackedAlliance | null {
  const normalized = normalizeAllianceToken(value);
  if (!normalized) return null;

  const direct = ALIAS_LOOKUP.get(normalized);
  if (direct) return direct;

  for (const [aliasNormalized, alliance] of ALIAS_LOOKUP.entries()) {
    if (!aliasNormalized || aliasNormalized.length < 3) continue;
    if (normalized.includes(aliasNormalized) || aliasNormalized.includes(normalized)) {
      return alliance;
    }
  }

  return null;
}

function detectByWeakGovernorPrefix(value: string): TrackedAlliance | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^gd[\s._-]/i.test(raw) || /^gd[a-z0-9]/i.test(raw)) {
    return TRACKED_ALLIANCES.find((alliance) => alliance.tag === 'GODt') || null;
  }
  return null;
}

export function detectTrackedAlliance(args: {
  governorNameRaw?: string | null;
  allianceRaw?: string | null;
  additionalText?: Array<string | null | undefined>;
}): AllianceDetection | null {
  const sources: Array<{
    text: string;
    source: AllianceDetection['source'];
    confidence: number;
  }> = [
    {
      text: String(args.governorNameRaw || ''),
      source: 'name-tag',
      confidence: 0.98,
    },
    {
      text: String(args.allianceRaw || ''),
      source: 'alliance-hint',
      confidence: 0.93,
    },
    ...((args.additionalText || [])
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => ({
        text: entry,
        source: 'text-alias' as const,
        confidence: 0.85,
      }))),
  ];

  for (const source of sources) {
    const raw = source.text.trim();
    if (!raw) continue;

    const byTag = detectByBracketTag(raw);
    if (byTag) {
      return {
        tracked: true,
        tag: byTag.tag,
        name: byTag.name,
        canonicalLabel: formatAllianceLabel(byTag),
        source: source.source,
        confidence: source.confidence,
      };
    }

    const byAlias = detectByAlias(raw);
    if (byAlias) {
      return {
        tracked: true,
        tag: byAlias.tag,
        name: byAlias.name,
        canonicalLabel: formatAllianceLabel(byAlias),
        source: source.source,
        confidence: source.confidence - 0.05,
      };
    }

    const byPrefix = detectByWeakGovernorPrefix(raw);
    if (byPrefix) {
      return {
        tracked: true,
        tag: byPrefix.tag,
        name: byPrefix.name,
        canonicalLabel: formatAllianceLabel(byPrefix),
        source: source.source,
        confidence: Math.max(0.5, source.confidence - 0.38),
      };
    }
  }

  return null;
}

function stripKnownAlliancePrefix(value: string): string {
  const text = sanitizeGovernorNameForAlliance(value);
  if (!text) return '';

  const normalizedLeading = text.replace(/^[^A-Za-z0-9\[\(]+/, '');
  const bracketPrefix = normalizedLeading.match(
    /^[\[\(]\s*([A-Za-z0-9][A-Za-z0-9 ._-]{1,11})\s*[\]\)]?\s*(.+)$/
  );
  if (bracketPrefix) {
    const tag = normalizeAllianceToken(bracketPrefix[1]);
    if (TAG_LOOKUP.has(tag)) {
      return sanitizeGovernorNameForAlliance(
        String(bracketPrefix[2] || '').replace(/^[\s._\-:|/\\]+/, '')
      );
    }
  }

  // Handle OCR-noisy tag prefixes like "V 57 Monkey", "GODt: Player", "P57R|Name".
  for (const tagToken of TAG_LOOKUP.keys()) {
    const looseTag = [...tagToken]
      .map((char) => {
        if (char === 'O') return '[O0]';
        if (char === 'I') return '[I1]';
        if (char === 'S') return '[S5]';
        return char;
      })
      .join('[^A-Za-z0-9]*');

    const loosePrefix = normalizedLeading.match(
      new RegExp(`^${looseTag}[\\s._\\-:|/\\\\]+(.+)$`, 'i')
    );
    if (loosePrefix?.[1]) {
      return sanitizeGovernorNameForAlliance(loosePrefix[1]);
    }
  }

  return normalizedLeading;
}

export function splitGovernorNameAndAlliance(args: {
  governorNameRaw?: string | null;
  allianceRaw?: string | null;
  subtitleRaw?: string | null;
}): SplitGovernorAllianceResult {
  const originalName = sanitizeGovernorNameForAlliance(args.governorNameRaw || '');
  const sanitizedAlliance = sanitizeAllianceDisplay(args.allianceRaw || args.subtitleRaw || '');
  const detection = detectTrackedAlliance({
    governorNameRaw: originalName,
    allianceRaw: sanitizedAlliance,
  });

  const governorNameRaw = stripKnownAlliancePrefix(originalName);
  if (detection) {
    return {
      governorNameRaw,
      allianceRaw: detection.canonicalLabel,
      allianceTag: detection.tag,
      trackedAlliance: true,
      detectionSource: detection.source,
      confidence: detection.confidence,
    };
  }

  return {
    governorNameRaw,
    allianceRaw: sanitizedAlliance || null,
    allianceTag: null,
    trackedAlliance: false,
    detectionSource: null,
    confidence: 0,
  };
}

export function resolveAllianceQueryFilters(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of values) {
    const clean = sanitizeAllianceDisplay(raw);
    if (!clean) continue;

    const detected = detectTrackedAlliance({
      governorNameRaw: clean,
      allianceRaw: clean,
    });
    const value = detected ? detected.canonicalLabel : clean;
    const key = normalizeAllianceToken(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

export function getTrackedAllianceByTag(tag: string): TrackedAlliance | null {
  return TAG_LOOKUP.get(normalizeAllianceToken(tag)) || null;
}
