export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export type ExtractionStatus = 'RAW' | 'REVIEWED' | 'APPROVED' | 'REJECTED';

export interface QueueField {
  value: string;
  confidence: number;
  previousValue?: string | null;
  changed?: boolean;
  croppedImage?: string;
  candidates?: Array<{
    id: string;
    source?: string;
    normalizedValue?: string;
    confidence?: number;
    score?: number;
  }>;
}

export interface QueueItem {
  id: string;
  scanJobId: string;
  eventId: string | null;
  scanSource?: string;
  scanStatus?: string;
  provider: string;
  status: ExtractionStatus;
  confidence: number;
  severity: { level: Severity; reasons: string[] };
  lowConfidence?: boolean;
  profileId?: string | null;
  profile?: {
    id: string;
    profileKey: string;
    name: string;
    version: number;
  } | null;
  engineVersion?: string | null;
  failureReasons?: string[];
  preprocessingTrace?: Record<string, unknown>;
  candidates?: Record<string, unknown>;
  fusionDecision?: Record<string, unknown>;
  values: {
    governorId: QueueField;
    governorName: QueueField;
    power: QueueField;
    killPoints: QueueField;
    t4Kills: QueueField;
    t5Kills: QueueField;
    deads: QueueField;
  };
  validation: Array<{
    field: string;
    severity: 'ok' | 'warning' | 'error';
    warning?: string;
  }>;
  artifact?: {
    id: string;
    url: string;
    type: string;
  } | null;
  syncState?: 'SYNCED' | 'PENDING_WEEK_LINK' | null;
  linkedEventId?: string | null;
  syncMessage?: string | null;
  createdAt: string;
}

export interface RankingQueueSummary {
  total: number;
  statuses: string[];
  byType: Array<{
    rankingType: string;
    metricKey: string;
    count: number;
  }>;
}

export interface ReviewUpdateResult {
  warning?: string | null;
  eventLinked?: boolean;
  syncState?: 'SYNCED' | 'PENDING_WEEK_LINK' | null;
  linkedEventId?: string | null;
  syncMessage?: string | null;
}

export interface ReviewDraft {
  governorId: string;
  governorName: string;
  power: string;
  killPoints: string;
  t4Kills: string;
  t5Kills: string;
  deads: string;
}

export const defaultReviewDraft: ReviewDraft = {
  governorId: '',
  governorName: '',
  power: '',
  killPoints: '',
  t4Kills: '',
  t5Kills: '',
  deads: '',
};

export const REVIEW_FIELD_ORDER: Array<keyof ReviewDraft> = [
  'governorId',
  'governorName',
  'power',
  'killPoints',
  't4Kills',
  't5Kills',
  'deads',
];

export const REVIEW_FIELD_LABELS: Record<keyof ReviewDraft, string> = {
  governorId: 'Governor ID',
  governorName: 'Governor Name',
  power: 'Power',
  killPoints: 'Kill Points',
  t4Kills: 'T4 Kills',
  t5Kills: 'T5 Kills',
  deads: 'Deads',
};

export const REVIEW_STATUS_PRESETS = [
  { label: 'Pending', value: 'RAW,REVIEWED' },
  { label: 'Raw', value: 'RAW' },
  { label: 'Reviewed', value: 'REVIEWED' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
];

export function reviewStatusTone(level: Severity): 'warn' | 'bad' | 'neutral' {
  if (level === 'HIGH') return 'bad';
  if (level === 'MEDIUM') return 'warn';
  return 'neutral';
}

export function formatFieldConfidence(value?: number) {
  if (typeof value !== 'number') return '0%';
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

export function buildCorrectedPayload(draft: ReviewDraft): Partial<ReviewDraft> | undefined {
  const corrected: Partial<ReviewDraft> = {};

  for (const field of REVIEW_FIELD_ORDER) {
    const raw = String(draft[field] ?? '');
    const trimmed = raw.trim();
    if (!trimmed) continue;
    corrected[field] = trimmed;
  }

  return Object.keys(corrected).length > 0 ? corrected : undefined;
}
