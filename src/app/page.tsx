'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  CalendarClock,
  Database,
  FileBox,
  Library,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Trophy,
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

function toSafeBigInt(value: string | null | undefined) {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
}

function formatBigInt(value: bigint) {
  const asNumber = Number(value);
  if (Number.isSafeInteger(asNumber)) return asNumber.toLocaleString();
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
      .slice(0, 5);
  }, [weeklyActivity?.rows]);

  const topPowerGrowthRows = useMemo(() => {
    return [...(weeklyActivity?.rows || [])]
      .filter((row) => row.powerGrowth != null)
      .sort((a, b) => {
        const diff = toSafeBigInt(b.powerGrowth) - toSafeBigInt(a.powerGrowth);
        if (diff === BigInt(0)) return 0;
        return diff > BigInt(0) ? 1 : -1;
      })
      .slice(0, 5);
  }, [weeklyActivity?.rows]);

  const alliancePulse = useMemo(() => {
    return [...(weeklyActivity?.summary.allianceSummary || [])]
      .map((alliance) => {
        const passRate = alliance.members > 0 ? Math.round((alliance.passCount / alliance.members) * 100) : 0;
        return {
          ...alliance,
          passRate,
        };
      })
      .sort((a, b) => b.passRate - a.passRate || b.passCount - a.passCount || b.members - a.members);
  }, [weeklyActivity?.summary.allianceSummary]);

  const weeklyInsights = useMemo(() => {
    if (!weeklyActivity) return null;

    const totalMembers = alliancePulse.reduce((sum, alliance) => sum + alliance.members, 0);
    const totalPass = alliancePulse.reduce((sum, alliance) => sum + alliance.passCount, 0);
    const totalFail = alliancePulse.reduce((sum, alliance) => sum + alliance.failCount, 0);
    const overallPassRate = totalMembers > 0 ? Math.round((totalPass / totalMembers) * 100) : 0;

    const totalContribution = weeklyActivity.rows.reduce(
      (sum, row) => sum + toSafeBigInt(row.contributionPoints),
      BigInt(0)
    );
    const totalPowerGrowth = weeklyActivity.rows.reduce((sum, row) => {
      if (!row.powerGrowth) return sum;
      return sum + toSafeBigInt(row.powerGrowth);
    }, BigInt(0));

    const powerBaselineReadyCount = weeklyActivity.rows.filter((row) => row.powerGrowth != null).length;
    const baselineCoverage =
      weeklyActivity.rows.length > 0
        ? Math.round((powerBaselineReadyCount / weeklyActivity.rows.length) * 100)
        : 0;

    return {
      totalMembers,
      totalPass,
      totalFail,
      overallPassRate,
      totalContribution,
      totalPowerGrowth,
      powerBaselineReadyCount,
      baselineCoverage,
      topAlliance: alliancePulse[0] || null,
      topContributor: topContributionRows[0] || null,
      topPowerGrowth: topPowerGrowthRows[0] || null,
    };
  }, [weeklyActivity, alliancePulse, topContributionRows, topPowerGrowthRows]);

  return (
    <div className="page-container dashboard-shell">
      <section className="dashboard-command-card animate-fade-in-up">
        <div className="dashboard-command-main">
          <p className="dashboard-eyebrow">Kingdom Performance</p>
          <h1>Alliance and Player Overview</h1>
          <p>
            A weekly snapshot of alliance results, player momentum, and data quality in one place.
          </p>
          <div className="dashboard-chip-row">
            <span className="dashboard-chip">
              <CalendarClock size={13} /> Week {weeklyEvent?.weekKey || '—'}
            </span>
            <span className="dashboard-chip">
              <ShieldCheck size={13} /> {alliancePulse.length} alliances
            </span>
            <span className="dashboard-chip">
              <Users size={13} /> {weeklyActivity?.summary.membersTracked ?? 0} players tracked
            </span>
          </div>
        </div>
        <div className="dashboard-command-cta">
          <Link href="/activity" className="btn btn-primary btn-sm">
            <Activity size={14} /> Open Weekly Activity
          </Link>
          <Link href="/rankings" className="btn btn-secondary btn-sm">
            <Trophy size={14} /> Open Rankings
          </Link>
        </div>
      </section>

      <section className="dashboard-stats-grid">
        <article className="dashboard-stat-card tone-neutral">
          <div className="dashboard-stat-head">
            <span>Total Governors</span>
            <Users size={16} />
          </div>
          <p className="dashboard-stat-value">{loading ? '—' : governorCount.toLocaleString()}</p>
          <p className="dashboard-stat-note">Roster members linked in the kingdom database.</p>
        </article>

        <article className="dashboard-stat-card tone-info">
          <div className="dashboard-stat-head">
            <span>Players This Week</span>
            <ShieldCheck size={16} />
          </div>
          <p className="dashboard-stat-value">{loading ? '—' : (weeklyActivity?.summary.membersTracked ?? 0).toLocaleString()}</p>
          <p className="dashboard-stat-note">Players included in current weekly scoring.</p>
        </article>

        <article className="dashboard-stat-card tone-good">
          <div className="dashboard-stat-head">
            <span>Alliance Pass Rate</span>
            <TrendingUp size={16} />
          </div>
          <p className="dashboard-stat-value">
            {loading ? '—' : `${weeklyInsights?.overallPassRate ?? 0}%`}
          </p>
          <p className="dashboard-stat-note">
            {loading
              ? 'Calculating weekly rate…'
              : `${weeklyInsights?.totalPass ?? 0} pass / ${weeklyInsights?.totalMembers ?? 0} tracked`}
          </p>
        </article>

        <article className="dashboard-stat-card tone-warn">
          <div className="dashboard-stat-head">
            <span>Total Snapshots</span>
            <FileBox size={16} />
          </div>
          <p className="dashboard-stat-value">{loading ? '—' : totalSnapshots.toLocaleString()}</p>
          <p className="dashboard-stat-note">All ingested profile snapshots across events.</p>
        </article>
      </section>

      <section className="dashboard-highlights-grid">
        <article className="dashboard-highlight-card">
          <div className="dashboard-highlight-head">
            <ShieldCheck size={14} />
            <span>Top Alliance</span>
          </div>
          <p className="dashboard-highlight-value">
            {weeklyInsights?.topAlliance ? weeklyInsights.topAlliance.allianceLabel : '—'}
          </p>
          <p className="dashboard-highlight-note">
            {weeklyInsights?.topAlliance
              ? `${weeklyInsights.topAlliance.passRate}% pass • ${weeklyInsights.topAlliance.passCount}/${weeklyInsights.topAlliance.members}`
              : 'Waiting for weekly activity data.'}
          </p>
        </article>

        <article className="dashboard-highlight-card">
          <div className="dashboard-highlight-head">
            <Trophy size={14} />
            <span>Top Contributor</span>
          </div>
          <p className="dashboard-highlight-value">
            {weeklyInsights?.topContributor ? weeklyInsights.topContributor.governorName : '—'}
          </p>
          <p className="dashboard-highlight-note">
            {weeklyInsights?.topContributor
              ? `${Number(weeklyInsights.topContributor.contributionPoints).toLocaleString()} contribution points`
              : 'No contribution rows yet.'}
          </p>
        </article>

        <article className="dashboard-highlight-card">
          <div className="dashboard-highlight-head">
            <TrendingUp size={14} />
            <span>Top Power Growth</span>
          </div>
          <p className="dashboard-highlight-value">
            {weeklyInsights?.topPowerGrowth ? weeklyInsights.topPowerGrowth.governorName : '—'}
          </p>
          <p className="dashboard-highlight-note">
            {weeklyInsights?.topPowerGrowth?.powerGrowth
              ? `${Number(weeklyInsights.topPowerGrowth.powerGrowth).toLocaleString()} power`
              : 'Baseline data is still building.'}
          </p>
        </article>

        <article className="dashboard-highlight-card">
          <div className="dashboard-highlight-head">
            <Library size={14} />
            <span>Tracked Events</span>
          </div>
          <p className="dashboard-highlight-value">{events.length.toLocaleString()}</p>
          <p className="dashboard-highlight-note">Recent event checkpoints available for comparison.</p>
        </article>

        <article className="dashboard-highlight-card">
          <div className="dashboard-highlight-head">
            <Database size={14} />
            <span>Weekly Contribution</span>
          </div>
          <p className="dashboard-highlight-value">
            {weeklyInsights ? formatBigInt(weeklyInsights.totalContribution) : '—'}
          </p>
          <p className="dashboard-highlight-note">Combined contribution points from tracked players.</p>
        </article>

        <article className="dashboard-highlight-card">
          <div className="dashboard-highlight-head">
            <ShieldAlert size={14} />
            <span>Power Baseline Coverage</span>
          </div>
          <p className="dashboard-highlight-value">
            {weeklyInsights ? `${weeklyInsights.baselineCoverage}%` : '—'}
          </p>
          <p className="dashboard-highlight-note">
            {weeklyInsights
              ? `${weeklyInsights.powerBaselineReadyCount}/${weeklyActivity?.rows.length || 0} players baseline-ready`
              : 'Waiting for weekly activity data.'}
          </p>
        </article>
      </section>

      <section className="dashboard-card dashboard-weekly-card">
        <header className="dashboard-card-head">
          <div>
            <h2>Alliance and Player Breakdown</h2>
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
              {alliancePulse.map((alliance, index) => (
                <article key={alliance.allianceTag} className="dashboard-alliance-card">
                  <div className="dashboard-alliance-head">
                    <div className="dashboard-alliance-title">
                      <span className="dashboard-alliance-rank">#{index + 1}</span>
                      <strong>{alliance.allianceLabel}</strong>
                    </div>
                    <StatusPill
                      label={`${alliance.passCount}/${alliance.members} pass`}
                      tone={alliance.passRate >= 70 ? 'good' : alliance.passRate >= 45 ? 'warn' : 'bad'}
                    />
                  </div>
                  <div className="dashboard-meter" aria-hidden="true">
                    <span style={{ width: `${Math.max(8, alliance.passRate)}%` }} />
                  </div>
                  <div className="dashboard-alliance-meta">
                    <span>{alliance.passCount} pass • {alliance.failCount} fail</span>
                    <strong>{alliance.passRate}%</strong>
                  </div>
                </article>
              ))}
            </div>

            <div className="dashboard-leaders-grid">
              <article className="dashboard-leader-card">
                <h3>Top Contribution Players</h3>
                {topContributionRows.length === 0 ? (
                  <p className="dashboard-muted">No contribution rows yet.</p>
                ) : (
                  <ul>
                    {topContributionRows.map((row, index) => (
                      <li key={`c-${row.governorDbId}`}>
                        <div className="dashboard-player-meta">
                          <span className="dashboard-player-rank">#{index + 1}</span>
                          <span className="dashboard-player-name">{row.governorName}</span>
                        </div>
                        <strong>{Number(row.contributionPoints).toLocaleString()}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="dashboard-leader-card">
                <h3>Top Power Growth Players</h3>
                {topPowerGrowthRows.length === 0 ? (
                  <p className="dashboard-muted">Baseline data is still building.</p>
                ) : (
                  <ul>
                    {topPowerGrowthRows.map((row, index) => (
                      <li key={`p-${row.governorDbId}`}>
                        <div className="dashboard-player-meta">
                          <span className="dashboard-player-rank">#{index + 1}</span>
                          <span className="dashboard-player-name">{row.governorName}</span>
                        </div>
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
              <span>Fails: {weeklyInsights?.totalFail ?? 0}</span>
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
