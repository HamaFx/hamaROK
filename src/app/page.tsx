'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, CalendarClock, Database, ShieldAlert, Swords, Trophy } from 'lucide-react';
import { formatDate, EVENT_TYPE_LABELS } from '@/lib/utils';
import { EmptyState, KpiCard, MetricStrip, PageHero, Panel, SkeletonSet, StatusPill } from '@/components/ui/primitives';

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
        title="Command Center"
        subtitle="Live operational picture across ingestion, rankings, and event analytics."
        badges={['Tactical Pro UI', 'Deterministic Rankings', 'Always-Review OCR']}
        actions={
          <>
            <Link href="/upload" className="btn btn-primary btn-lg">
              <Swords size={14} /> Upload Capture
            </Link>
            <Link href="/rankings" className="btn btn-secondary btn-lg">
              <Trophy size={14} /> Open Rankings
            </Link>
          </>
        }
      />

      <div className="grid-4 mb-24 animate-fade-in-up">
        <KpiCard label="Governors" value={loading ? '—' : governorCount} hint="Unique tracked identities" tone="neutral" />
        <KpiCard label="Events" value={loading ? '—' : events.length} hint="Snapshots grouped by event" tone="info" />
        <KpiCard label="Snapshots" value={loading ? '—' : totalSnapshots} hint="Profile captures ingested" tone="good" />
        <KpiCard
          label="Unresolved Rows"
          value={rankingHealth ? unresolvedRanking : '—'}
          hint="Ranking rows waiting identity resolution"
          tone={unresolvedRanking > 0 ? 'warn' : 'good'}
        />
      </div>

      <div className="grid-2 mb-24">
        <Panel
          title="Quick Operations"
          subtitle="Jump into the most common workflows"
          actions={
            <Link href="/insights" className="btn btn-ghost btn-sm">
              <Activity size={14} /> Analytics
            </Link>
          }
        >
          <div className="action-toolbar">
            <Link href="/upload" className="btn btn-primary">
              Ingest Screenshots
            </Link>
            <Link href="/review" className="btn btn-secondary">
              OCR Review Queue
            </Link>
            <Link href="/rankings/review" className="btn btn-secondary">
              Ranking Review Queue
            </Link>
            <Link href="/compare" className="btn btn-secondary">
              Compare Events
            </Link>
          </div>
        </Panel>

        <Panel title="Ranking Health" subtitle="Canonical ranking state and distribution">
          {rankingHealth ? (
            <>
              <MetricStrip
                items={[
                  { label: 'Total Rows', value: rankingHealth.total, accent: 'teal' },
                  { label: 'Active', value: rankingHealth.statusCounts.ACTIVE || 0, accent: 'gold' },
                  { label: 'Unresolved', value: rankingHealth.statusCounts.UNRESOLVED || 0, accent: 'rose' },
                  { label: 'Rejected', value: rankingHealth.statusCounts.REJECTED || 0, accent: 'slate' },
                ]}
              />
              <div className="mt-12 text-sm text-muted">
                Top ranking types:{' '}
                {rankingHealth.rankingTypes
                  .slice(0, 4)
                  .map((item) => `${item.rankingType}/${item.metricKey}`)
                  .join(' • ') || 'None'}
              </div>
            </>
          ) : (
            <EmptyState
              title="Ranking metrics locked behind workspace links"
              description="Set workspace ID + access token in any v2 page to enable ranking health modules."
            />
          )}
        </Panel>
      </div>

      <Panel
        title="Recent Events"
        subtitle="Newest captures available for compare and insights"
        actions={
          <Link href="/events" className="btn btn-secondary btn-sm">
            <CalendarClock size={14} /> Manage Events
          </Link>
        }
      >
        {loading ? (
          <SkeletonSet rows={4} />
        ) : events.length === 0 ? (
          <EmptyState
            title="No events yet"
            description="Create an event and upload screenshots to begin building analytics."
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
