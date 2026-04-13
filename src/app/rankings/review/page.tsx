'use client';

import { useCallback, useEffect, useState } from 'react';

type IdentityStatus = 'UNRESOLVED' | 'AUTO_LINKED' | 'MANUAL_LINKED' | 'REJECTED';
type ReviewAction = 'LINK_TO_GOVERNOR' | 'CREATE_ALIAS' | 'CORRECT_ROW' | 'REJECT_ROW';

interface ReviewRow {
  id: string;
  runId: string;
  sourceRank: number | null;
  governorNameRaw: string;
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
    if (!workspaceId || !accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        workspaceId,
        status: statusFilter,
        limit: '80',
      });
      const res = await fetch(`/api/v2/rankings/review?${params.toString()}`, {
        headers: {
          'x-access-token': accessToken,
        },
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
    if (workspaceId && accessToken) {
      loadRows();
    }
  }, [workspaceId, accessToken, loadRows]);

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
          throw new Error('Governor game ID is required for link/alias actions.');
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
      setError(err instanceof Error ? err.message : 'Failed to apply ranking action.');
    } finally {
      setBusyRow(null);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>🧩 Ranking Review Queue</h1>
        <p>Resolve ambiguous rows, create aliases, and keep canonical rankings clean.</p>
      </div>

      <div className="card card-no-hover mb-24">
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

        <div className="flex gap-12 mt-12" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Status Filter</label>
            <input className="form-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={loadRows} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="card card-no-hover">
        {error && <div className="delta-negative mb-12">{error}</div>}

        {rows.map((row) => {
          const draft = drafts[row.id] || defaultDraft;
          return (
            <div key={row.id} className="ocr-review mb-12">
              <div className="ocr-review-header">
                <div>
                  <strong>{row.governorNameRaw || 'Unknown'}</strong>
                  <div className="text-sm text-muted">
                    {row.run.rankingType} / {row.run.metricKey} • sourceRank {row.sourceRank ?? '—'} • metric {row.metricValue}
                  </div>
                  <div className="text-sm text-muted">
                    status {row.identityStatus} • conf {Math.round(row.confidence)}% • run {row.runId}
                  </div>
                </div>
              </div>

              <div style={{ padding: '12px 16px' }}>
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
                    <label className="form-label">Alias (for CREATE_ALIAS)</label>
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

                <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => runAction(row, 'LINK_TO_GOVERNOR')}
                    disabled={busyRow != null}
                  >
                    {busyRow === `${row.id}:LINK_TO_GOVERNOR` ? '...' : 'Link Governor'}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => runAction(row, 'CREATE_ALIAS')}
                    disabled={busyRow != null}
                  >
                    {busyRow === `${row.id}:CREATE_ALIAS` ? '...' : 'Create Alias'}
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => runAction(row, 'CORRECT_ROW')}
                    disabled={busyRow != null}
                  >
                    {busyRow === `${row.id}:CORRECT_ROW` ? '...' : 'Correct Row'}
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => runAction(row, 'REJECT_ROW')}
                    disabled={busyRow != null}
                  >
                    {busyRow === `${row.id}:REJECT_ROW` ? '...' : 'Reject Row'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {rows.length === 0 && !loading && (
          <div className="text-muted">No ranking rows in the selected review state.</div>
        )}
      </div>
    </div>
  );
}
