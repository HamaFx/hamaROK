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
  Target,
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

  const topPowerGrowth = useMemo(() => {
    if (!weeklyActivity?.rows?.length) return null;
    return [...weeklyActivity.rows].filter(r => r.powerGrowth != null).sort((a, b) => Number(b.powerGrowth) - Number(a.powerGrowth))[0] || null;
  }, [weeklyActivity]);

  const topContribution = useMemo(() => {
    if (!weeklyActivity?.rows?.length) return null;
    return [...weeklyActivity.rows].filter(r => r.contributionPoints != null).sort((a, b) => Number(b.contributionPoints) - Number(a.contributionPoints))[0] || null;
  }, [weeklyActivity]);

  const topForts = useMemo(() => {
    if (!weeklyActivity?.rows?.length) return null;
    return [...weeklyActivity.rows].filter(r => r.fortDestroying != null).sort((a, b) => Number(b.fortDestroying) - Number(a.fortDestroying))[0] || null;
  }, [weeklyActivity]);

  return (
    <div className="space-y-6 lg:space-y-8">
      <SessionGate ready={ready} loading={sessionLoading} error={sessionError} onRetry={() => void refreshSession()}>
        {error ? <InlineError message={error} /> : null}

        {/* 1. TOP KPI ROW - GAME FOCUSED */}
        <section className="grid gap-3 min-[390px]:gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Kingdom Power Grown" value={weeklyInsights ? formatCompactNumber(weeklyInsights.totalPowerGrowth) : "—"} icon={<Sparkles className="size-5" />} tone="good" hint="Total positive growth captured" />
          <KpiCard label="Total Combat DKP" value={weeklyInsights ? formatCompactNumber(weeklyInsights.totalContribution) : "—"} icon={<Activity className="size-5" />} tone="warn" hint="Total Contribution sum" />
          <KpiCard label="Tracked Members" value={weeklyActivity?.summary.membersTracked ?? 0} icon={<Users className="size-5" />} tone="info" hint={`Week: ${weeklyEvent?.weekKey || "N/A"}`} />
          <KpiCard label="Kingdom Activity Pass" value={weeklyInsights ? `${weeklyInsights.overallPassRate}%` : "—"} icon={<ShieldCheck className="size-5" />} tone="good" hint="Overall compliance threshold" animated={false} />
        </section>

        {/* 2. TOP MVPs - HORIZONTAL COLUMNS */}
        <Panel title="Weekly MVP Operations" subtitle="Top performers isolated by statistical category.">
          <div className="grid gap-4 sm:grid-cols-3">
             {/* Power Growth MVP */}
             <div className="rounded-[20px] bg-white/[0.02] border border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.05)] p-5">
                <div className="flex items-center gap-2 mb-3">
                   <TrendingUp className="size-5 text-emerald-400" />
                   <h3 className="font-heading text-lg font-bold text-tier-1">Top Power Growth</h3>
                </div>
                {topPowerGrowth ? (
                   <div className="flex flex-col gap-3">
                      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border-[1.5px] border-emerald-500/40 bg-[#1f2937]">
                        <img src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${topPowerGrowth.governorDbId}&backgroundColor=transparent`} alt="avatar" className="size-full object-cover scale-[1.15]" />
                      </div>
                      <div>
                         <p className="text-xl font-bold text-tier-1 font-heading">{topPowerGrowth.governorName}</p>
                         <p className="text-sm text-tier-3">{topPowerGrowth.allianceLabel}</p>
                         <p className="mt-2 text-2xl font-mono font-bold text-emerald-400">+{formatMetric(topPowerGrowth.powerGrowth)}</p>
                      </div>
                   </div>
                ) : <p className="text-sm text-tier-4 mt-6">Awaiting power board stats.</p>}
             </div>

             {/* Activity / Contribution MVP */}
             <div className="rounded-[20px] bg-white/[0.02] border border-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.05)] p-5">
                <div className="flex items-center gap-2 mb-3">
                   <Sparkles className="size-5 text-amber-400" />
                   <h3 className="font-heading text-lg font-bold text-tier-1">Top Activity MVP</h3>
                </div>
                {topContribution ? (
                   <div className="flex flex-col gap-3">
                      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border-[1.5px] border-amber-500/40 bg-[#1f2937]">
                        <img src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${topContribution.governorDbId}&backgroundColor=transparent`} alt="avatar" className="size-full object-cover scale-[1.15]" />
                      </div>
                      <div>
                         <p className="text-xl font-bold text-tier-1 font-heading">{topContribution.governorName}</p>
                         <p className="text-sm text-tier-3">{topContribution.allianceLabel}</p>
                         <p className="mt-2 text-2xl font-mono font-bold text-amber-400">{formatMetric(topContribution.contributionPoints)} DKP</p>
                      </div>
                   </div>
                ) : <p className="text-sm text-tier-4 mt-6">Awaiting activity board stats.</p>}
             </div>

             {/* Fort Destroyer MVP */}
             <div className="rounded-[20px] bg-white/[0.02] border border-rose-500/20 shadow-[0_0_20px_rgba(244,63,94,0.05)] p-5">
                <div className="flex items-center gap-2 mb-3">
                   <Target className="size-5 text-rose-400" />
                   <h3 className="font-heading text-lg font-bold text-tier-1">Top Fort Destroyer</h3>
                </div>
                {topForts ? (
                   <div className="flex flex-col gap-3">
                      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border-[1.5px] border-rose-500/40 bg-[#1f2937]">
                        <img src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${topForts.governorDbId}&backgroundColor=transparent`} alt="avatar" className="size-full object-cover scale-[1.15]" />
                      </div>
                      <div>
                         <p className="text-xl font-bold text-tier-1 font-heading">{topForts.governorName}</p>
                         <p className="text-sm text-tier-3">{topForts.allianceLabel}</p>
                         <p className="mt-2 text-2xl font-mono font-bold text-rose-400">{formatMetric(topForts.fortDestroying)} Forts</p>
                      </div>
                   </div>
                ) : <p className="text-sm text-tier-4 mt-6">Awaiting fort board stats.</p>}
             </div>
          </div>
        </Panel>

        {/* 3. COMBAT ACTIVITY MATRIX */}
        <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
          <Panel title="Alliance Combat Readiness" subtitle="Percentage of members meeting minimum weekly Combat and Growth thresholds.">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 gap-4">
              {alliancePulse.length === 0 ? (
                <p className="text-sm text-tier-3">No compliance data available for the active week.</p>
              ) : (
                alliancePulse.map((alliance) => {
                  const percentPass = alliance.members > 0 ? (alliance.passCount / alliance.members) * 100 : 0;
                  const percentFail = 100 - percentPass;
                  
                  return (
                    <div key={alliance.allianceTag} className="flex flex-col gap-3 rounded-[16px] bg-white/[0.015] p-4 border border-white/[0.04]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-heading text-base font-bold text-tier-1 drop-shadow-sm">{alliance.allianceLabel}</span>
                        </div>
                        <span className="text-base font-mono font-bold text-tier-1">{Math.round(percentPass)}% <span className="text-xs font-sans font-medium text-tier-4">Pass</span></span>
                      </div>
                      
                      <div className="h-2 w-full flex overflow-hidden rounded-full bg-white/[0.04] shadow-inner">
                        <div style={{ width: `${percentPass}%` }} className="bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)] transition-all" />
                        {percentFail > 0 && <div style={{ width: `${percentFail}%` }} className="bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.3)] transition-all" />}
                      </div>
                      
                      <div className="flex justify-between text-[11px] text-tier-3 font-semibold uppercase tracking-wider">
                         <span>{alliance.members} Members Tracked</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Panel>

          <Panel title="Risers & Fallers" subtitle="Movement in combat efficiency since last week.">
            {weekMovement && weekMovement.comparedCount > 0 ? (
              <div className="space-y-6">
                <div>
                  <h3 className="font-heading text-xs uppercase tracking-widest text-emerald-400 font-bold flex items-center gap-2 mb-3">
                    <TrendingUp className="size-3.5" /> Efficiency Risers
                  </h3>
                  <div className="grid gap-2">
                    {weekMovement.risers.map((r) => (
                      <div key={r.governorDbId} className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-all">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="size-8 shrink-0 rounded-lg overflow-hidden border border-emerald-500/20 bg-black/20">
                            <img src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${r.governorDbId}&backgroundColor=transparent`} alt="" className="size-full object-cover" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-tier-1 truncate">{r.governorName}</p>
                            <p className="text-[10px] text-tier-3">{r.allianceLabel}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-mono font-bold text-emerald-400">+{r.delta.toFixed(1)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-heading text-xs uppercase tracking-widest text-rose-400 font-bold flex items-center gap-2 mb-3">
                    <TrendingDown className="size-3.5" /> Stability Risk
                  </h3>
                  <div className="grid gap-2">
                    {weekMovement.fallers.map((r) => (
                      <div key={r.governorDbId} className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-all">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="size-8 shrink-0 rounded-lg overflow-hidden border border-rose-500/20 bg-black/20">
                             <img src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${r.governorDbId}&backgroundColor=transparent`} alt="" className="size-full object-cover grayscale opacity-60" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-tier-1 truncate">{r.governorName}</p>
                            <p className="text-[10px] text-tier-3">{r.allianceLabel}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-mono font-bold text-rose-400">{r.delta.toFixed(1)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-tier-3 mt-4">Movement data requires at least two scored weeks of activity.</p>
            )}
          </Panel>
        </div>

      </SessionGate>
    </div>
  );
}
