'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CalendarClock,
  Crown,
  ShieldCheck,
  Sparkles,
  Swords,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import {
  KpiCard,
  MetricStrip,
  PageHero,
  Panel,
  StatusPill,
} from '@/components/ui/primitives';
import { formatCompactNumber, formatMetric, formatWeekShort, toSafeBigInt } from '@/features/shared/formatters';
import type { LeaderboardMetricKey, PlayerSpotlightModel } from '@/features/shared/types';

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

type SpotlightMetric = Extract<
  LeaderboardMetricKey,
  'contribution_points' | 'fort_destroying' | 'power_growth' | 'kill_points_growth'
>;

const METRIC_OPTIONS: Array<{
  key: SpotlightMetric;
  label: string;
  short: string;
}> = [
  { key: 'contribution_points', label: 'Contribution', short: 'Contribution' },
  { key: 'fort_destroying', label: 'Fort Destroying', short: 'Fort' },
  { key: 'power_growth', label: 'Power Growth', short: 'Power' },
  { key: 'kill_points_growth', label: 'KP Growth', short: 'KP Growth' },
];

function normalizedRatio(value: bigint, max: bigint) {
  if (max <= BigInt(0) || value <= BigInt(0)) return 0;
  return Number((value * BigInt(1000)) / max) / 1000;
}

function buildPerformanceScores(rows: WeeklyActivityRow[]) {
  if (!rows.length) return [];

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

  return rows.map((row) => ({
    row,
    score:
      normalizedRatio(toSafeBigInt(row.contributionPoints), maxContribution) * 45 +
      normalizedRatio(toSafeBigInt(row.powerGrowth), maxPowerGrowth) * 30 +
      normalizedRatio(toSafeBigInt(row.fortDestroying), maxFort) * 15 +
      normalizedRatio(toSafeBigInt(row.killPointsGrowth), maxKillPoints) * 10,
  }));
}

function topRowsForMetric(metric: SpotlightMetric, rows: WeeklyActivityRow[]) {
  const sorted = [...rows].sort((a, b) => {
    const aVal =
      metric === 'contribution_points'
        ? toSafeBigInt(a.contributionPoints)
        : metric === 'fort_destroying'
          ? toSafeBigInt(a.fortDestroying)
          : metric === 'power_growth'
            ? toSafeBigInt(a.powerGrowth)
            : toSafeBigInt(a.killPointsGrowth);
    const bVal =
      metric === 'contribution_points'
        ? toSafeBigInt(b.contributionPoints)
        : metric === 'fort_destroying'
          ? toSafeBigInt(b.fortDestroying)
          : metric === 'power_growth'
            ? toSafeBigInt(b.powerGrowth)
            : toSafeBigInt(b.killPointsGrowth);
    if (aVal === bVal) return 0;
    return aVal > bVal ? -1 : 1;
  });

  return sorted.slice(0, 3);
}

