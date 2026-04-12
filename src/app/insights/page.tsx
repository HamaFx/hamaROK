'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface EventOption {
  id: string;
  name: string;
}

interface AnalyticsPayload {
  generatedAt: string;
  selectedComparison: {
    eventA: { id: string; name: string };
    eventB: { id: string; name: string };
    summary: {
      totalGovernors: number;
      avgWarriorScore: number;
      anomalyCount: number;
      scoreBuckets: Record<string, number>;
    };
    topContributors: Array<{
      governorId: string;
      governorName: string;
      score: number;
      actualDkp: number;
      killPointsDelta: number;
      deadsDelta: number;
    }>;
    topByKillPoints: Array<{
      governorId: string;
      governorName: string;
      killPointsDelta: number;
      score: number;
    }>;
    topByDeads: Array<{
      governorId: string;
      governorName: string;
      deadsDelta: number;
      score: number;
    }>;
  } | null;
  trendLines: Array<{
    eventA: { name: string; date: string };
    eventB: { name: string; date: string };
    avgWarriorScore: number;
    totalGovernors: number;
    anomalyCount: number;
  }>;
  kingdomSlices: Array<{
    workspaceId: string;
    name: string;
    kingdomTag: string | null;
    latestAvgWarriorScore: number | null;
    totals: {
      governors: number;
      events: number;
      snapshots: number;
    };
  }>;
}

