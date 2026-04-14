'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
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

interface WeeklyEventInfo {
  id: string;
  name: string;
  weekKey: string | null;
  startsAt: string | null;
}

interface WeeklyActivityResponse {
  event: {
    id: string;
    weekKey: string | null;
    name: string;
  };
  rows: Array<{
    governorDbId: string;
    governorName: string;
    contributionPoints: string;
    powerGrowth: string | null;
  }>;
  summary: {
    membersTracked: number;
    unresolvedIdentityCount: number;
    noPowerBaselineCount: number;
    noKillPointsBaselineCount: number;
    allianceSummary: Array<{
      allianceTag: string;
      allianceLabel: string;
      members: number;
      passCount: number;
      failCount: number;
    }>;
  };
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
  const [weeklyEvent, setWeeklyEvent] = useState<WeeklyEventInfo | null>(null);
  const [weeklyActivity, setWeeklyActivity] = useState<WeeklyActivityResponse | null>(null);
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
        const [evRes, govRes, weeklyRes] = await Promise.all([
          fetch(`/api/v2/events?${new URLSearchParams({ workspaceId, limit: '50' }).toString()}`, {
            headers: { 'x-access-token': accessToken },
          }),
          fetch(`/api/v2/governors?${new URLSearchParams({ workspaceId, limit: '1' }).toString()}`, {
            headers: { 'x-access-token': accessToken },
          }),
          fetch(`/api/v2/events/weekly?${new URLSearchParams({ workspaceId, autoCreate: 'true' }).toString()}`, {
            headers: { 'x-access-token': accessToken },
          }),
        ]);

        const evPayload = await evRes.json();
        const govPayload = await govRes.json();
        const weeklyPayload = await weeklyRes.json();

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

        if (weeklyRes.ok && weeklyPayload?.data?.id) {
          const weeklyInfo: WeeklyEventInfo = {
            id: weeklyPayload.data.id,
            name: weeklyPayload.data.name,
            weekKey: weeklyPayload.data.weekKey || null,
            startsAt: weeklyPayload.data.startsAt || null,
          };
          setWeeklyEvent(weeklyInfo);

          const activityRes = await fetch(
            `/api/v2/activity/weekly?workspaceId=${encodeURIComponent(workspaceId)}${
              weeklyInfo.weekKey ? `&weekKey=${encodeURIComponent(weeklyInfo.weekKey)}` : ''
            }`,
            {
              headers: { 'x-access-token': accessToken },
            }
          );
          const activityPayload = await activityRes.json();
          if (activityRes.ok && activityPayload?.data) {
            setWeeklyActivity(activityPayload.data as WeeklyActivityResponse);
          } else {
            setWeeklyActivity(null);
          }
        } else {
          setWeeklyEvent(null);
          setWeeklyActivity(null);
        }
      } finally {
        setLoading(false);
      }
    }

    void fetchData();
  }, [workspaceReady, workspaceId, accessToken, sessionLoading]);

  const totalSnapshots = useMemo(() => events.reduce((sum, e) => sum + e.snapshotCount, 0), [events]);
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
          label="Current Week"
          value={loading ? '—' : weeklyEvent?.weekKey || '—'}
          hint={loading ? 'Loading weekly window' : weeklyEvent?.name || 'No weekly event'}
          tone="neutral"
        />
      </div>

      {weeklyActivity ? (
        <Panel
          title="Weekly Activity Snapshot"
          subtitle={`${weeklyActivity.summary.membersTracked} tracked members • ${weeklyActivity.event.name}`}
          actions={
            <Link href="/activity" className="btn btn-secondary btn-sm">
              <Activity size={14} /> Open Activity
            </Link>
          }
          className="mb-24"
        >
          <div className="ranking-mobile-meta-line" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
            {weeklyActivity.summary.allianceSummary.map((alliance) => (
              <span key={alliance.allianceTag}>
                {alliance.allianceLabel}: {alliance.passCount}/{alliance.members} pass
              </span>
            ))}
          </div>
          <div className="grid-2">
            <div>
              <h4 style={{ margin: '0 0 8px' }}>Top Contribution</h4>
              {(weeklyActivity.rows || []).slice(0, 3).map((row) => (
                <div key={`c-${row.governorDbId}`} className="ranking-mobile-meta-line" style={{ justifyContent: 'space-between' }}>
                  <span>{row.governorName}</span>
                  <strong>{Number(row.contributionPoints).toLocaleString()}</strong>
                </div>
              ))}
            </div>
            <div>
              <h4 style={{ margin: '0 0 8px' }}>Top Power Growth</h4>
              {[...(weeklyActivity.rows || [])]
                .sort((a, b) => {
                  const diff = BigInt(b.powerGrowth || '0') - BigInt(a.powerGrowth || '0');
                  if (diff === BigInt(0)) return 0;
                  return diff > BigInt(0) ? 1 : -1;
                })
                .slice(0, 3)
                .map((row) => (
                  <div key={`p-${row.governorDbId}`} className="ranking-mobile-meta-line" style={{ justifyContent: 'space-between' }}>
                    <span>{row.governorName}</span>
                    <strong>{row.powerGrowth != null ? Number(row.powerGrowth).toLocaleString() : 'N/A'}</strong>
                  </div>
                ))}
            </div>
          </div>
          <div className="ranking-mobile-meta-line" style={{ marginTop: 12 }}>
            <span>Unlinked: {weeklyActivity.summary.unresolvedIdentityCount}</span>
            <span>No power baseline: {weeklyActivity.summary.noPowerBaselineCount}</span>
            <span>No KP baseline: {weeklyActivity.summary.noKillPointsBaselineCount}</span>
          </div>
        </Panel>
      ) : null}

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
