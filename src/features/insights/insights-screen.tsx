'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Share2 } from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTableLite, EmptyState, FilterBar, KpiCard, PageHero, Panel } from '@/components/ui/primitives';

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
  const AUTO_VALUE = '__auto__';
  const {
    workspaceId,
    accessToken,
    ready,
    loading: sessionLoading,
    error: sessionError,
    refreshSession,
  } = useWorkspaceSession();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventA, setEventA] = useState('');
  const [eventB, setEventB] = useState('');
  const [topN, setTopN] = useState(10);
  const [error, setError] = useState('');
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [rankboardLink, setRankboardLink] = useState('');

  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
      'x-access-token': accessToken,
    }),
    [accessToken]
  );

  const loadEvents = useCallback(async () => {
    if (!ready) return;
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
  }, [workspaceId, headers, eventA, eventB, ready]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const loadAnalytics = useCallback(async () => {
    if (!ready) {
      setError(sessionLoading ? 'Connecting workspace session...' : 'Workspace session is not ready.');
      return;
    }

    setError('');
    setRankboardLink('');

    try {
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
    }
  }, [workspaceId, topN, eventA, eventB, headers, ready, sessionLoading]);

  useEffect(() => {
    if (ready && events.length > 0) {
      void loadAnalytics();
    }
  }, [events, loadAnalytics, ready]);

  const createRankboard = async () => {
    if (!analytics?.selectedComparison || !ready) return;
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
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <PageHero
        title="Insights"
        subtitle="Top-N contribution trends and cross-kingdom analytics."
      />

      <SessionGate ready={ready} loading={sessionLoading} error={sessionError} onRetry={() => void refreshSession()}>
        {error ? <InlineError message={error} /> : null}

        <Panel title="Analysis Parameters">
          <FilterBar className="w-full items-stretch gap-2.5 sm:items-center">
            <Select value={eventA || AUTO_VALUE} onValueChange={(value) => setEventA(value === AUTO_VALUE ? '' : value)}>
              <SelectTrigger className="w-full min-w-0 rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 sm:min-w-52">
                <SelectValue placeholder="Event A" />
              </SelectTrigger>
              <SelectContent className="border-[color:var(--stroke-soft)] bg-[rgba(8,10,16,0.98)] text-tier-1">
                <SelectItem value={AUTO_VALUE}>Auto (Event A)</SelectItem>
                {events.map((event) => (
                  <SelectItem key={event.id} value={event.id}>
                    {event.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={eventB || AUTO_VALUE} onValueChange={(value) => setEventB(value === AUTO_VALUE ? '' : value)}>
              <SelectTrigger className="w-full min-w-0 rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 sm:min-w-52">
                <SelectValue placeholder="Event B" />
              </SelectTrigger>
              <SelectContent className="border-[color:var(--stroke-soft)] bg-[rgba(8,10,16,0.98)] text-tier-1">
                <SelectItem value={AUTO_VALUE}>Auto (Event B)</SelectItem>
                {events.map((event) => (
                  <SelectItem key={event.id} value={event.id}>
                    {event.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="w-full min-w-0 sm:w-28">
              <Input
                type="number"
                min={3}
                max={50}
                value={topN}
                onChange={(e) => setTopN(Math.max(3, Math.min(50, Number(e.target.value) || 10)))}
                className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
              />
            </div>
          </FilterBar>

          {rankboardLink ? (
            <div className="mt-4 rounded-2xl border border-sky-300/16 bg-sky-300/10 px-4 py-3 text-sm text-sky-100">
              Rankboard:{' '}
              <a href={rankboardLink} className="underline">
                {rankboardLink}
              </a>
            </div>
          ) : null}
        </Panel>

        {analytics?.selectedComparison ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                <Button
                  className="rounded-full bg-[linear-gradient(135deg,#5a7fff,#7ce6ff)] text-black hover:opacity-95"
                  onClick={createRankboard}
                >
                  <Share2 data-icon="inline-start" /> Create Rankboard
                </Button>
              }
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
          <div className="grid gap-6 xl:grid-cols-2">
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
          <EmptyState
            title="Insights not loaded"
            description="Select event parameters to render trend and contribution analysis."
          />
        )}
      </SessionGate>
    </div>
  );
}
