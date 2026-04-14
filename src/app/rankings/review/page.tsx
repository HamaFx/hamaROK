'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ImageIcon,
  Link2,
  PencilLine,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  UserPlus,
  XCircle,
} from 'lucide-react';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
import { useWorkspaceSession } from '@/lib/workspace-session';
import {
  getMetricDisplayName,
  getRankingTypeDisplayName,
  getSupportedBoardForPair,
  SUPPORTED_RANKING_BOARDS,
} from '@/lib/rankings/board-types';
import {
  EmptyState,
  FilterBar,
  KpiCard,
  PageHero,
  Panel,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';

type IdentityStatus = 'UNRESOLVED' | 'AUTO_LINKED' | 'MANUAL_LINKED' | 'REJECTED';
type ReviewAction = 'LINK_TO_GOVERNOR' | 'CREATE_ALIAS' | 'CORRECT_ROW' | 'REJECT_ROW';

interface ReviewRow {
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
    createdAt: string;
    artifact?: {
      id: string;
      url: string;
      type: string;
    } | null;
  };
}

interface RankingReviewSummary {
  total: number;
  statuses: string[];
  byType: Array<{
    rankingType: string;
    metricKey: string;
    count: number;
  }>;
}

interface DraftState {
  governorGameId: string;
  aliasRaw: string;
  sourceRank: string;
  governorNameRaw: string;
  metricRaw: string;
}

interface RerunHint {
  profileId: string | null;
  templateId: string | null;
  detectedRankingType: string;
  detectedMetricKey: string;
  matchedRowIndex: number | null;
  matchedSourceRank: number | null;
  matchedConfidence: number | null;
  lowConfidence: boolean;
  failureReasons: string[];
}

const defaultDraft: DraftState = {
  governorGameId: '',
  aliasRaw: '',
  sourceRank: '',
  governorNameRaw: '',
  metricRaw: '',
};

const STATUS_OPTIONS: IdentityStatus[] = ['UNRESOLVED', 'AUTO_LINKED', 'MANUAL_LINKED', 'REJECTED'];

const RANKING_TYPE_FILTERS = [
  { value: '', label: 'All Ranking Types' },
  ...SUPPORTED_RANKING_BOARDS.map((entry) => ({
    value: entry.rankingType,
    label: entry.label,
  })),
];

