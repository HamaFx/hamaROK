'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Castle,
  CalendarClock,
  Crown,
  Database,
  FileBox,
  Flame,
  Gauge,
  Medal,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Swords,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  Rocket,
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

interface WeeklyEventListItem {
  id: string;
  name: string;
  weekKey: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isClosed: boolean;
  rankingSnapshotCount: number;
  snapshotCount: number;
}

interface WeeklyActivityRow {
  governorDbId: string;
  governorName: string;
  allianceLabel: string;
  contributionPoints: string;
  fortDestroying: string;
  powerGrowth: string | null;
  killPointsGrowth: string | null;
}

interface WeeklyAllianceSummary {
  allianceTag: string;
  allianceLabel: string;
  members: number;
  passCount: number;
  failCount: number;
  partialCount?: number;
  noStandardCount?: number;
}

interface WeeklyActivityResponse {
  event: {
    id: string;
    weekKey: string | null;
    name: string;
  };
  rows: WeeklyActivityRow[];
  summary: {
    membersTracked: number;
    unresolvedIdentityCount: number;
    noPowerBaselineCount: number;
    noKillPointsBaselineCount: number;
    allianceSummary: WeeklyAllianceSummary[];
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

function formatWeekShort(weekKey: string) {
  const match = weekKey.match(/^(\d{4})-W(\d{2})$/i);
  if (!match) return weekKey;
  return `W${match[2]}`;
}

function normalizedRatio(value: bigint, max: bigint) {
  if (max <= BigInt(0) || value <= BigInt(0)) return 0;
  return Number((value * BigInt(1000)) / max) / 1000;
}

function buildPerformanceScores(rows: WeeklyActivityRow[]) {
  if (rows.length === 0) return [];

  const maxContribution = rows.reduce((max, row) => {
    const value = toSafeBigInt(row.contributionPoints);
    return value > max ? value : max;
  }, BigInt(0));
  const maxPowerGrowth = rows.reduce((max, row) => {
    const value = toSafeBigInt(row.powerGrowth);
    return value > max ? value : max;
  }, BigInt(0));
  const maxFort = rows.reduce((max, row) => {
    const value = toSafeBigInt(row.fortDestroying);
    return value > max ? value : max;
  }, BigInt(0));
  const maxKillPoints = rows.reduce((max, row) => {
    const value = toSafeBigInt(row.killPointsGrowth);
    return value > max ? value : max;
  }, BigInt(0));

  return rows.map((row) => {
    const contribution = toSafeBigInt(row.contributionPoints);
    const powerGrowth = toSafeBigInt(row.powerGrowth);
    const fort = toSafeBigInt(row.fortDestroying);
    const killPoints = toSafeBigInt(row.killPointsGrowth);

    const score =
      normalizedRatio(contribution, maxContribution) * 45 +
      normalizedRatio(powerGrowth, maxPowerGrowth) * 30 +
      normalizedRatio(fort, maxFort) * 15 +
      normalizedRatio(killPoints, maxKillPoints) * 10;

    return {
      row,
      score,
    };
  });
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
  const [recentWeeklyReports, setRecentWeeklyReports] = useState<
    Array<{ weekKey: string; report: WeeklyActivityResponse }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      if (!workspaceReady) {
        setEvents([]);
        setGovernorCount(0);
        setWeeklyEvent(null);
        setWeeklyActivity(null);
        setRecentWeeklyReports([]);
        setLoading(sessionLoading);
        return;
      }

      try {
        setLoading(true);
        const [evRes, govRes, weeklyRes, weeksRes] = await Promise.all([
          fetch(`/api/v2/events?${new URLSearchParams({ workspaceId, limit: '50' }).toString()}`, {
            headers: { 'x-access-token': accessToken },
          }),
          fetch(`/api/v2/governors?${new URLSearchParams({ workspaceId, limit: '1' }).toString()}`, {
            headers: { 'x-access-token': accessToken },
          }),
          fetch(`/api/v2/events/weekly?${new URLSearchParams({ workspaceId, autoCreate: 'true' }).toString()}`, {
            headers: { 'x-access-token': accessToken },
          }),
          fetch(`/api/v2/activity/weeks?${new URLSearchParams({ workspaceId, limit: '4' }).toString()}`, {
            headers: { 'x-access-token': accessToken },
          }),
        ]);

        const [evPayload, govPayload, weeklyPayload, weeksPayload] = await Promise.all([
          evRes.json(),
          govRes.json(),
          weeklyRes.json(),
          weeksRes.json(),
        ]);

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

        let resolvedWeeklyInfo: WeeklyEventInfo | null = null;
        if (weeklyRes.ok && weeklyPayload?.data?.id) {
          resolvedWeeklyInfo = {
            id: weeklyPayload.data.id,
            name: weeklyPayload.data.name,
            weekKey: weeklyPayload.data.weekKey || null,
            startsAt: weeklyPayload.data.startsAt || null,
          };
          setWeeklyEvent(resolvedWeeklyInfo);
        } else {
          setWeeklyEvent(null);
        }

        const activityRes = await fetch(
          `/api/v2/activity/weekly?workspaceId=${encodeURIComponent(workspaceId)}${
            resolvedWeeklyInfo?.weekKey ? `&weekKey=${encodeURIComponent(resolvedWeeklyInfo.weekKey)}` : ''
          }`,
          {
            headers: { 'x-access-token': accessToken },
          }
        );
        const activityPayload = await activityRes.json();
        const resolvedWeeklyActivity =
          activityRes.ok && activityPayload?.data ? (activityPayload.data as WeeklyActivityResponse) : null;
        setWeeklyActivity(resolvedWeeklyActivity);

        const weekItems =
          weeksRes.ok && Array.isArray(weeksPayload?.data)
            ? (weeksPayload.data as WeeklyEventListItem[])
            : [];

        const weekKeys = Array.from(
          new Set(
            [resolvedWeeklyInfo?.weekKey || '', ...weekItems.map((week) => week.weekKey || '')].filter(
              Boolean
            ) as string[]
          )
        ).slice(0, 4);

        if (weekKeys.length === 0) {
          setRecentWeeklyReports([]);
          return;
        }

        const weeklyReports = await Promise.allSettled(
          weekKeys.map(async (weekKey) => {
            if (resolvedWeeklyActivity && resolvedWeeklyActivity.event.weekKey === weekKey) {
              return { weekKey, report: resolvedWeeklyActivity };
            }

            const response = await fetch(
              `/api/v2/activity/weekly?workspaceId=${encodeURIComponent(workspaceId)}&weekKey=${encodeURIComponent(
                weekKey
              )}`,
              {
                headers: { 'x-access-token': accessToken },
              }
            );
            const payload = await response.json();
            if (!response.ok || !payload?.data) return null;

            return {
              weekKey,
              report: payload.data as WeeklyActivityResponse,
            };
          })
        );

        const resolvedReports = weeklyReports
          .filter((result): result is PromiseFulfilledResult<{ weekKey: string; report: WeeklyActivityResponse } | null> => result.status === 'fulfilled')
          .map((result) => result.value)
          .filter((result): result is { weekKey: string; report: WeeklyActivityResponse } => result != null)
          .sort((a, b) => b.weekKey.localeCompare(a.weekKey));

        setRecentWeeklyReports(resolvedReports);
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

  const allianceMomentum = useMemo(() => {
    if (recentWeeklyReports.length === 0) return [];

    const chronological = [...recentWeeklyReports].sort((a, b) => a.weekKey.localeCompare(b.weekKey));
    const latestReport = chronological[chronological.length - 1]?.report;
    const preferredLabels = latestReport?.summary.allianceSummary.map((alliance) => alliance.allianceLabel) || [];
    const labels = Array.from(
      new Set([
        ...preferredLabels,
        ...chronological.flatMap((entry) => entry.report.summary.allianceSummary.map((alliance) => alliance.allianceLabel)),
      ])
    );

    return labels
      .map((allianceLabel) => {
        const points = chronological.map((entry) => {
          const alliance = entry.report.summary.allianceSummary.find((item) => item.allianceLabel === allianceLabel);
          const members = alliance?.members ?? 0;
          const passCount = alliance?.passCount ?? 0;
          const passRate = members > 0 ? Math.round((passCount / members) * 100) : 0;
          return {
            weekKey: entry.weekKey,
            passRate,
            members,
          };
        });
        const latestPassRate = points[points.length - 1]?.passRate ?? 0;
        const firstPassRate = points[0]?.passRate ?? 0;
        const trend = latestPassRate - firstPassRate;
        const average = points.length > 0 ? Math.round(points.reduce((sum, point) => sum + point.passRate, 0) / points.length) : 0;

        return {
          allianceLabel,
          points,
          latestPassRate,
          trend,
          average,
        };
      })
      .sort((a, b) => b.latestPassRate - a.latestPassRate || b.average - a.average);
  }, [recentWeeklyReports]);

  const weeklyMvp = useMemo(() => {
    if (!weeklyActivity) return null;
    const scored = buildPerformanceScores(weeklyActivity.rows).sort((a, b) => b.score - a.score);
    return scored[0] || null;
  }, [weeklyActivity]);

  const weekMovement = useMemo(() => {
    if (recentWeeklyReports.length < 2) return null;

    const sorted = [...recentWeeklyReports].sort((a, b) => b.weekKey.localeCompare(a.weekKey));
    const current = sorted[0];
    const previous = sorted[1];
    if (!current || !previous) return null;

    const currentScores = buildPerformanceScores(current.report.rows);
    const previousScores = buildPerformanceScores(previous.report.rows);
    const previousByGovernor = new Map(previousScores.map((entry) => [entry.row.governorDbId, entry]));

    const movementRows = currentScores
      .map((entry) => {
        const prev = previousByGovernor.get(entry.row.governorDbId);
        if (!prev) return null;
        return {
          governorDbId: entry.row.governorDbId,
          governorName: entry.row.governorName,
          allianceLabel: entry.row.allianceLabel,
          delta: Number((entry.score - prev.score).toFixed(1)),
          score: Number(entry.score.toFixed(1)),
        };
      })
      .filter((entry): entry is { governorDbId: string; governorName: string; allianceLabel: string; delta: number; score: number } => entry != null);

    const risers = [...movementRows]
      .filter((entry) => entry.delta > 0)
      .sort((a, b) => b.delta - a.delta || b.score - a.score)
      .slice(0, 3);
    const fallers = [...movementRows]
      .filter((entry) => entry.delta < 0)
      .sort((a, b) => a.delta - b.delta || a.score - b.score)
      .slice(0, 3);

    return {
      currentWeekKey: current.weekKey,
      previousWeekKey: previous.weekKey,
      comparedCount: movementRows.length,
      risers,
      fallers,
    };
  }, [recentWeeklyReports]);

  return (
    <div className="page-container dashboard-shell">
      <section className="dashboard-hero-card animate-fade-in-up">
        <div className="dashboard-hero-main">
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
        <div className="dashboard-hero-cta">
          <Link href="/activity" className="btn btn-primary btn-sm">
            <Activity size={14} /> Open Weekly Activity
          </Link>
          <Link href="/rankings" className="btn btn-secondary btn-sm">
            <Trophy size={14} /> Open Rankings
          </Link>
        </div>
      </section>

      <section className="dashboard-mosaic-grid">
        <article className="dashboard-mosaic-card square tone-cobalt">
          <div className="dashboard-mosaic-head">
            <span className="dashboard-mosaic-logo logo-cobalt">
              <Users size={15} />
            </span>
            <span>Total Governors</span>
          </div>
          <p className="dashboard-mosaic-value">{loading ? '—' : governorCount.toLocaleString()}</p>
          <p className="dashboard-mosaic-note">Roster members linked in kingdom tracking.</p>
        </article>

        <article className="dashboard-mosaic-card square tone-emerald">
          <div className="dashboard-mosaic-head">
            <span className="dashboard-mosaic-logo logo-emerald">
              <ShieldCheck size={15} />
            </span>
            <span>Players This Week</span>
          </div>
          <p className="dashboard-mosaic-value">
            {loading ? '—' : (weeklyActivity?.summary.membersTracked ?? 0).toLocaleString()}
          </p>
          <p className="dashboard-mosaic-note">Scored players in the active weekly cycle.</p>
        </article>

        <article className="dashboard-mosaic-card square tone-gold">
          <div className="dashboard-mosaic-head">
            <span className="dashboard-mosaic-logo logo-gold">
              <Gauge size={15} />
            </span>
            <span>Alliance Pass Rate</span>
          </div>
          <p className="dashboard-mosaic-value">{loading ? '—' : `${weeklyInsights?.overallPassRate ?? 0}%`}</p>
          <p className="dashboard-mosaic-note">
            {loading
              ? 'Calculating weekly scoring...'
              : `${weeklyInsights?.totalPass ?? 0} pass / ${weeklyInsights?.totalMembers ?? 0} tracked`}
          </p>
        </article>

        <article className="dashboard-mosaic-card square tone-violet">
          <div className="dashboard-mosaic-head">
            <span className="dashboard-mosaic-logo logo-violet">
              <FileBox size={15} />
            </span>
            <span>Total Snapshots</span>
          </div>
          <p className="dashboard-mosaic-value">{loading ? '—' : totalSnapshots.toLocaleString()}</p>
          <p className="dashboard-mosaic-note">Profile uploads stored across all event checkpoints.</p>
        </article>

        <article className="dashboard-mosaic-card wide tone-royal">
          <div className="dashboard-mosaic-head">
            <span className="dashboard-mosaic-logo logo-royal">
              <Crown size={15} />
            </span>
            <span>Top Alliance</span>
          </div>
          <p className="dashboard-mosaic-value">
            {weeklyInsights?.topAlliance ? weeklyInsights.topAlliance.allianceLabel : '—'}
          </p>
          <p className="dashboard-mosaic-note">
            {weeklyInsights?.topAlliance
              ? `${weeklyInsights.topAlliance.passRate}% pass • ${weeklyInsights.topAlliance.passCount}/${weeklyInsights.topAlliance.members} members`
              : 'Waiting for scored alliance activity.'}
          </p>
          <div className="dashboard-mosaic-mini">
            <span>Alliances tracked: {alliancePulse.length}</span>
          </div>
        </article>

        <article className="dashboard-mosaic-card wide tone-platinum">
          <div className="dashboard-mosaic-head">
            <span className="dashboard-mosaic-logo logo-platinum">
              <Medal size={15} />
            </span>
            <span>Top Contributor</span>
          </div>
          <p className="dashboard-mosaic-value">
            {weeklyInsights?.topContributor ? weeklyInsights.topContributor.governorName : '—'}
          </p>
          <p className="dashboard-mosaic-note">
            {weeklyInsights?.topContributor
              ? `${formatBigInt(toSafeBigInt(weeklyInsights.topContributor.contributionPoints))} contribution points`
              : 'No contribution rows available yet.'}
          </p>
          <div className="dashboard-mosaic-mini">
            <span>
              Alliance: {weeklyInsights?.topContributor ? weeklyInsights.topContributor.allianceLabel : '—'}
            </span>
          </div>
        </article>

        <article className="dashboard-mosaic-card wide tone-flame">
          <div className="dashboard-mosaic-head">
            <span className="dashboard-mosaic-logo logo-flame">
              <Flame size={15} />
            </span>
            <span>Top Power Growth</span>
          </div>
          <p className="dashboard-mosaic-value">
            {weeklyInsights?.topPowerGrowth ? weeklyInsights.topPowerGrowth.governorName : '—'}
          </p>
          <p className="dashboard-mosaic-note">
            {weeklyInsights?.topPowerGrowth?.powerGrowth
              ? `${formatBigInt(toSafeBigInt(weeklyInsights.topPowerGrowth.powerGrowth))} weekly power gained`
              : 'Baseline data is still building for this week.'}
          </p>
          <div className="dashboard-mosaic-mini">
            <span>
              Alliance: {weeklyInsights?.topPowerGrowth ? weeklyInsights.topPowerGrowth.allianceLabel : '—'}
            </span>
          </div>
        </article>

        <article className="dashboard-mosaic-card wide tone-data">
          <div className="dashboard-mosaic-head">
            <span className="dashboard-mosaic-logo logo-data">
              <Database size={15} />
            </span>
            <span>Data Readiness</span>
          </div>
          <p className="dashboard-mosaic-value">
            {weeklyInsights ? `${weeklyInsights.baselineCoverage}%` : '—'}
          </p>
          <p className="dashboard-mosaic-note">
            {weeklyInsights ? 'Power baseline coverage for progressive weekly scoring.' : 'Waiting for weekly activity data.'}
          </p>
          <div className="dashboard-mosaic-mini">
            <span>
              Baseline-ready: {weeklyInsights?.powerBaselineReadyCount ?? 0}/{weeklyActivity?.rows.length ?? 0}
            </span>
            <span>Unlinked: {weeklyActivity?.summary.unresolvedIdentityCount ?? 0}</span>
            <span>Tracked events: {events.length}</span>
          </div>
        </article>
      </section>

      <section className="dashboard-advanced-grid">
        <article className="dashboard-card dashboard-momentum-card">
          <header className="dashboard-card-head">
            <div>
              <h2 className="dashboard-heading-icon">
                <Castle size={15} /> Alliance Momentum
              </h2>
              <p>Pass-rate trend for the last {Math.max(recentWeeklyReports.length, 1)} tracked weeks.</p>
            </div>
            <StatusPill label="Last 4 Weeks" tone="info" />
          </header>
          {allianceMomentum.length === 0 ? (
            <p className="dashboard-muted">Weekly alliance history will appear after at least one scored week.</p>
          ) : (
            <div className="dashboard-momentum-stack">
              {allianceMomentum.slice(0, 3).map((alliance) => (
                <article key={alliance.allianceLabel} className="dashboard-momentum-row">
                  <div className="dashboard-momentum-head">
                    <div>
                      <strong>{alliance.allianceLabel}</strong>
                      <span>
                        {alliance.trend >= 0 ? '+' : ''}
                        {alliance.trend}% vs oldest week
                      </span>
                    </div>
                    <StatusPill
                      label={`${alliance.latestPassRate}%`}
                      tone={
                        alliance.latestPassRate >= 70
                          ? 'good'
                          : alliance.latestPassRate >= 45
                            ? 'warn'
                            : 'bad'
                      }
                    />
                  </div>
                  <div className="dashboard-mini-chart">
                    {alliance.points.map((point) => (
                      <div key={`${alliance.allianceLabel}-${point.weekKey}`} className="dashboard-mini-chart-col">
                        <span
                          className="dashboard-mini-chart-bar"
                          style={{ height: `${point.passRate === 0 ? 6 : Math.max(12, point.passRate)}%` }}
                          title={`${point.weekKey}: ${point.passRate}%`}
                        />
                        <small>{formatWeekShort(point.weekKey)}</small>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="dashboard-card dashboard-movers-card">
          <header className="dashboard-card-head">
            <div>
              <h2 className="dashboard-heading-icon">
                <Rocket size={15} /> Top Risers and Fallers
              </h2>
              <p>
                {weekMovement
                  ? `${formatWeekShort(weekMovement.previousWeekKey)} -> ${formatWeekShort(weekMovement.currentWeekKey)}`
                  : 'Week-over-week movement appears when at least 2 weeks are available.'}
              </p>
            </div>
            {weekMovement ? <StatusPill label={`${weekMovement.comparedCount} compared`} tone="info" /> : null}
          </header>

          {!weekMovement ? (
            <p className="dashboard-muted">Upload and score a second weekly cycle to unlock movement tracking.</p>
          ) : (
            <div className="dashboard-movers-grid">
              <article className="dashboard-movers-lane rise">
                <h3>
                  <TrendingUp size={14} /> Top Risers
                </h3>
                {weekMovement.risers.length === 0 ? (
                  <p className="dashboard-muted">No positive movement detected in this comparison.</p>
                ) : (
                  <ul className="dashboard-mover-list">
                    {weekMovement.risers.map((row) => (
                      <li key={`rise-${row.governorDbId}`}>
                        <div className="dashboard-player-meta">
                          <span className="dashboard-player-name">{row.governorName}</span>
                        </div>
                        <strong className="dashboard-mover-delta good">+{row.delta.toFixed(1)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="dashboard-movers-lane fall">
                <h3>
                  <TrendingDown size={14} /> Top Fallers
                </h3>
                {weekMovement.fallers.length === 0 ? (
                  <p className="dashboard-muted">No negative movement detected in this comparison.</p>
                ) : (
                  <ul className="dashboard-mover-list">
                    {weekMovement.fallers.map((row) => (
                      <li key={`fall-${row.governorDbId}`}>
                        <div className="dashboard-player-meta">
                          <span className="dashboard-player-name">{row.governorName}</span>
                        </div>
                        <strong className="dashboard-mover-delta bad">{row.delta.toFixed(1)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </div>
          )}
        </article>

        <article className="dashboard-card dashboard-mvp-card">
          <header className="dashboard-card-head">
            <div>
              <h2 className="dashboard-heading-icon">
                <Star size={15} /> Weekly MVP
              </h2>
              <p>Weighted score: contribution 45%, power growth 30%, fort 15%, kill points growth 10%.</p>
            </div>
            <StatusPill label="Performance Blend" tone="good" />
          </header>

          {!weeklyMvp ? (
            <p className="dashboard-muted">MVP appears once weekly activity rows are available.</p>
          ) : (
            <div className="dashboard-mvp-stack">
              <div className="dashboard-mvp-hero">
                <div className="dashboard-mvp-icon">
                  <Sparkles size={16} />
                </div>
                <div className="dashboard-mvp-copy">
                  <strong>{weeklyMvp.row.governorName}</strong>
                  <span>{weeklyMvp.row.allianceLabel}</span>
                </div>
                <p className="dashboard-mvp-score">{weeklyMvp.score.toFixed(1)} pts</p>
              </div>
              <div className="dashboard-mvp-metrics">
                <div>
                  <span>Contribution</span>
                  <strong>{formatBigInt(toSafeBigInt(weeklyMvp.row.contributionPoints))}</strong>
                </div>
                <div>
                  <span>Power Growth</span>
                  <strong>
                    {weeklyMvp.row.powerGrowth != null ? formatBigInt(toSafeBigInt(weeklyMvp.row.powerGrowth)) : 'N/A'}
                  </strong>
                </div>
                <div>
                  <span>Fort Destroying</span>
                  <strong>{formatBigInt(toSafeBigInt(weeklyMvp.row.fortDestroying))}</strong>
                </div>
                <div>
                  <span>KP Growth</span>
                  <strong>
                    {weeklyMvp.row.killPointsGrowth != null
                      ? formatBigInt(toSafeBigInt(weeklyMvp.row.killPointsGrowth))
                      : 'N/A'}
                  </strong>
                </div>
              </div>
            </div>
          )}
        </article>
      </section>

      <section className="dashboard-card dashboard-weekly-card">
        <header className="dashboard-card-head">
          <div>
            <h2 className="dashboard-heading-icon">
              <Swords size={15} /> Alliance and Player Breakdown
            </h2>
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
            <h2 className="dashboard-heading-icon">
              <CalendarClock size={15} /> Recent Events
            </h2>
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