export default function InsightsPage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventA, setEventA] = useState('');
  const [eventB, setEventB] = useState('');
  const [topN, setTopN] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [rankboardLink, setRankboardLink] = useState('');

  useEffect(() => {
    const savedWorkspace = localStorage.getItem('workspaceId') || '';
    const savedToken = localStorage.getItem('workspaceToken') || '';
    setWorkspaceId(savedWorkspace);
    setAccessToken(savedToken);
  }, []);

  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
      'x-access-token': accessToken,
    }),
    [accessToken]
  );

  const loadEvents = useCallback(async () => {
    if (!workspaceId || !accessToken) return;
    try {
      const res = await fetch(`/api/v2/events?workspaceId=${workspaceId}&limit=200`, {
        headers,
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error?.message || 'Failed to load events.');
      const next = (payload.data || []) as EventOption[];
      setEvents(next);
      if (!eventA && next.length >= 2) {
        setEventA(next[1].id);
      }
      if (!eventB && next.length >= 1) {
        setEventB(next[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events.');
    }
  }, [workspaceId, accessToken, headers, eventA, eventB]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const loadAnalytics = useCallback(async () => {
    if (!workspaceId || !accessToken) {
      setError('Workspace ID and access token are required.');
      return;
    }

    setLoading(true);
    setError('');
    setRankboardLink('');

    try {
      localStorage.setItem('workspaceId', workspaceId);
      localStorage.setItem('workspaceToken', accessToken);

      const params = new URLSearchParams({
        workspaceId,
        topN: String(topN),
      });
      if (eventA) params.set('eventA', eventA);
      if (eventB) params.set('eventB', eventB);

      const res = await fetch(`/api/v2/analytics?${params.toString()}`, {
        headers,
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error?.message || 'Failed to load analytics.');
      setAnalytics(payload.data as AnalyticsPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics.');
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, accessToken, topN, eventA, eventB, headers]);

  const createRankboard = async () => {
    if (!analytics?.selectedComparison || !workspaceId || !accessToken) return;

    setError('');
    setRankboardLink('');

    try {
      const res = await fetch('/api/v2/rankboards', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workspaceId,
          eventA: analytics.selectedComparison.eventA.id,
          eventB: analytics.selectedComparison.eventB.id,
          topN,
          expiresInDays: 30,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error?.message || 'Failed to create rankboard.');
      setRankboardLink(payload.data?.shareUrl || 'Rankboard created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rankboard.');
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>📡 Advanced Insights</h1>
        <p>Top-N contributions, trend lines across scans, and cross-kingdom slices.</p>
      </div>

      <div className="card card-no-hover mb-24">
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">Workspace ID</label>
            <input className="form-input" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Access Token</label>
            <input className="form-input" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
          </div>
        </div>

        <div className="grid-3">
          <div className="form-group">
            <label className="form-label">Event A</label>
            <select className="form-select" value={eventA} onChange={(e) => setEventA(e.target.value)}>
              <option value="">Auto</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>{event.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Event B</label>
            <select className="form-select" value={eventB} onChange={(e) => setEventB(e.target.value)}>
              <option value="">Auto</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>{event.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Top N</label>
            <input
              className="form-input"
              type="number"
              min={3}
              max={50}
              value={topN}
              onChange={(e) => setTopN(Math.max(3, Math.min(50, Number(e.target.value) || 10)))}
            />
          </div>
        </div>

        <div className="flex gap-12">
          <button className="btn btn-primary" onClick={loadAnalytics} disabled={loading}>
            {loading ? 'Loading...' : 'Load Insights'}
          </button>
          <button className="btn btn-secondary" onClick={loadEvents}>Refresh Events</button>
        </div>

        {error && <div className="mt-16 delta-negative">{error}</div>}
        {rankboardLink && (
          <div className="mt-16 text-sm">
            Rankboard link: <a href={rankboardLink} target="_blank" rel="noreferrer">{rankboardLink}</a>
          </div>
        )}
      </div>

      {analytics?.selectedComparison && (
        <>
          <div className="grid-3 mb-24">
            <div className="card stats-card">
              <div className="stats-label">Compared Governors</div>
              <div className="stats-value">{analytics.selectedComparison.summary.totalGovernors}</div>
            </div>
            <div className="card stats-card">
              <div className="stats-label">Avg Score</div>
              <div className="stats-value">{analytics.selectedComparison.summary.avgWarriorScore}%</div>
            </div>
            <div className="card stats-card">
              <div className="stats-label">Anomalies</div>
              <div className="stats-value">{analytics.selectedComparison.summary.anomalyCount}</div>
            </div>
          </div>

          <div className="card card-no-hover mb-24">
            <div className="flex justify-between items-center mb-16">
              <h3>Top Contributors</h3>
              <button className="btn btn-primary btn-sm" onClick={createRankboard}>Create Shareable Rankboard</button>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Governor</th>
                    <th>Score</th>
                    <th>Actual DKP</th>
                    <th>KP Δ</th>
                    <th>Deads Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.selectedComparison.topContributors.map((item) => (
                    <tr key={item.governorId}>
                      <td>{item.governorName}</td>
                      <td>{item.score}%</td>
                      <td>{item.actualDkp.toLocaleString()}</td>
                      <td>{item.killPointsDelta.toLocaleString()}</td>
                      <td>{item.deadsDelta.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {analytics && (
        <div className="grid-2">
          <div className="card card-no-hover">
            <h3 className="mb-16">Trend Lines</h3>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pair</th>
                    <th>Avg Score</th>
                    <th>Governors</th>
                    <th>Anomalies</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.trendLines.map((line, idx) => (
                    <tr key={`${line.eventA.name}-${line.eventB.name}-${idx}`}>
                      <td>{line.eventA.name} → {line.eventB.name}</td>
                      <td>{line.avgWarriorScore}%</td>
                      <td>{line.totalGovernors}</td>
                      <td>{line.anomalyCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card card-no-hover">
            <h3 className="mb-16">Kingdom/KvK Comparative Slice</h3>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kingdom</th>
                    <th>Latest Avg</th>
                    <th>Governors</th>
                    <th>Events</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.kingdomSlices.map((slice) => (
                    <tr key={slice.workspaceId}>
                      <td>{slice.kingdomTag ? `[${slice.kingdomTag}] ` : ''}{slice.name}</td>
                      <td>{slice.latestAvgWarriorScore ?? '—'}</td>
                      <td>{slice.totals.governors}</td>
                      <td>{slice.totals.events}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
