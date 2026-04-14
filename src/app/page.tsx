'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  Database,
  FileBox,
  FlaskConical,
  ImageUp,
  Library,
  ShieldAlert,
  ShieldCheck,
  Swords,
  Users,
} from 'lucide-react';
import { formatDate, EVENT_TYPE_LABELS } from '@/lib/utils';
import { EmptyState, SkeletonSet, StatusPill } from '@/components/ui/primitives';
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

const QUICK_ACTIONS = [
  {
    href: '/upload',
    title: 'Upload Screenshots',
    description: 'Queue profile and ranking screenshots for OCR.',
    icon: ImageUp,
    tone: 'primary',
  },
  {
    href: '/review',
    title: 'OCR Review',
    description: 'Validate profile OCR rows and fix low confidence results.',
    icon: FlaskConical,
    tone: 'neutral',
  },
  {
    href: '/rankings/review',
    title: 'Ranking Review',
    description: 'Resolve identity matches from power, fort, and scientist boards.',
    icon: ShieldCheck,
    tone: 'neutral',
  },
  {
    href: '/activity',
    title: 'Weekly Activity',
    description: 'Review alliance compliance and leaderboard momentum.',
    icon: Activity,
    tone: 'neutral',
  },
  {
    href: '/events',
    title: 'Event Registry',
    description: 'Manage weekly windows and event checkpoints.',
    icon: CalendarClock,
    tone: 'neutral',
  },
  {
    href: '/compare',
    title: 'Compare Events',
    description: 'Run delta analysis and warrior score outputs.',
    icon: Swords,
    tone: 'neutral',
  },
] as const;

function toSafeBigInt(value: string | null | undefined) {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
}

