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
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [governorCount, setGovernorCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rankingHealth, setRankingHealth] = useState<RankingHealth | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [evRes, govRes] = await Promise.all([fetch('/api/events'), fetch('/api/governors?limit=1')]);
        const evData = await evRes.json();
        const govData = await govRes.json();
        setEvents(evData.events || []);
        setGovernorCount(govData.total || 0);
      } catch (err) {
        console.error('Dashboard fetch error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  useEffect(() => {
    async function fetchRankingHealth() {
      const workspaceId = localStorage.getItem('workspaceId') || '';
      const token = localStorage.getItem('workspaceToken') || '';
      if (!workspaceId || !token) {
        setRankingHealth(null);
        return;
      }

      try {
        const params = new URLSearchParams({ workspaceId, topN: '10' });
        const res = await fetch(`/api/v2/rankings/summary?${params.toString()}`, {
          headers: { 'x-access-token': token },
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

    fetchRankingHealth();
  }, []);

  const totalSnapshots = useMemo(() => events.reduce((sum, e) => sum + e.snapshotCount, 0), [events]);
  const unresolvedRanking = rankingHealth?.statusCounts?.UNRESOLVED || 0;

  return (
    <div className="page-container">
      <PageHero
        title="Welcome back, Commander."
        subtitle="Your command center for ingestion, ranking quality, and analytical operations."
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
            title="Ranking metrics require workspace access"
            description="Set workspace ID and access token to unlock ranking health modules."
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
