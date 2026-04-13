export interface RankingSortableRow {
  rowId: string;
  metricValue: bigint | string | number;
  sourceRank: number | null;
  governorNameNormalized: string;
}

function toBigInt(value: bigint | string | number): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.floor(value));
  const digits = String(value || '').replace(/[^0-9-]/g, '');
  if (!digits || digits === '-') return BigInt(0);
  return BigInt(digits);
}

export function compareRankingRows(
  a: RankingSortableRow,
  b: RankingSortableRow
): number {
  const metricA = toBigInt(a.metricValue);
  const metricB = toBigInt(b.metricValue);
  if (metricA !== metricB) return metricA > metricB ? -1 : 1;

  const rankA = a.sourceRank == null ? Number.MAX_SAFE_INTEGER : a.sourceRank;
  const rankB = b.sourceRank == null ? Number.MAX_SAFE_INTEGER : b.sourceRank;
  if (rankA !== rankB) return rankA - rankB;

  const nameCmp = a.governorNameNormalized.localeCompare(b.governorNameNormalized);
  if (nameCmp !== 0) return nameCmp;

  return a.rowId.localeCompare(b.rowId);
}

export interface RankedRow<T> {
  item: T;
  stableIndex: number;
  displayRank: number;
  tieGroup: number;
}

export function applyStableRanking<T extends RankingSortableRow>(
  rows: T[]
): RankedRow<T>[] {
  const sorted = [...rows].sort(compareRankingRows);
  const out: RankedRow<T>[] = [];

  let currentRank = 1;
  let tieGroup = 1;
  let previousMetric: bigint | null = null;
  let previousRank: number | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const metric = toBigInt(item.metricValue);

    if (previousMetric !== null && metric !== previousMetric) {
      currentRank = i + 1;
      tieGroup += 1;
    } else if (
      previousMetric !== null &&
      metric === previousMetric &&
      previousRank !== null &&
      item.sourceRank !== previousRank
    ) {
      // Preserve same display rank while still exposing distinct tie groups when source rank differs.
      tieGroup += 1;
    }

    out.push({
      item,
      stableIndex: i + 1,
      displayRank: currentRank,
      tieGroup,
    });

    previousMetric = metric;
    previousRank = item.sourceRank;
  }

  return out;
}

export interface RankingCursor {
  rowId: string;
}

export function encodeRankingCursor(cursor: RankingCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeRankingCursor(value: string | null): RankingCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      rowId?: unknown;
    };
    if (typeof parsed.rowId !== 'string' || !parsed.rowId) return null;
    return { rowId: parsed.rowId };
  } catch {
    return null;
  }
}
