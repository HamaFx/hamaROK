export interface SupportedRankingBoard {
  rankingType: string;
  metricKey: string;
  label: string;
  shortLabel: string;
  description: string;
}

export const SUPPORTED_RANKING_BOARDS: SupportedRankingBoard[] = [
  {
    rankingType: 'individual_power',
    metricKey: 'power',
    label: 'Power Rankings',
    shortLabel: 'Power',
    description: 'Individual Power board screenshots.',
  },
  {
    rankingType: 'mad_scientist',
    metricKey: 'contribution_points',
    label: 'Mad Scientist',
    shortLabel: 'Tech',
    description: 'Tech contribution board screenshots.',
  },
  {
    rankingType: 'fort_destroyer',
    metricKey: 'fort_destroying',
    label: 'Fort Destroyer',
    shortLabel: 'Fort',
    description: 'Fort destroying board screenshots.',
  },
  {
    rankingType: 'kill_point',
    metricKey: 'kill_points',
    label: 'Kill Points',
    shortLabel: 'KP',
    description: 'Kill points board screenshots.',
  },
];

const RANKING_TYPE_LABELS: Record<string, string> = SUPPORTED_RANKING_BOARDS.reduce(
  (acc, entry) => {
    acc[entry.rankingType] = entry.label;
    return acc;
  },
  {} as Record<string, string>
);

const METRIC_LABELS: Record<string, string> = {
  power: 'Power',
  contribution_points: 'Contribution Points',
  fort_destroying: 'Fort Destroying',
  kill_points: 'Kill Points',
};

function toTitleCase(input: string): string {
  const normalized = String(input || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return 'Unknown';
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getRankingTypeDisplayName(rankingType: string): string {
  return RANKING_TYPE_LABELS[rankingType] || toTitleCase(rankingType);
}

export function getMetricDisplayName(metricKey: string): string {
  return METRIC_LABELS[metricKey] || toTitleCase(metricKey);
}

export function getSupportedBoardForPair(
  rankingType: string,
  metricKey: string
): SupportedRankingBoard | null {
  return (
    SUPPORTED_RANKING_BOARDS.find(
      (entry) => entry.rankingType === rankingType && entry.metricKey === metricKey
    ) || null
  );
}

