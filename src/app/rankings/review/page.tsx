'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, PencilLine, RefreshCw, ShieldAlert, UserPlus, XCircle } from 'lucide-react';
import { EmptyState, FilterBar, KpiCard, PageHero, Panel, SkeletonSet, StatusPill } from '@/components/ui/primitives';

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
  };
}

interface DraftState {
  governorGameId: string;
  aliasRaw: string;
  sourceRank: string;
  governorNameRaw: string;
  metricRaw: string;
}

const defaultDraft: DraftState = {
  governorGameId: '',
  aliasRaw: '',
  sourceRank: '',
  governorNameRaw: '',
  metricRaw: '',
};

const STATUS_OPTIONS: IdentityStatus[] = ['UNRESOLVED', 'AUTO_LINKED', 'MANUAL_LINKED', 'REJECTED'];

function identityTone(status: IdentityStatus): 'warn' | 'bad' | 'good' {
  if (status === 'UNRESOLVED') return 'warn';
  if (status === 'REJECTED') return 'bad';
  return 'good';
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
      const scoreRaw = (entry as { score?: number; confidence?: number }).score ?? (entry as { confidence?: number }).confidence;
      const score = typeof scoreRaw === 'number' ? Math.round(scoreRaw) : null;
      if (!name) return null;
      return score != null ? `${name} (${score}%)` : name;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 3);
}

export default function RankingReviewPage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [statusFilter, setStatusFilter] = useState('UNRESOLVED');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [loading, setLoading] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWorkspaceId(localStorage.getItem('workspaceId') || '');
    setAccessToken(localStorage.getItem('workspaceToken') || '');
  }, []);

  useEffect(() => {
    if (workspaceId) localStorage.setItem('workspaceId', workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    if (accessToken) localStorage.setItem('workspaceToken', accessToken);
  }, [accessToken]);

  const loadRows = useCallback(async () => {
    if (!workspaceId || !accessToken) {
      setError('Workspace ID and access token are required.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        workspaceId,
        status: statusFilter,
        limit: '80',
      });

      const res = await fetch(`/api/v2/rankings/review?${params.toString()}`, {
        headers: { 'x-access-token': accessToken },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to load ranking review queue.');
      }

      const data = Array.isArray(payload?.data) ? (payload.data as ReviewRow[]) : [];
      setRows(data);

      const nextDrafts: Record<string, DraftState> = {};
      for (const row of data) {
        nextDrafts[row.id] = {
          governorGameId: '',
          aliasRaw: row.governorNameRaw,
          sourceRank: row.sourceRank?.toString() || '',
          governorNameRaw: row.governorNameRaw,
          metricRaw: row.metricRaw,
        };
      }
      setDrafts(nextDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ranking review queue.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, accessToken, statusFilter]);

  useEffect(() => {
    if (workspaceId && accessToken) loadRows();
  }, [workspaceId, accessToken, loadRows]);

  const summary = useMemo(() => {
    const unresolved = rows.filter((row) => row.identityStatus === 'UNRESOLVED').length;
    const linked = rows.filter(
      (row) => row.identityStatus === 'MANUAL_LINKED' || row.identityStatus === 'AUTO_LINKED'
    ).length;
    const rejected = rows.filter((row) => row.identityStatus === 'REJECTED').length;
    return { unresolved, linked, rejected };
  }, [rows]);

  const updateDraft = (rowId: string, key: keyof DraftState, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] || defaultDraft),
        [key]: value,
      },
    }));
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
        subtitle="Resolve identity ambiguity and row corrections before canonical ranking merge."
        badges={['Identity-safe linking', 'Canonical merge guard', 'Manual resolution flow']}
        actions={
          <button className="btn btn-secondary" onClick={loadRows} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />

      <Panel title="Queue Scope" subtitle="Workspace-secured unresolved ranking rows" className="mb-24">
        <div className="grid-2">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Workspace ID</label>
            <input className="form-input" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Access Token</label>
            <input className="form-input" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
          </div>
        </div>

        <FilterBar className="mt-12">
          <div className="form-group" style={{ marginBottom: 0, width: 260 }}>
            <label className="form-label">Status Filter</label>
            <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="UNRESOLVED">Unresolved</option>
              <option value="AUTO_LINKED,MANUAL_LINKED">Linked (Auto + Manual)</option>
              <option value="REJECTED">Rejected</option>
              <option value={STATUS_OPTIONS.join(',')}>All</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={loadRows} disabled={loading}>
            {loading ? 'Loading...' : 'Apply'}
          </button>
        </FilterBar>

        {error ? <div className="delta-negative mt-12">{error}</div> : null}
      </Panel>

      <div className="grid-3 mb-24">
        <KpiCard label="Unresolved" value={summary.unresolved} hint="Needs manual identity action" tone="warn" />
        <KpiCard label="Linked" value={summary.linked} hint="Auto/manual links ready" tone="good" />
        <KpiCard label="Rejected" value={summary.rejected} hint="Discarded ranking rows" tone="bad" />
      </div>

      <Panel title="Triage Board" subtitle="Resolve rows with deterministic correction actions">
        {loading ? (
          <SkeletonSet rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState title="Queue is clear" description="No ranking rows in the selected status filter." />
        ) : (
          <div className="ocr-review-stack">
            {rows.map((row) => {
              const draft = drafts[row.id] || defaultDraft;
              const candidatePreview = parseCandidatePreview(row.candidates);

              return (
                <article key={row.id} className="ocr-review">
                  <header className="ocr-review-header">
                    <div>
                      <div className="flex items-center gap-8" style={{ flexWrap: 'wrap' }}>
                        <strong>{row.governorNameRaw || 'Unknown'}</strong>
                        <StatusPill label={row.identityStatus} tone={identityTone(row.identityStatus)} />
                        <span className="text-sm text-muted">{Math.round(row.confidence)}% confidence</span>
                      </div>
                      <div className="text-sm text-muted mt-4">
                        {row.run.rankingType} / {row.run.metricKey} • source rank {row.sourceRank ?? '—'} • metric {row.metricValue}
                      </div>
                      {(row.allianceRaw || row.titleRaw) ? (
                        <div className="text-sm text-muted mt-4">
                          {row.allianceRaw ? `Alliance ${row.allianceRaw}` : `Title ${row.titleRaw}`}
                        </div>
                      ) : null}
                      {candidatePreview.length > 0 ? (
                        <div className="text-sm text-muted mt-4">
                          Candidates: {candidatePreview.join(' • ')}
                        </div>
                      ) : null}
                    </div>
                  </header>

                  <div style={{ padding: '12px 14px' }}>
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
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => runAction(row, 'LINK_TO_GOVERNOR')}
                        disabled={busyRow != null}
                      >
                        <Link2 size={14} /> {busyRow === `${row.id}:LINK_TO_GOVERNOR` ? 'Linking...' : 'Link Governor'}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => runAction(row, 'CREATE_ALIAS')}
                        disabled={busyRow != null}
                      >
                        <UserPlus size={14} /> {busyRow === `${row.id}:CREATE_ALIAS` ? 'Saving...' : 'Create Alias'}
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => runAction(row, 'CORRECT_ROW')}
                        disabled={busyRow != null}
                      >
                        <PencilLine size={14} /> {busyRow === `${row.id}:CORRECT_ROW` ? 'Applying...' : 'Correct Row'}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => runAction(row, 'REJECT_ROW')}
                        disabled={busyRow != null}
                      >
                        <XCircle size={14} /> {busyRow === `${row.id}:REJECT_ROW` ? 'Rejecting...' : 'Reject'}
                      </button>
                    </FilterBar>

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
