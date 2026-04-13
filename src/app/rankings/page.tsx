'use client';

import { useCallback, useEffect, useState } from 'react';

type RankingStatus = 'ACTIVE' | 'UNRESOLVED' | 'REJECTED';

interface CanonicalRow {
  id: string;
  eventId: string;
  rankingType: string;
  metricKey: string;
  governorId: string | null;
  governorNameRaw: string;
  metricValue: string;
  sourceRank: number | null;
  status: RankingStatus;
  stableRank: number;
  tieGroup: number;
  updatedAt: string;
}

export default function RankingsPage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [eventId, setEventId] = useState('');
  const [rankingType, setRankingType] = useState('');
  const [status, setStatus] = useState('ACTIVE,UNRESOLVED');
  const [rows, setRows] = useState<CanonicalRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    total: number;
    statusCounts: Record<string, number>;
    rankingTypes: Array<{ rankingType: string; metricKey: string; total: number }>;
  } | null>(null);

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

  const loadData = useCallback(
    async (cursor: string | null = null) => {
      if (!workspaceId || !accessToken) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          workspaceId,
          limit: '50',
          status,
        });
        if (eventId.trim()) params.set('eventId', eventId.trim());
        if (rankingType.trim()) params.set('rankingType', rankingType.trim());
        if (cursor) params.set('cursor', cursor);

        const [rowsRes, summaryRes] = await Promise.all([
          fetch(`/api/v2/rankings?${params.toString()}`, {
            headers: { 'x-access-token': accessToken },
          }),
          fetch(
            `/api/v2/rankings/summary?${new URLSearchParams({
              workspaceId,
              ...(eventId.trim() ? { eventId: eventId.trim() } : {}),
              ...(rankingType.trim() ? { rankingType: rankingType.trim() } : {}),
              topN: '15',
            }).toString()}`,
            {
              headers: { 'x-access-token': accessToken },
            }
          ),
        ]);

        const rowsPayload = await rowsRes.json();
        const summaryPayload = await summaryRes.json();

        if (!rowsRes.ok) {
          throw new Error(rowsPayload?.error?.message || 'Failed to load canonical rankings.');
        }

        setRows(Array.isArray(rowsPayload?.data) ? rowsPayload.data : []);
        setNextCursor(rowsPayload?.meta?.nextCursor || null);

        if (summaryRes.ok && summaryPayload?.data) {
          setSummary(summaryPayload.data);
        } else {
          setSummary(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load rankings.');
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, accessToken, eventId, rankingType, status]
  );

  const refresh = () => {
    setCursorStack([null]);
    setNextCursor(null);
    loadData(null);
  };

  useEffect(() => {
    if (workspaceId && accessToken) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, accessToken]);

  const goNext = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, nextCursor]);
    loadData(nextCursor);
  };

  const goBack = () => {
    if (cursorStack.length <= 1) return;
    const prevStack = [...cursorStack];
    prevStack.pop();
    const cursor = prevStack[prevStack.length - 1] || null;
    setCursorStack(prevStack);
    loadData(cursor);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>🏆 Canonical Rankings</h1>
        <p>Deterministic sorted ranking snapshots with stable pagination.</p>
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

        <div className="grid-2 mt-12">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Event ID (optional)</label>
            <input className="form-input" value={eventId} onChange={(e) => setEventId(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Ranking Type (optional)</label>
            <input className="form-input" value={rankingType} onChange={(e) => setRankingType(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-12 mt-12" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Statuses</label>
            <input className="form-input" value={status} onChange={(e) => setStatus(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={refresh} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button className="btn btn-secondary" onClick={goBack} disabled={loading || cursorStack.length <= 1}>
            Prev
          </button>
          <button className="btn btn-secondary" onClick={goNext} disabled={loading || !nextCursor}>
            Next
          </button>
        </div>
      </div>

      {summary && (
        <div className="card card-no-hover mb-24">
          <h3 className="mb-12">Summary</h3>
          <div className="text-sm text-muted mb-8">Total snapshots: {summary.total}</div>
          <div className="text-sm text-muted mb-8">
            Status counts:{' '}
            {Object.entries(summary.statusCounts)
              .map(([k, v]) => `${k}:${v}`)
              .join(' | ')}
          </div>
          <div className="text-sm text-muted">
            Top ranking types:{' '}
            {summary.rankingTypes
              .slice(0, 6)
              .map((item) => `${item.rankingType}(${item.metricKey})=${item.total}`)
              .join(' | ')}
          </div>
        </div>
      )}

      <div className="card card-no-hover">
        {error && <div className="delta-negative mb-12">{error}</div>}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Stable</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Governor</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Metric</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ padding: '8px 6px' }}>#{row.stableRank} (T{row.tieGroup})</td>
                  <td style={{ padding: '8px 6px' }}>
                    {row.rankingType} / {row.metricKey}
                  </td>
                  <td style={{ padding: '8px 6px' }}>{row.governorNameRaw}</td>
                  <td style={{ padding: '8px 6px' }}>{row.metricValue}</td>
                  <td style={{ padding: '8px 6px' }}>{row.status}</td>
                  <td style={{ padding: '8px 6px' }}>{new Date(row.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '12px 6px' }} className="text-muted">
                    No canonical ranking rows found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
