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
} from 'lucide-react';
import { formatDate, EVENT_TYPE_LABELS } from '@/lib/utils';
import {
  EmptyState,
  KpiCard,
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

export default function Dashboard() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    refreshSession,
  } = useWorkspaceSession();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [governorCount, setGovernorCount] = useState(0);
  const [loading, setLoading] = useState(true);

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

  const totalSnapshots = useMemo(() => events.reduce((sum, e) => sum + e.snapshotCount, 0), [events]);
  const latestEventDate = useMemo(() => (events[0] ? formatDate(events[0].createdAt) : '—'), [events]);

  return (
    <div className="page-container">
      <PageHero
        title="Welcome back, Commander."
        subtitle="Your command center for ingestion, event control, and analytical operations."
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
          icon={<CalendarClock size={18} />}
          label="Latest Event"
          value={loading ? '—' : latestEventDate}
          hint="Newest ingest window"
          tone="neutral"
        />
      </div>

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
