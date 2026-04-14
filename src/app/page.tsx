'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  Database,
  ShieldAlert,
  Users,
  FileBox,
  Library,
  AlertTriangle,
} from 'lucide-react';
import { TierPieChart } from '@/components/Charts';
import { formatDate, EVENT_TYPE_LABELS } from '@/lib/utils';
import {
  EmptyState,
  KpiCard,
  MetricStrip,
  PageHero,
  Panel,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';
import { useWorkspaceSession } from '@/lib/workspace-session';

interface EventSummary {
  id: string;
  name: string;
  eventType: string;
  snapshotCount: number;
  createdAt: string;
}

interface RankingHealth {
  total: number;
  statusCounts: Record<string, number>;
  rankingTypes: Array<{ rankingType: string; metricKey: string; total: number }>;
}

export default function Dashboard() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
    refreshSession,
  } = useWorkspaceSession();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [governorCount, setGovernorCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rankingHealth, setRankingHealth] = useState<RankingHealth | null>(null);

  useEffect(() => {
    async function fetchData() {
      if (!workspaceReady) {
        setEvents([]);
        setGovernorCount(0);
        setLoading(sessionLoading);
        return;
      }

      try {
        setLoading(true);
        const [evRes, govRes] = await Promise.all([
          fetch(`/api/v2/events?${new URLSearchParams({ workspaceId, limit: '50' }).toString()}`, {
            headers: { 'x-access-token': accessToken },
          }),
          fetch(`/api/v2/governors?${new URLSearchParams({ workspaceId, limit: '1' }).toString()}`, {
            headers: { 'x-access-token': accessToken },
          }),
        ]);

        const evPayload = await evRes.json();
        const govPayload = await govRes.json();

        if (evRes.ok && Array.isArray(evPayload?.data)) {
          setEvents(evPayload.data as EventSummary[]);
        } else {
          setEvents([]);
        }

        if (govRes.ok) {
          setGovernorCount(Number(govPayload?.meta?.total || 0));
        } else {
          setGovernorCount(0);
        }
      } finally {
        setLoading(false);
      }
    }

    void fetchData();
  }, [workspaceReady, workspaceId, accessToken, sessionLoading]);

  useEffect(() => {
    async function fetchRankingHealth() {
      if (!workspaceReady) {
        setRankingHealth(null);
        return;
      }

      try {
        const params = new URLSearchParams({ workspaceId, topN: '10' });
        const res = await fetch(`/api/v2/rankings/summary?${params.toString()}`, {
          headers: { 'x-access-token': accessToken },
        });
        const payload = await res.json();
        if (res.ok && payload?.data) {
          setRankingHealth(payload.data as RankingHealth);
        } else {
          setRankingHealth(null);
        }
      } catch {
        setRankingHealth(null);
      }
    }

    void fetchRankingHealth();
  }, [workspaceId, accessToken, workspaceReady]);

  const totalSnapshots = useMemo(() => events.reduce((sum, e) => sum + e.snapshotCount, 0), [events]);
  const unresolvedRanking = rankingHealth?.statusCounts?.UNRESOLVED || 0;

  return (
    <div className="page-container">
      <PageHero
        title="Welcome back, Commander."
        subtitle="Your command center for ingestion, ranking quality, and analytical operations."
        actions={
          <button className="btn btn-secondary btn-sm" onClick={() => void refreshSession()} disabled={sessionLoading}>
            {sessionLoading ? 'Connecting...' : 'Reconnect'}
          </button>
        }
      />

      <div className="grid-4 mb-24 animate-fade-in-up">
        <KpiCard icon={<Users size={18} />} label="Governors" value={loading ? '—' : governorCount} hint="Tracked identities" tone="neutral" />
        <KpiCard icon={<Library size={18} />} label="Events" value={loading ? '—' : events.length} hint="Available snapshots" tone="info" />
        <KpiCard icon={<FileBox size={18} />} label="Snapshots" value={loading ? '—' : totalSnapshots} hint="Captured profiles" tone="good" />
        <KpiCard
          icon={<AlertTriangle size={18} />}
          label="Unresolved Rows"
          value={rankingHealth ? unresolvedRanking : 0}
          hint="Require identity review"
          tone={unresolvedRanking > 0 ? 'warn' : 'good'}
        />
      </div>

      <Panel title="Ranking Health" subtitle="State distribution across all active tables" className="mb-24">
        {rankingHealth ? (
          <div className="flex flex-col gap-4">
            <MetricStrip
              items={[
                { label: 'Total Rows', value: rankingHealth.total, accent: 'teal' },
                { label: 'Active', value: rankingHealth.statusCounts.ACTIVE || 0, accent: 'gold' },
                { label: 'Unresolved', value: rankingHealth.statusCounts.UNRESOLVED || 0, accent: 'rose' },
              ]}
            />
            <div style={{ marginTop: '-40px', marginBottom: '-20px' }}>
              <TierPieChart distribution={rankingHealth.statusCounts} />
            </div>
            <div className="mt-6 text-sm text-center" style={{ color: 'var(--text-3)' }}>
              Top types:{' '}
              {rankingHealth.rankingTypes
                .slice(0, 4)
                .map((item) => `${item.rankingType}/${item.metricKey}`)
                .join(' • ') || 'None'}
            </div>
          </div>
        ) : (
          <EmptyState
            title="Ranking metrics are unavailable"
            description={sessionLoading ? 'Connecting workspace session...' : sessionError || 'Connect workspace session to load ranking health.'}
          />
        )}
      </Panel>

      <Panel
        title="Recent Events"
        subtitle="Newest entries ready for compare and insights"
        actions={
          <Link href="/events" className="btn btn-secondary btn-sm">
            <CalendarClock size={14} /> Manage
          </Link>
        }
      >
        {loading ? (
          <SkeletonSet rows={4} />
        ) : events.length === 0 ? (
          <EmptyState
            title="No events yet"
            description="Create an event and upload screenshots to begin analytics."
            action={
              <Link href="/upload" className="btn btn-primary">
                <Database size={14} /> Start Ingestion
              </Link>
            }
          />
        ) : (
          events.slice(0, 8).map((event) => (
            <div key={event.id} className="event-card">
              <div className="event-card-info">
                <div className="event-card-name">{event.name}</div>
                <div className="event-card-meta">
                  <StatusPill label={EVENT_TYPE_LABELS[event.eventType] || event.eventType} tone="info" />
                  <span>{event.snapshotCount} governors</span>
                  <span>{formatDate(event.createdAt)}</span>
                  {event.snapshotCount < 20 ? <ShieldAlert size={14} color="#f5b54a" /> : null}
                </div>
              </div>
              <div className="event-card-actions">
                <Link href={`/events/${event.id}`} className="btn btn-secondary btn-sm">
                  View
                </Link>
                <Link href={`/compare?eventA=${event.id}`} className="btn btn-secondary btn-sm">
                  Compare
                </Link>
              </div>
            </div>
          ))
        )}
      </Panel>
    </div>
  );
}