const METRIC_FILTERS = [
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

function identityTone(status: IdentityStatus): 'warn' | 'bad' | 'good' {
  if (status === 'UNRESOLVED') return 'warn';
  if (status === 'REJECTED') return 'bad';
  return 'good';
}

function normalizeName(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function parseCandidatePreview(candidates?: Record<string, unknown>) {
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

function pickBestRerunRowMatch(
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

export default function RankingReviewPage() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
  } = useWorkspaceSession();

  const [statusFilter, setStatusFilter] = useState('UNRESOLVED');
  const [rankingTypeFilter, setRankingTypeFilter] = useState('');
  const [metricFilter, setMetricFilter] = useState('');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [summaryData, setSummaryData] = useState<RankingReviewSummary | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [profiles, setProfiles] = useState<OcrRuntimeProfile[]>([]);
  const [rerunProfileByRow, setRerunProfileByRow] = useState<Record<string, string>>({});
  const [rerunHints, setRerunHints] = useState<Record<string, RerunHint>>({});
  const [loading, setLoading] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rankingProfiles = useMemo(() => {
    const rankboardOnly = profiles.filter((profile) => profile.archetype === 'rankboard');
    return rankboardOnly.length > 0 ? rankboardOnly : profiles;
  }, [profiles]);

  const loadRows = useCallback(async () => {
    if (!workspaceReady) {
      setError(sessionLoading ? 'Connecting workspace session...' : 'Workspace session is not ready.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        workspaceId,
        status: statusFilter,
        limit: '120',
      });
      if (rankingTypeFilter) params.set('rankingType', rankingTypeFilter);
      if (metricFilter) params.set('metricKey', metricFilter);

      const summaryParams = new URLSearchParams({
        workspaceId,
        status: statusFilter,
      });

      const [rowsRes, summaryRes] = await Promise.all([
        fetch(`/api/v2/rankings/review?${params.toString()}`, {
          headers: { 'x-access-token': accessToken },
        }),
        fetch(`/api/v2/rankings/review/summary?${summaryParams.toString()}`, {
          headers: { 'x-access-token': accessToken },
        }),
      ]);

      const rowsPayload = await rowsRes.json();
      if (!rowsRes.ok) {
        throw new Error(rowsPayload?.error?.message || 'Failed to load ranking review queue.');
      }
      const data = Array.isArray(rowsPayload?.data) ? (rowsPayload.data as ReviewRow[]) : [];
      setRows(data);

      const nextDrafts: Record<string, DraftState> = {};
      const nextRerunProfiles: Record<string, string> = {};
      for (const row of data) {
        nextDrafts[row.id] = {
          governorGameId: '',
          aliasRaw: row.governorNameRaw,
          sourceRank: row.sourceRank?.toString() || '',
          governorNameRaw: row.governorNameRaw,
          metricRaw: row.metricRaw,
        };
        nextRerunProfiles[row.id] = '';
      }
      setDrafts(nextDrafts);
      setRerunProfileByRow(nextRerunProfiles);
      setRerunHints({});

      const summaryPayload = await summaryRes.json();
      if (summaryRes.ok && summaryPayload?.data) {
        setSummaryData(summaryPayload.data as RankingReviewSummary);
      } else {
        setSummaryData(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ranking review queue.');
    } finally {
      setLoading(false);
    }
  }, [
    workspaceId,
    accessToken,
    statusFilter,
    rankingTypeFilter,
    metricFilter,
    workspaceReady,
    sessionLoading,
  ]);

  useEffect(() => {
    if (workspaceReady) {
      void loadRows();
    }
  }, [workspaceReady, loadRows]);

  useEffect(() => {
    if (!workspaceReady) {
      setProfiles([]);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const params = new URLSearchParams({ workspaceId });
        const res = await fetch(`/api/v2/ocr/profiles?${params.toString()}`, {
          headers: { 'x-access-token': accessToken },
        });
        const payload = await res.json();
        if (!res.ok) return;
        if (!cancelled) {
          setProfiles(Array.isArray(payload?.data) ? payload.data : []);
        }
      } catch {
        if (!cancelled) setProfiles([]);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, accessToken, workspaceReady]);

  const summary = useMemo(() => {
    const unresolved = rows.filter((row) => row.identityStatus === 'UNRESOLVED').length;
    const linked = rows.filter(
      (row) => row.identityStatus === 'MANUAL_LINKED' || row.identityStatus === 'AUTO_LINKED'
    ).length;
    const rejected = rows.filter((row) => row.identityStatus === 'REJECTED').length;
    return { unresolved, linked, rejected };
  }, [rows]);

  const summaryByType = useMemo(() => {
    const base = new Map<string, number>();
    for (const entry of summaryData?.byType || []) {
      base.set(`${entry.rankingType}::${entry.metricKey}`, entry.count);
    }
    return base;
  }, [summaryData]);

  const updateDraft = (rowId: string, key: keyof DraftState, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] || defaultDraft),
        [key]: value,
      },
    }));
  };

  const rerunOcr = async (row: ReviewRow) => {
    if (!workspaceReady || !accessToken) return;
    if (!row.run.artifact?.url) {
      setError('Cannot rerun OCR because screenshot artifact is missing for this ranking row.');
      return;
    }

    setBusyRow(`${row.id}:RERUN_OCR`);
    setError(null);

    try {
      const imageRes = await fetch(row.run.artifact.url);
      if (!imageRes.ok) {
        throw new Error('Failed to download ranking screenshot artifact for rerun.');
      }

      const blob = await imageRes.blob();
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const file = new File([blob], `ranking-rerun-${row.id}.${ext}`, {
        type: blob.type || 'image/png',
      });

      const preferredProfileId = rerunProfileByRow[row.id] || undefined;
      const { processRankingScreenshot } = await import('@/lib/ocr/ocr-engine');
      const result = await processRankingScreenshot(file, {
        profiles: rankingProfiles.length > 0 ? rankingProfiles : undefined,
        preferredProfileId,
      });

      const matched = pickBestRerunRowMatch(row, result.rows);
      if (!matched) {
        throw new Error('Re-run OCR completed but no usable ranking rows were detected.');
      }

      setDrafts((prev) => ({
        ...prev,
        [row.id]: {
          ...(prev[row.id] || defaultDraft),
          sourceRank: matched.sourceRank != null ? String(matched.sourceRank) : '',
          governorNameRaw: matched.governorNameRaw || row.governorNameRaw,
          metricRaw: matched.metricRaw || row.metricRaw,
        },
      }));

      const diagnosticsRes = await fetch('/api/v2/ocr/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify({
          workspaceId,
          preferredProfileId: preferredProfileId || null,
          extraction: result,
        }),
      });

      const diagnosticsPayload = await diagnosticsRes.json();
      const diagnostics = diagnosticsPayload?.data || {};

      setRerunHints((prev) => ({
        ...prev,
        [row.id]: {
          profileId: diagnostics.profileId || result.profileId || null,
          templateId: diagnostics.templateId || result.templateId || null,
          detectedRankingType: diagnostics.rankingType || result.rankingType,
          detectedMetricKey: diagnostics.metricKey || result.metricKey,
          matchedRowIndex: matched.rowIndex,
          matchedSourceRank: matched.sourceRank,
          matchedConfidence: matched.confidence,
          lowConfidence: Boolean(
            diagnostics.lowConfidence ?? result.lowConfidence ?? matched.confidence < 70
          ),
          failureReasons: Array.isArray(diagnostics.failureReasons)
            ? diagnostics.failureReasons.slice(0, 6)
            : [],
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rerun ranking OCR.');
    } finally {
      setBusyRow(null);
    }
  };

  const runAction = async (row: ReviewRow, action: ReviewAction) => {
    if (!workspaceId || !accessToken) return;

    const draft = drafts[row.id] || defaultDraft;
    setBusyRow(`${row.id}:${action}`);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        workspaceId,
        action,
      };

      if (action === 'LINK_TO_GOVERNOR' || action === 'CREATE_ALIAS') {
        if (!draft.governorGameId.trim()) {
          throw new Error('Governor game ID is required for this action.');
        }
        body.governorGameId = draft.governorGameId.trim();
      }

      if (action === 'CREATE_ALIAS') {
        body.aliasRaw = draft.aliasRaw.trim() || row.governorNameRaw;
      }

      if (action === 'CORRECT_ROW') {
        body.corrected = {
          sourceRank: draft.sourceRank.trim() ? Number(draft.sourceRank) : null,
          governorNameRaw: draft.governorNameRaw.trim(),
          metricRaw: draft.metricRaw.trim(),
          metricValue: draft.metricRaw,
        };
        if (draft.governorGameId.trim()) {
          body.governorGameId = draft.governorGameId.trim();
        }
      }

      const res = await fetch(`/api/v2/rankings/review/${row.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify(body),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to apply review action.');
      }

      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply review action.');
    } finally {
      setBusyRow(null);
    }
  };

  return (
    <div className="page-container">
      <PageHero
        title="Ranking Review Queue"
        subtitle="Resolve identity matches and corrections for ranking screenshots."
      />

      {!workspaceReady ? (
        <div className="card mb-24">
          <div className="text-sm text-muted">
            {sessionLoading ? 'Connecting workspace...' : sessionError || 'Workspace session is not ready yet.'}
          </div>
        </div>
      ) : null}

      <FilterBar className="mb-24">
        <div className="form-group" style={{ marginBottom: 0, minWidth: 230 }}>
          <label className="form-label">Status Filter</label>
          <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="UNRESOLVED">Unresolved</option>
            <option value="AUTO_LINKED,MANUAL_LINKED">Linked (Auto + Manual)</option>
            <option value="REJECTED">Rejected</option>
            <option value={STATUS_OPTIONS.join(',')}>All</option>
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 220 }}>
          <label className="form-label">Ranking Type</label>
          <select
            className="form-select"
            value={rankingTypeFilter}
            onChange={(e) => setRankingTypeFilter(e.target.value)}
          >
            {RANKING_TYPE_FILTERS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 220 }}>
          <label className="form-label">Metric Key</label>
          <select className="form-select" value={metricFilter} onChange={(e) => setMetricFilter(e.target.value)}>
            {METRIC_FILTERS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={loadRows} disabled={loading}>
          {loading ? 'Loading...' : 'Apply'}
        </button>
      </FilterBar>

      {error ? <div className="delta-negative mb-16">{error}</div> : null}

      <div className="grid-4 mb-24">
        <KpiCard label="Rows in View" value={rows.length} hint="Filtered review rows" tone="info" />
        <KpiCard label="Unresolved" value={summary.unresolved} hint="Needs manual identity action" tone="warn" />
        <KpiCard label="Linked" value={summary.linked} hint="Auto/manual links ready" tone="good" />
        <KpiCard label="Rejected" value={summary.rejected} hint="Discarded ranking rows" tone="bad" />
      </div>

      <Panel title="Screenshot Type Coverage" subtitle="Counts by supported ranking screenshot type.">
        <div className="review-candidate-row" style={{ paddingTop: 4 }}>
          {SUPPORTED_RANKING_BOARDS.map((board) => {
            const count = summaryByType.get(`${board.rankingType}::${board.metricKey}`) || 0;
            return (
              <StatusPill
                key={`${board.rankingType}:${board.metricKey}`}
                label={`${board.label}: ${count}`}
                tone={count > 0 ? 'warn' : 'good'}
              />
            );
          })}
        </div>
        {summaryData?.total != null ? (
          <p className="text-sm text-muted mt-8">
            Total rows in selected status set: {summaryData.total.toLocaleString()}.
          </p>
        ) : null}
      </Panel>

      <Panel title="Triage Board">
        {loading ? (
          <SkeletonSet rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState title="Queue is clear" description="No ranking rows in the selected filters." />
        ) : (
          <div className="ocr-review-stack">
            {rows.map((row) => {
              const draft = drafts[row.id] || defaultDraft;
              const candidatePreview = parseCandidatePreview(row.candidates);
              const boardLabel = getRankingTypeDisplayName(row.run.rankingType);
              const metricLabel = getMetricDisplayName(row.run.metricKey);
              const supportedBoard = getSupportedBoardForPair(row.run.rankingType, row.run.metricKey);
              const rerunHint = rerunHints[row.id] || null;
              const rerunMismatch =
                rerunHint &&
                (rerunHint.detectedRankingType !== row.run.rankingType ||
                  rerunHint.detectedMetricKey !== row.run.metricKey);

              return (
                <article key={row.id} className="ocr-review">
                  <header className="ocr-review-header">
                    <div>
                      <div className="flex items-center gap-8" style={{ flexWrap: 'wrap' }}>
                        <strong>{row.governorNameRaw || 'Unknown'}</strong>
                        <StatusPill label={row.identityStatus} tone={identityTone(row.identityStatus)} />
                        <StatusPill label={boardLabel} tone={supportedBoard ? 'info' : 'bad'} />
                        <span className="text-sm text-muted">{Math.round(row.confidence)}% confidence</span>
                      </div>
                      <div className="text-sm text-muted mt-4">
                        {boardLabel} • {metricLabel} • source rank {row.sourceRank ?? '—'} • metric {row.metricValue}
                      </div>
                      {row.run.headerText ? (
                        <div className="text-sm text-muted mt-4">Header: {row.run.headerText}</div>
                      ) : null}
                      {(row.allianceRaw || row.titleRaw) ? (
                        <div className="text-sm text-muted mt-4">
                          {row.allianceRaw ? `Alliance ${row.allianceRaw}` : `Title ${row.titleRaw}`}
                        </div>
                      ) : null}
                      {candidatePreview.length > 0 ? (
                        <div className="text-sm text-muted mt-4">Candidates: {candidatePreview.join(' • ')}</div>
                      ) : null}
                      {!supportedBoard ? (
                        <div className="text-sm delta-negative mt-4">
                          Unsupported ranking type/metric pair. Validate OCR header classification before approval.
                        </div>
                      ) : null}
                    </div>
                  </header>

                  <div style={{ padding: '12px 14px' }}>
                    {row.run.artifact?.url ? (
                      <div className="mb-12">
                        <a href={row.run.artifact.url} target="_blank" rel="noreferrer" className="text-sm">
                          <ImageIcon size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                          Open screenshot
                        </a>
                        <div className="mt-8">
                          <img
                            src={row.run.artifact.url}
                            alt={`Ranking screenshot for ${row.governorNameRaw}`}
                            loading="lazy"
                            style={{
                              width: '100%',
                              maxWidth: 460,
                              borderRadius: 10,
                              border: '1px solid var(--line-soft)',
                              display: 'block',
                            }}
                          />
                        </div>
                      </div>
                    ) : null}

                    <div className="grid-2">
                      <div className="form-group" style={{ marginBottom: 8 }}>
                        <label className="form-label">Governor Game ID</label>
                        <input
                          className="form-input"
                          value={draft.governorGameId}
                          onChange={(e) => updateDraft(row.id, 'governorGameId', e.target.value)}
                          placeholder="e.g. 222067061"
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 8 }}>
                        <label className="form-label">Alias for Create Alias</label>
                        <input
                          className="form-input"
                          value={draft.aliasRaw}
                          onChange={(e) => updateDraft(row.id, 'aliasRaw', e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="grid-3">
                      <div className="form-group" style={{ marginBottom: 8 }}>
                        <label className="form-label">Corrected Rank</label>
                        <input
                          className="form-input"
                          value={draft.sourceRank}
                          onChange={(e) => updateDraft(row.id, 'sourceRank', e.target.value)}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 8 }}>
                        <label className="form-label">Corrected Name</label>
                        <input
                          className="form-input"
                          value={draft.governorNameRaw}
                          onChange={(e) => updateDraft(row.id, 'governorNameRaw', e.target.value)}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 8 }}>
                        <label className="form-label">Corrected Metric</label>
                        <input
                          className="form-input"
                          value={draft.metricRaw}
                          onChange={(e) => updateDraft(row.id, 'metricRaw', e.target.value)}
                        />
                      </div>
                    </div>

                    <FilterBar>
                      <select
                        className="form-select"
                        value={rerunProfileByRow[row.id] || ''}
                        onChange={(e) =>
                          setRerunProfileByRow((prev) => ({
                            ...prev,
                            [row.id]: e.target.value,
                          }))
                        }
                        style={{ minWidth: 220 }}
                      >
                        <option value="">Auto-select rankboard profile</option>
                        {rankingProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name} ({profile.profileKey} v{profile.version})
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => rerunOcr(row)}
                        disabled={busyRow != null || !row.run.artifact?.url}
                      >
                        <RefreshCw size={14} />
                        {busyRow === `${row.id}:RERUN_OCR` ? 'Re-running...' : 'Re-run OCR'}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => runAction(row, 'LINK_TO_GOVERNOR')}
                        disabled={busyRow != null}
                      >
                        <Link2 size={14} />{' '}
                        {busyRow === `${row.id}:LINK_TO_GOVERNOR` ? 'Linking...' : 'Link Governor'}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => runAction(row, 'CREATE_ALIAS')}
                        disabled={busyRow != null}
                      >
                        <UserPlus size={14} />{' '}
                        {busyRow === `${row.id}:CREATE_ALIAS` ? 'Saving...' : 'Create Alias'}
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => runAction(row, 'CORRECT_ROW')}
                        disabled={busyRow != null}
                      >
                        <PencilLine size={14} />{' '}
                        {busyRow === `${row.id}:CORRECT_ROW` ? 'Applying...' : 'Correct Row'}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => runAction(row, 'REJECT_ROW')}
                        disabled={busyRow != null}
                      >
                        <XCircle size={14} />{' '}
                        {busyRow === `${row.id}:REJECT_ROW` ? 'Rejecting...' : 'Reject'}
                      </button>
                    </FilterBar>

                    {rerunHint ? (
                      <div className="mt-12" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
                        <div className="flex items-center gap-8" style={{ flexWrap: 'wrap' }}>
                          <StatusPill
                            label={`Detected: ${getRankingTypeDisplayName(rerunHint.detectedRankingType)} / ${getMetricDisplayName(rerunHint.detectedMetricKey)}`}
                            tone={rerunMismatch ? 'bad' : 'good'}
                          />
                          {rerunHint.matchedSourceRank != null ? (
                            <StatusPill label={`Matched Rank ${rerunHint.matchedSourceRank}`} tone="info" />
                          ) : null}
                          {rerunHint.matchedConfidence != null ? (
                            <StatusPill
                              label={`Row Confidence ${Math.round(rerunHint.matchedConfidence)}%`}
                              tone={rerunHint.matchedConfidence < 70 ? 'warn' : 'good'}
                            />
                          ) : null}
                        </div>
                        {rerunMismatch ? (
                          <div className="text-sm delta-negative mt-8">
                            Re-run OCR detected a different board type/metric than this row. Confirm screenshot header before approving.
                          </div>
                        ) : null}
                        {rerunHint.lowConfidence ? (
                          <div className="text-sm text-gold mt-8">
                            <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                            Re-run OCR marked this result as low confidence.
                          </div>
                        ) : null}
                        {rerunHint.failureReasons.length > 0 ? (
                          <div className="text-sm text-muted mt-8">
                            <Sparkles size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                            {rerunHint.failureReasons.join(' • ')}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {row.identityStatus === 'UNRESOLVED' ? (
                      <div className="text-sm mt-8 text-muted">
                        <ShieldAlert size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                        Ambiguous identity requires manual confirmation before canonical merge.
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
