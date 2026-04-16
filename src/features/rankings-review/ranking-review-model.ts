import {
  getMetricDisplayName,
  SUPPORTED_RANKING_BOARDS,
} from '@/lib/rankings/board-types';

export type IdentityStatus = 'UNRESOLVED' | 'AUTO_LINKED' | 'MANUAL_LINKED' | 'REJECTED';
export type ReviewAction = 'LINK_TO_GOVERNOR' | 'CREATE_ALIAS' | 'CORRECT_ROW' | 'REJECT_ROW';

export interface ReviewRow {
  id: string;
  runId: string;
  sourceRank: number | null;
  governorNameRaw: string;
  allianceRaw?: string | null;
  titleRaw?: string | null;
  metricRaw: string;
  metricValue: string;
  confidence: number;
  identityStatus: IdentityStatus;
  candidates?: Record<string, unknown>;
  createdAt: string;
  run: {
    id: string;
    eventId: string | null;
    rankingType: string;
    metricKey: string;
    status: string;
    headerText: string | null;
    diagnostics?: {
      classificationConfidence: number | null;
      droppedRowCount: number | null;
      guardFailures: string[];
      detectedBoardTokens: string[];
      uniformity?: Record<string, unknown> | null;
      worker?: string | null;
      ocrDurationMs?: number | null;
    } | null;
    createdAt: string;
    artifact?: {
      id: string;
      url: string;
      type: string;
    } | null;
  };
}

export interface RankingReviewSummary {
  total: number;
  statuses: string[];
  byType: Array<{
    rankingType: string;
    metricKey: string;
    count: number;
  }>;
}

export interface RankingReviewDraft {
  governorGameId: string;
  aliasRaw: string;
  sourceRank: string;
  governorNameRaw: string;
  metricRaw: string;
}

export interface RerunHint {
  profileId: string | null;
  templateId: string | null;
  detectedRankingType: string;
  detectedMetricKey: string;
  matchedRowIndex: number | null;
  matchedSourceRank: number | null;
  matchedConfidence: number | null;
  lowConfidence: boolean;
  failureReasons: string[];
  classificationConfidence?: number | null;
  droppedRowCount?: number | null;
  guardFailures?: string[];
  detectedBoardTokens?: string[];
}

export const defaultRankingReviewDraft: RankingReviewDraft = {
  governorGameId: '',
  aliasRaw: '',
  sourceRank: '',
  governorNameRaw: '',
  metricRaw: '',
};

export const RANKING_REVIEW_STATUS_OPTIONS: IdentityStatus[] = [
  'UNRESOLVED',
  'AUTO_LINKED',
  'MANUAL_LINKED',
  'REJECTED',
];

export const RANKING_TYPE_FILTERS = [
  { value: '', label: 'All Ranking Types' },
  ...SUPPORTED_RANKING_BOARDS.map((entry) => ({
    value: entry.rankingType,
    label: entry.label,
  })),
];

export const METRIC_FILTERS = [
  { value: '', label: 'All Metrics' },
  ...Array.from(
    new Map(
      SUPPORTED_RANKING_BOARDS.map((entry) => [
        entry.metricKey,
        { value: entry.metricKey, label: getMetricDisplayName(entry.metricKey) },
      ])
    ).values()
  ),
];

export function identityTone(status: IdentityStatus): 'warn' | 'bad' | 'good' {
  if (status === 'UNRESOLVED') return 'warn';
  if (status === 'REJECTED') return 'bad';
  return 'good';
}

function normalizeName(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function parseCandidatePreview(candidates?: Record<string, unknown>) {
  if (!candidates) return [] as string[];

  const rowCandidates = (candidates.rowCandidates || candidates.candidates || candidates.matches) as unknown;
  if (!Array.isArray(rowCandidates)) return [];

  return rowCandidates
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) return null;
      const name =
        String(
          (entry as { governorNameRaw?: string; governorName?: string; normalizedValue?: string }).governorNameRaw ||
            (entry as { governorName?: string }).governorName ||
            (entry as { normalizedValue?: string }).normalizedValue ||
            ''
        ).trim() || null;
      const scoreRaw =
        (entry as { score?: number; confidence?: number }).score ??
        (entry as { confidence?: number }).confidence;
      const score = typeof scoreRaw === 'number' ? Math.round(scoreRaw) : null;
      if (!name) return null;
      return score != null ? `${name} (${score}%)` : name;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 3);
}

export function pickBestRerunRowMatch(
  row: ReviewRow,
  rerunRows: Array<{
    rowIndex: number;
    sourceRank: number | null;
    governorNameRaw: string;
    metricRaw: string;
    confidence: number;
  }>
) {
  if (!rerunRows.length) return null;

  if (row.sourceRank != null) {
    const exactRank = rerunRows.find((entry) => entry.sourceRank === row.sourceRank);
    if (exactRank) return exactRank;
  }

  const targetName = normalizeName(row.governorNameRaw);
  if (targetName) {
    const byName = rerunRows.find((entry) => normalizeName(entry.governorNameRaw) === targetName);
    if (byName) return byName;
  }

  return rerunRows[0] || null;
}
