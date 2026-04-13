'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LineChart, Share2, Sparkles } from 'lucide-react';
import { DataTableLite, EmptyState, FilterBar, KpiCard, PageHero, Panel, StatusPill } from '@/components/ui/primitives';

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
  seriesMeta?: Array<{
    label: string;
    metricKey: string;
    colorToken: string;
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
    setWorkspaceId(localStorage.getItem('workspaceId') || '');
    setAccessToken(localStorage.getItem('workspaceToken') || '');
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
      const res = await fetch(`/api/v2/events?workspaceId=${workspaceId}&limit=200`, { headers });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error?.message || 'Failed to load events.');
      const nextEvents = (payload.data || []) as EventOption[];
      setEvents(nextEvents);
      if (!eventA && nextEvents.length >= 2) setEventA(nextEvents[1].id);
      if (!eventB && nextEvents.length >= 1) setEventB(nextEvents[0].id);
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

      const params = new URLSearchParams({ workspaceId, topN: String(topN) });
      if (eventA) params.set('eventA', eventA);
      if (eventB) params.set('eventB', eventB);

      const res = await fetch(`/api/v2/analytics?${params.toString()}`, { headers });
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
      <PageHero
        title="Advanced Insights"
        subtitle="Top-N contribution analysis, trend continuity, and cross-kingdom slices."
        actions={
          <>
            <button className="btn btn-secondary" onClick={loadEvents}>
              <LineChart size={14} /> Refresh Events
            </button>
            <button className="btn btn-primary" onClick={loadAnalytics} disabled={loading}>
              <Sparkles size={14} /> {loading ? 'Loading...' : 'Load Insights'}
            </button>
          </>
        }
      />

      <Panel title="Analytics Scope" subtitle="Workspace-scoped v2 analytics endpoint">
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

        <FilterBar>
          <div className="form-group" style={{ minWidth: 220, marginBottom: 0 }}>
            <label className="form-label">Event A</label>
            <select className="form-select" value={eventA} onChange={(e) => setEventA(e.target.value)}>
              <option value="">Auto</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 220, marginBottom: 0 }}>
            <label className="form-label">Event B</label>
            <select className="form-select" value={eventB} onChange={(e) => setEventB(e.target.value)}>
              <option value="">Auto</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ width: 120, marginBottom: 0 }}>
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
        </FilterBar>

        {analytics?.seriesMeta && analytics.seriesMeta.length > 0 ? (
          <div className="mt-12">
            <FilterBar>
              {analytics.seriesMeta.map((series) => (
                <StatusPill key={series.metricKey} label={`${series.label} (${series.metricKey})`} tone="info" />
              ))}
            </FilterBar>
          </div>
        ) : null}

        {error ? <div className="mt-16 delta-negative">{error}</div> : null}
        {rankboardLink ? (
          <div className="mt-12 text-sm">
            Rankboard: <a href={rankboardLink}>{rankboardLink}</a>
          </div>
        ) : null}
      </Panel>

      {analytics?.selectedComparison ? (
        <>
          <div className="grid-3 mt-24 mb-24">
            <KpiCard
              label="Compared Governors"
              value={analytics.selectedComparison.summary.totalGovernors}
              hint="Matched between selected events"
              tone="info"
            />
            <KpiCard
              label="Average Score"
              value={`${analytics.selectedComparison.summary.avgWarriorScore}%`}
              hint="Weighted total score"
              tone="good"
            />
            <KpiCard
              label="Anomalies"
              value={analytics.selectedComparison.summary.anomalyCount}
              hint="Potential regressions or outliers"
              tone={analytics.selectedComparison.summary.anomalyCount > 0 ? 'warn' : 'good'}
            />
          </div>

          <Panel
            title="Top Contributors"
            subtitle="Top-N by warrior score"
            actions={
              <button className="btn btn-primary btn-sm" onClick={createRankboard}>
                <Share2 size={14} /> Create Shareable Rankboard
              </button>
            }
            className="mb-24"
          >
            <DataTableLite
              rows={analytics.selectedComparison.topContributors}
              rowKey={(row) => row.governorId}
              columns={[
                { key: 'governor', label: 'Governor', render: (row) => row.governorName },
                { key: 'score', label: 'Score', className: 'num', render: (row) => `${row.score}%` },
                {
                  key: 'actual',
                  label: 'Actual DKP',
                  className: 'num',
                  render: (row) => row.actualDkp.toLocaleString(),
                },
                {
                  key: 'kp',
                  label: 'KP Delta',
                  className: 'num',
                  render: (row) => row.killPointsDelta.toLocaleString(),
                },
                {
                  key: 'deads',
                  label: 'Deads Delta',
                  className: 'num',
                  render: (row) => row.deadsDelta.toLocaleString(),
                },
              ]}
            />
          </Panel>
        </>
      ) : null}

      {analytics ? (
        <div className="grid-2">
          <Panel title="Trend Lines" subtitle="Rolling event-pair averages">
            <DataTableLite
              rows={analytics.trendLines}
              rowKey={(row, index) => `${row.eventA.name}-${row.eventB.name}-${index}`}
              columns={[
                {
                  key: 'pair',
                  label: 'Event Pair',
                  render: (row) => `${row.eventA.name} -> ${row.eventB.name}`,
                },
                { key: 'score', label: 'Avg Score', className: 'num', render: (row) => `${row.avgWarriorScore}%` },
                { key: 'gov', label: 'Governors', className: 'num', render: (row) => row.totalGovernors },
                {
                  key: 'anomaly',
                  label: 'Anomalies',
                  className: 'num',
                  mobileHidden: true,
                  render: (row) => row.anomalyCount,
                },
              ]}
            />
          </Panel>

          <Panel title="Kingdom Slice" subtitle="Latest comparative score per workspace">
            <DataTableLite
              rows={analytics.kingdomSlices}
              rowKey={(row) => row.workspaceId}
              columns={[
                {
                  key: 'kingdom',
                  label: 'Kingdom',
                  render: (row) => `${row.kingdomTag ? `[${row.kingdomTag}] ` : ''}${row.name}`,
                },
                {
                  key: 'avg',
                  label: 'Latest Avg',
                  className: 'num',
                  render: (row) => row.latestAvgWarriorScore ?? '—',
                },
                { key: 'gov', label: 'Governors', className: 'num', render: (row) => row.totals.governors },
                {
                  key: 'events',
                  label: 'Events',
                  className: 'num',
                  mobileHidden: true,
                  render: (row) => row.totals.events,
                },
              ]}
            />
          </Panel>
        </div>
      ) : (
        <div className="mt-24">
          <EmptyState
            title="Insights not loaded"
            description="Provide workspace token and click Load Insights to render trend and contribution analysis."
          />
        </div>
      )}
    </div>
  );
}