export default function HomeScreen() {
  const { workspaceId, accessToken, ready, loading: sessionLoading, error: sessionError, refreshSession } = useWorkspaceSession();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [governorCount, setGovernorCount] = useState(0);
  const [weeklyEvent, setWeeklyEvent] = useState<WeeklyEventInfo | null>(null);
  const [weeklyActivity, setWeeklyActivity] = useState<WeeklyActivityResponse | null>(null);
  const [recentWeeklyReports, setRecentWeeklyReports] = useState<
    Array<{ weekKey: string; report: WeeklyActivityResponse }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [spotlightMetric, setSpotlightMetric] = useState<SpotlightMetric>('contribution_points');

  useEffect(() => {
    async function fetchData() {
      if (!ready) {
        return;
      }

      try {
        setError(null);
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

        setEvents(evRes.ok && Array.isArray(evPayload?.data) ? (evPayload.data as EventSummary[]) : []);
        setGovernorCount(govRes.ok ? Number(govPayload?.meta?.total || 0) : 0);

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
          weeksRes.ok && Array.isArray(weeksPayload?.data) ? (weeksPayload.data as WeeklyEventListItem[]) : [];
        const weekKeys = Array.from(
          new Set(
            [resolvedWeeklyInfo?.weekKey || '', ...weekItems.map((week) => week.weekKey || '')].filter(Boolean) as string[]
          )
        ).slice(0, 4);

        if (!weekKeys.length) {
          setRecentWeeklyReports([]);
          return;
        }

        const weeklyReports = await Promise.allSettled(
          weekKeys.map(async (weekKey) => {
            if (resolvedWeeklyActivity && resolvedWeeklyActivity.event.weekKey === weekKey) {
              return { weekKey, report: resolvedWeeklyActivity };
            }

            const response = await fetch(
              `/api/v2/activity/weekly?workspaceId=${encodeURIComponent(workspaceId)}&weekKey=${encodeURIComponent(weekKey)}`,
              {
                headers: { 'x-access-token': accessToken },
              }
            );
            const payload = await response.json();
            if (!response.ok || !payload?.data) return null;
            return { weekKey, report: payload.data as WeeklyActivityResponse };
          })
        );

        const resolvedReports = weeklyReports
          .filter(
            (result): result is PromiseFulfilledResult<{ weekKey: string; report: WeeklyActivityResponse } | null> =>
              result.status === 'fulfilled'
          )
          .map((result) => result.value)
          .filter((result): result is { weekKey: string; report: WeeklyActivityResponse } => Boolean(result))
          .sort((a, b) => b.weekKey.localeCompare(a.weekKey));

        setRecentWeeklyReports(resolvedReports);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to load the home dashboard.');
      }
    }

    void fetchData();
  }, [ready, workspaceId, accessToken, sessionLoading]);

  const totalSnapshots = useMemo(() => events.reduce((sum, event) => sum + event.snapshotCount, 0), [events]);

  const alliancePulse = useMemo(() => {
    return [...(weeklyActivity?.summary.allianceSummary || [])]
      .map((alliance) => ({
        ...alliance,
        passRate: alliance.members > 0 ? Math.round((alliance.passCount / alliance.members) * 100) : 0,
      }))
      .sort((a, b) => b.passRate - a.passRate || b.passCount - a.passCount || b.members - a.members);
  }, [weeklyActivity?.summary.allianceSummary]);

  const weeklyInsights = useMemo(() => {
    if (!weeklyActivity) return null;
    const totalMembers = alliancePulse.reduce((sum, alliance) => sum + alliance.members, 0);
    const totalPass = alliancePulse.reduce((sum, alliance) => sum + alliance.passCount, 0);
    const totalFail = alliancePulse.reduce((sum, alliance) => sum + alliance.failCount, 0);
    const overallPassRate = totalMembers > 0 ? Math.round((totalPass / totalMembers) * 100) : 0;
    const totalContribution = weeklyActivity.rows.reduce((sum, row) => sum + toSafeBigInt(row.contributionPoints), BigInt(0));
    const totalPowerGrowth = weeklyActivity.rows.reduce((sum, row) => sum + toSafeBigInt(row.powerGrowth), BigInt(0));
    const baselineCoverage = weeklyActivity.rows.length
      ? Math.round((weeklyActivity.rows.filter((row) => row.powerGrowth != null).length / weeklyActivity.rows.length) * 100)
      : 0;

    return {
      totalMembers,
      totalPass,
      totalFail,
      totalContribution,
      totalPowerGrowth,
      overallPassRate,
      baselineCoverage,
      topAlliance: alliancePulse[0] || null,
    };
  }, [alliancePulse, weeklyActivity]);

  const weeklyMvp = useMemo(() => {
    if (!weeklyActivity) return null;
    return buildPerformanceScores(weeklyActivity.rows).sort((a, b) => b.score - a.score)[0] || null;
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
      .filter(
        (entry): entry is { governorDbId: string; governorName: string; allianceLabel: string; delta: number; score: number } =>
          entry != null
      );

    return {
      comparedCount: movementRows.length,
      risers: [...movementRows].filter((entry) => entry.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 4),
      fallers: [...movementRows].filter((entry) => entry.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 4),
    };
  }, [recentWeeklyReports]);

  const spotlightRows = useMemo(() => topRowsForMetric(spotlightMetric, weeklyActivity?.rows || []), [spotlightMetric, weeklyActivity?.rows]);
  const podiumRows = useMemo(() => {
    const seeded: Array<WeeklyActivityRow | null> = [...spotlightRows];
    while (seeded.length < 3) seeded.push(null);
    return seeded.slice(0, 3);
  }, [spotlightRows]);

  const featuredPlayer = useMemo<PlayerSpotlightModel | null>(() => {
    const leader = spotlightRows[0];
    if (!leader) return null;

    const metricLabel = METRIC_OPTIONS.find((option) => option.key === spotlightMetric)?.label || 'Contribution';
    const primaryValue =
      spotlightMetric === 'contribution_points'
        ? leader.contributionPoints
        : spotlightMetric === 'fort_destroying'
          ? leader.fortDestroying
          : spotlightMetric === 'power_growth'
            ? leader.powerGrowth
            : leader.killPointsGrowth;

    return {
      id: leader.governorDbId,
      name: leader.governorName,
      governorId: null,
      allianceLabel: leader.allianceLabel,
      allianceTag: null,
      primaryLabel: metricLabel,
      primaryValue: formatMetric(primaryValue),
      secondaryLabel: 'Weekly MVP Blend',
      secondaryValue: weeklyMvp?.row.governorDbId === leader.governorDbId ? `${weeklyMvp.score.toFixed(1)} pts` : undefined,
      note: 'Spotlight rotates across the active metric board so players can scan leaders by contribution, fort, power, and KP growth.',
    };
  }, [spotlightMetric, spotlightRows, weeklyMvp]);

  const quickActions = [
    { href: '/rankings', label: 'Open Rankings', icon: Trophy },
    { href: '/governors', label: 'Browse Players', icon: Users },
    { href: '/activity', label: 'Open Stats', icon: Activity },
    { href: '/compare', label: 'Run Compare', icon: Swords },
  ];

  return (
    <div className="space-y-4 lg:space-y-6">
      <SessionGate ready={ready} loading={sessionLoading} error={sessionError} onRetry={() => void refreshSession()}>
        {error ? <InlineError message={error} /> : null}

        {/* 1. TOP KPI ROW */}
        <section className="grid gap-3 min-[390px]:gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Registered Governors" value={governorCount} icon={<Users className="size-5" />} tone="info" hint="Total across Kingdom" />
          <KpiCard label="Tracked Members" value={weeklyActivity?.summary.membersTracked ?? 0} icon={<Activity className="size-5" />} tone="neutral" hint={"Week: " + (weeklyEvent?.weekKey || "N/A")} />
          <KpiCard label="Active Events" value={events.length} icon={<Trophy className="size-5" />} tone="warn" hint="Indexed leaderboards" />
          <KpiCard label="Global Compliance" value={weeklyInsights ? `${weeklyInsights.overallPassRate}%` : "—"} icon={<ShieldCheck className="size-5" />} tone="good" hint={`Total Pass: ${weeklyInsights?.totalPass ?? 0}`} animated={false} />
        </section>

        {/* 2. MID DASHBOARD MATRIX */}
        <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
          <Panel title="Alliance Compliance Matrix" subtitle="Aggregated completion rates across active operational alliances.">
            <div className="flex flex-col gap-4">
              {alliancePulse.length === 0 ? (
                <p className="text-sm text-tier-3">No compliance data available for the active week.</p>
              ) : (
                alliancePulse.map((alliance) => {
                  const percentPass = alliance.members > 0 ? (alliance.passCount / alliance.members) * 100 : 0;
                  const percentPartial = alliance.members > 0 && alliance.partialCount ? (alliance.partialCount / alliance.members) * 100 : 0;
                  const percentFail = 100 - percentPass - percentPartial;
                  
                  return (
                    <div key={alliance.allianceTag} className="flex flex-col gap-3 rounded-[18px] bg-[color:var(--surface-3)] p-5 border border-[color:var(--stroke-soft)]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="font-heading text-lg font-bold text-tier-1">{alliance.allianceLabel}</span>
                          <span className="flex h-6 items-center rounded-full bg-white/5 border border-white/10 px-2.5 text-[11px] font-medium text-tier-3">{alliance.members} members</span>
                        </div>
                        <span className="text-lg font-mono font-bold text-tier-1">{Math.round(percentPass)}% <span className="text-sm font-sans font-medium text-tier-4">Pass</span></span>
                      </div>
                      
                      {/* Gradient Stacked Bar */}
                      <div className="h-2.5 w-full flex overflow-hidden rounded-full bg-white/[0.04] shadow-inner">
                        <div style={{ width: `${percentPass}%` }} className="bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)] transition-all" />
                        <div style={{ width: `${percentPartial}%` }} className="bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.4)] transition-all" />
                        {percentFail > 0 && <div style={{ width: `${percentFail}%` }} className="bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.4)] transition-all" />}
                      </div>
                      
                      <div className="mt-0.5 flex gap-5 text-[11px] text-tier-3 font-semibold uppercase tracking-wider">
                        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" /> {alliance.passCount} Pass</span>
                        {!!alliance.partialCount && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" /> {alliance.partialCount} Partial</span>}
                        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-500" /> {alliance.failCount} Fail</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Panel>

          <Panel title="Top Performers Podium" subtitle="Highest statistical MVPs.">
            <div className="flex flex-col gap-3">
                {podiumRows.filter(Boolean).map((row, index) => {
                  if (!row) return null;
                  return (
                    <div key={row.governorDbId} className="group/row flex flex-wrap items-center gap-3 rounded-2xl bg-[color:var(--surface-3)] p-3 border border-[color:var(--stroke-soft)] transition-colors hover:bg-white/[0.04]">
                      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border-[1.5px] border-[color:var(--rank-gold)] bg-[#1f2937] shadow-[0_0_12px_rgba(216,184,120,0.15)] ring-1 ring-black/50">
                        <img src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${row.governorDbId}&backgroundColor=transparent`} alt="avatar" className="size-full object-cover scale-[1.15]" />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <p className="truncate text-[15px] font-bold text-tier-1 drop-shadow-sm">{row.governorName}</p>
                        <p className="text-[11px] text-tier-3 font-medium mt-0.5">{row.allianceLabel}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <StatusPill label={`Rank ${index + 1}`} tone={index === 0 ? "warn" : "neutral"} />
                        <span className="text-[13px] font-mono font-bold text-tier-2">{formatMetric(row.contributionPoints)} pt</span>
                      </div>
                    </div>
                  );
                })}
                {podiumRows.filter(Boolean).length === 0 && (
                   <p className="text-sm text-tier-3 mt-4">Run weekly scoring to populate podium positions.</p>
                )}
            </div>
          </Panel>
        </div>

        {/* 3. RECENT OPERATIONS LOG */}
        <Panel title="Recent Operations Log" subtitle="Historical snapshots of kingdom events and operations.">
          <div className="flex snap-x overflow-x-auto pb-4 gap-4 no-scrollbar">
             {recentWeeklyReports.length === 0 ? (
               <p className="text-sm text-tier-3">No recent logs generated.</p>
             ) : (
               recentWeeklyReports.map(({ weekKey, report }) => (
                 <div key={weekKey} className="snap-start shrink-0 w-[260px] rounded-[18px] bg-[color:var(--surface-3)] p-4 border border-[color:var(--stroke-soft)] hover:border-white/20 transition-colors">
                   <div className="flex items-start justify-between">
                     <h4 className="font-heading text-[15px] leading-tight text-tier-1 line-clamp-2 pr-2">{report.event.name}</h4>
                     <CalendarClock className="size-4 shrink-0 text-tier-4" />
                   </div>
                   <p className="text-[11px] font-mono text-tier-3 mt-2">{weekKey}</p>
                   <div className="mt-5 grid grid-cols-2 gap-3 text-sm text-tier-2 border-t border-white/5 pt-3">
                     <div className="flex flex-col gap-0.5"><span className="text-[10px] uppercase tracking-wider text-tier-4">Tracked</span><span className="font-mono font-bold">{report.summary.membersTracked}</span></div>
                     <div className="flex flex-col gap-0.5"><span className="text-[10px] uppercase tracking-wider text-tier-4">Issues</span><span className={`font-mono font-bold ${report.summary.unresolvedIdentityCount > 0 ? "text-rose-300" : "text-tier-3"}`}>{report.summary.unresolvedIdentityCount}</span></div>
                   </div>
                 </div>
               ))
             )}
          </div>
        </Panel>

      </SessionGate>
    </div>
  );
}