export default function Dashboard() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
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

  const topContributionRows = useMemo(() => {
    return [...(weeklyActivity?.rows || [])]
      .sort((a, b) => {
        const diff = toSafeBigInt(b.contributionPoints) - toSafeBigInt(a.contributionPoints);
        if (diff === BigInt(0)) return 0;
        return diff > BigInt(0) ? 1 : -1;
      })
      .slice(0, 3);
  }, [weeklyActivity?.rows]);

  const topPowerGrowthRows = useMemo(() => {
    return [...(weeklyActivity?.rows || [])]
      .filter((row) => row.powerGrowth != null)
      .sort((a, b) => {
        const diff = toSafeBigInt(b.powerGrowth) - toSafeBigInt(a.powerGrowth);
        if (diff === BigInt(0)) return 0;
        return diff > BigInt(0) ? 1 : -1;
      })
      .slice(0, 3);
  }, [weeklyActivity?.rows]);

  const alliancePulse = useMemo(() => {
    return (weeklyActivity?.summary.allianceSummary || []).map((alliance) => {
      const passRate = alliance.members > 0 ? Math.round((alliance.passCount / alliance.members) * 100) : 0;
      return {
        ...alliance,
        passRate,
      };
    });
  }, [weeklyActivity?.summary.allianceSummary]);

  return (
    <div className="page-container dashboard-shell">
      <section className="dashboard-command-card animate-fade-in-up">
        <div className="dashboard-command-main">
          <p className="dashboard-eyebrow">Kingdom Operations</p>
          <h1>Command Dashboard</h1>
          <p>
            Weekly pulse, ingestion flow, and review readiness in one mobile-first control room.
          </p>
          <div className="dashboard-chip-row">
            <span className="dashboard-chip">
              <CalendarClock size={13} /> Week {weeklyEvent?.weekKey || '—'}
            </span>
            <span className="dashboard-chip">
              <Users size={13} /> {weeklyActivity?.summary.membersTracked ?? 0} tracked
            </span>
            <span className="dashboard-chip">
              <ShieldAlert size={13} /> {weeklyActivity?.summary.unresolvedIdentityCount ?? 0} unlinked
            </span>
          </div>
        </div>
        <div className="dashboard-command-cta">
          <Link href="/upload" className="btn btn-primary btn-sm">
            <ImageUp size={14} /> Upload Screenshots
          </Link>
          <Link href="/activity" className="btn btn-secondary btn-sm">
            <Activity size={14} /> Open Weekly Activity
          </Link>
        </div>
      </section>

      <section className="dashboard-stats-grid">
        <article className="dashboard-stat-card tone-neutral">
          <div className="dashboard-stat-head">
            <span>Governors</span>
            <Users size={16} />
          </div>
          <p className="dashboard-stat-value">{loading ? '—' : governorCount.toLocaleString()}</p>
          <p className="dashboard-stat-note">Tracked identities in your roster.</p>
        </article>

        <article className="dashboard-stat-card tone-info">
          <div className="dashboard-stat-head">
            <span>Events</span>
            <Library size={16} />
          </div>
          <p className="dashboard-stat-value">{loading ? '—' : events.length.toLocaleString()}</p>
          <p className="dashboard-stat-note">Saved checkpoints for comparison and trends.</p>
        </article>

        <article className="dashboard-stat-card tone-good">
          <div className="dashboard-stat-head">
            <span>Snapshots</span>
            <FileBox size={16} />
          </div>
          <p className="dashboard-stat-value">{loading ? '—' : totalSnapshots.toLocaleString()}</p>
          <p className="dashboard-stat-note">Total ingested profile rows.</p>
        </article>

        <article className="dashboard-stat-card tone-warn">
          <div className="dashboard-stat-head">
            <span>Current Week</span>
            <CalendarClock size={16} />
          </div>
          <p className="dashboard-stat-value">{loading ? '—' : weeklyEvent?.weekKey || '—'}</p>
          <p className="dashboard-stat-note">{loading ? 'Preparing weekly window…' : weeklyEvent?.name || 'No active week yet.'}</p>
        </article>
      </section>

      <section className="dashboard-actions-grid">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className={`dashboard-action-card ${action.tone === 'primary' ? 'is-primary' : ''}`}
            >
              <div className="dashboard-action-icon">
                <Icon size={16} />
              </div>
              <div className="dashboard-action-copy">
                <strong>{action.title}</strong>
                <p>{action.description}</p>
              </div>
              <ArrowUpRight size={14} className="dashboard-action-arrow" />
            </Link>
          );
        })}
      </section>

      <section className="dashboard-card dashboard-weekly-card">
        <header className="dashboard-card-head">
          <div>
            <h2>Weekly Pulse</h2>
            <p>
              {weeklyActivity
                ? `${weeklyActivity.summary.membersTracked} members • ${weeklyActivity.event.name}`
                : 'Waiting for weekly activity data.'}
            </p>
          </div>
          <Link href="/activity" className="btn btn-secondary btn-sm">
            <Activity size={14} /> Open Activity
          </Link>
        </header>

        {!weeklyActivity ? (
          loading ? (
            <SkeletonSet rows={3} />
          ) : (
            <EmptyState
              title="No weekly activity yet"
              description="Upload profile and ranking screenshots to start tracking this week."
              action={
                <Link href="/upload" className="btn btn-primary btn-sm">
                  <Database size={14} /> Start Ingestion
                </Link>
              }
            />
          )
        ) : (
          <>
            <div className="dashboard-alliance-grid">
              {alliancePulse.map((alliance) => (
                <article key={alliance.allianceTag} className="dashboard-alliance-card">
                  <div className="dashboard-alliance-head">
                    <strong>{alliance.allianceLabel}</strong>
                    <StatusPill
                      label={`${alliance.passCount}/${alliance.members} pass`}
                      tone={alliance.passRate >= 70 ? 'good' : alliance.passRate >= 45 ? 'warn' : 'bad'}
                    />
                  </div>
                  <div className="dashboard-meter" aria-hidden="true">
                    <span style={{ width: `${Math.max(8, alliance.passRate)}%` }} />
                  </div>
                  <div className="dashboard-alliance-meta">
                    <span>Pass Rate</span>
                    <strong>{alliance.passRate}%</strong>
                  </div>
                </article>
              ))}
            </div>

            <div className="dashboard-leaders-grid">
              <article className="dashboard-leader-card">
                <h3>Top Contribution</h3>
                {topContributionRows.length === 0 ? (
                  <p className="dashboard-muted">No contribution rows yet.</p>
                ) : (
                  <ul>
                    {topContributionRows.map((row) => (
                      <li key={`c-${row.governorDbId}`}>
                        <span>{row.governorName}</span>
                        <strong>{Number(row.contributionPoints).toLocaleString()}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="dashboard-leader-card">
                <h3>Top Power Growth</h3>
                {topPowerGrowthRows.length === 0 ? (
                  <p className="dashboard-muted">Baseline data is still building.</p>
                ) : (
                  <ul>
                    {topPowerGrowthRows.map((row) => (
                      <li key={`p-${row.governorDbId}`}>
                        <span>{row.governorName}</span>
                        <strong>{row.powerGrowth != null ? Number(row.powerGrowth).toLocaleString() : 'N/A'}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </div>

            <div className="dashboard-issue-strip">
              <span>Unlinked: {weeklyActivity.summary.unresolvedIdentityCount}</span>
              <span>No Power Baseline: {weeklyActivity.summary.noPowerBaselineCount}</span>
              <span>No KP Baseline: {weeklyActivity.summary.noKillPointsBaselineCount}</span>
            </div>
          </>
        )}
      </section>

      <section className="dashboard-card dashboard-events-card">
        <header className="dashboard-card-head">
          <div>
            <h2>Recent Events</h2>
            <p>Latest checkpoints ready for compare and insights.</p>
          </div>
          <Link href="/events" className="btn btn-secondary btn-sm">
            <CalendarClock size={14} /> Manage
          </Link>
        </header>

        {loading ? (
          <SkeletonSet rows={4} />
        ) : events.length === 0 ? (
          <EmptyState
            title="No events yet"
            description="Create an event and upload screenshots to start analytics."
            action={
              <Link href="/upload" className="btn btn-primary btn-sm">
                <Database size={14} /> Start Ingestion
              </Link>
            }
          />
        ) : (
          <div className="dashboard-events-list">
            {events.slice(0, 8).map((event) => (
              <article key={event.id} className="dashboard-event-row">
                <div className="dashboard-event-main">
                  <strong>{event.name}</strong>
                  <div className="dashboard-event-meta">
                    <StatusPill label={EVENT_TYPE_LABELS[event.eventType] || event.eventType} tone="info" />
                    <span>{event.snapshotCount} governors</span>
                    <span>{formatDate(event.createdAt)}</span>
                    {event.snapshotCount < 20 ? <ShieldAlert size={14} color="#f5b54a" /> : null}
                  </div>
                </div>
                <div className="dashboard-event-actions">
                  <Link href={`/events/${event.id}`} className="btn btn-secondary btn-sm">
                    View
                  </Link>
                  <Link href={`/compare?eventA=${event.id}`} className="btn btn-secondary btn-sm">
                    Compare
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
