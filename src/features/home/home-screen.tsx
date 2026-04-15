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
    <div className="space-y-5 sm:space-y-6">
      <PageHero
        title="Live Weekly Boards"
        subtitle="A rankings-first home that surfaces current leaders, rising players, and the statboards worth checking next."
        badges={[
          weeklyEvent?.weekKey ? `Week ${weeklyEvent.weekKey}` : 'Week pending',
          `${weeklyActivity?.summary.membersTracked ?? 0} tracked players`,
          `${events.length} events indexed`,
        ]}
        actions={
          <>
            <Button asChild className="rounded-full bg-[linear-gradient(135deg,#5a7fff,#7cc9ff)] text-black hover:opacity-95">
              <Link href="/rankings">
                <Trophy data-icon="inline-start" />
                Open Rankings
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white">
              <Link href="/compare">
                <Swords data-icon="inline-start" />
                Compare Events
              </Link>
            </Button>
          </>
        }
      />

      <SessionGate ready={ready} loading={sessionLoading} error={sessionError} onRetry={() => void refreshSession()}>
        {error ? <InlineError message={error} /> : null}

        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <motion.div initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
            <Panel
              title="Podium Spotlight"
              subtitle="Switch the board story to see who owns the current week."
              actions={
                <ToggleGroup type="single" value={spotlightMetric} onValueChange={(value) => value && setSpotlightMetric(value as SpotlightMetric)} className="w-full justify-start gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
                  {METRIC_OPTIONS.map((option) => (
                    <ToggleGroupItem
                      key={option.key}
                      value={option.key}
                      className="shrink-0 rounded-full border border-white/10 bg-white/4 px-3 text-xs text-white/64 data-[state=on]:border-sky-300/22 data-[state=on]:bg-sky-300/12 data-[state=on]:text-white"
                    >
                      {option.short}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              }
            >
              <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                  {podiumRows.map((row, index) => {
                    if (!row) {
                      return (
                        <Card key={`podium-empty-${index}`} className="h-full min-h-[220px] border-dashed border-white/14 bg-[rgba(11,15,24,0.6)]">
                          <CardContent className="flex h-full flex-col justify-between gap-4 p-5">
                            <StatusPill label={`#${index + 1}`} tone="neutral" />
                            <div>
                              <p className="font-heading text-lg text-white/80">Open Podium Slot</p>
                              <p className="mt-2 text-sm text-white/52">Upload and score this week to populate additional leaderboard positions.</p>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    }

                    const value =
                      spotlightMetric === 'contribution_points'
                        ? row.contributionPoints
                        : spotlightMetric === 'fort_destroying'
                          ? row.fortDestroying
                          : spotlightMetric === 'power_growth'
                            ? row.powerGrowth
                            : row.killPointsGrowth;

                    return (
                      <Card
                        key={row.governorDbId}
                        className={
                          index === 0
                            ? 'h-full min-h-[220px] border-[#ffd57d]/18 bg-[linear-gradient(145deg,rgba(29,21,7,0.86),rgba(10,12,18,0.96))]'
                            : 'h-full min-h-[220px] border-white/10 bg-[rgba(11,15,24,0.92)]'
                        }
                      >
                        <CardContent className="flex h-full flex-col gap-4 p-5">
                          <div className="flex items-center justify-between">
                            <StatusPill label={`#${index + 1}`} tone={index === 0 ? 'warn' : 'neutral'} />
                            {index === 0 ? <Crown className="size-5 text-[#ffd57d]" /> : null}
                          </div>
                          <div>
                            <p className="font-heading text-lg text-white">{row.governorName}</p>
                            <p className="mt-1 text-sm text-white/52">{row.allianceLabel}</p>
                          </div>
                          <div className="mt-auto">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-white/38">
                              {METRIC_OPTIONS.find((option) => option.key === spotlightMetric)?.label}
                            </p>
                            <p className="mt-2 font-heading text-2xl text-white">{formatMetric(value)}</p>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                <Card className="border-white/10 bg-[linear-gradient(145deg,rgba(14,18,30,0.98),rgba(8,11,19,0.98))]">
                  <CardHeader>
                    <CardTitle className="font-heading text-white">Featured Player</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {featuredPlayer ? (
                      <>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-white/38">Current spotlight</p>
                          <h2 className="mt-2 font-heading text-2xl text-white">{featuredPlayer.name}</h2>
                          <p className="mt-1 text-sm text-white/56">{featuredPlayer.allianceLabel}</p>
                        </div>
                        <MetricStrip
                          items={[
                            { label: featuredPlayer.primaryLabel, value: featuredPlayer.primaryValue, accent: 'gold' },
                            featuredPlayer.secondaryValue
                              ? {
                                  label: featuredPlayer.secondaryLabel || 'Weekly MVP',
                                  value: featuredPlayer.secondaryValue,
                                  accent: 'teal' as const,
                                }
                              : { label: 'Week', value: formatWeekShort(weeklyEvent?.weekKey), accent: 'slate' as const },
                          ]}
                        />
                        <p className="text-sm leading-6 text-white/58">{featuredPlayer.note}</p>
                        <div className="grid gap-2.5 md:grid-cols-2">
                          {quickActions.map((action) => {
                            const Icon = action.icon;
                            return (
                              <Button key={action.href} asChild variant="outline" className="h-11 justify-between rounded-2xl border-white/10 bg-white/4 text-white hover:bg-white/8 hover:text-white">
                                <Link href={action.href}>
                                  <span className="flex items-center gap-2">
                                    <Icon className="size-4" />
                                    {action.label}
                                  </span>
                                  <ArrowRight className="size-4" />
                                </Link>
                              </Button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-white/56">Upload and score a weekly cycle to unlock the featured-player spotlight.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </Panel>
          </motion.div>

          <motion.div initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.03 }} className="space-y-6">
            <Panel title="Week Pulse" subtitle="A compact read on the current board state.">
              <div className="grid gap-4 sm:grid-cols-2">
                <KpiCard label="Tracked Players" value={weeklyActivity?.summary.membersTracked ?? 0} hint="Rows in the active weekly board" tone="info" icon={<Users className="size-5" />} />
                <KpiCard label="Pass Rate" value={weeklyInsights ? `${weeklyInsights.overallPassRate}%` : '—'} hint={`${weeklyInsights?.totalPass ?? 0} pass / ${weeklyInsights?.totalMembers ?? 0} scored`} tone="good" icon={<ShieldCheck className="size-5" />} animated={false} />
                <KpiCard label="Total Contribution" value={weeklyInsights ? formatCompactNumber(weeklyInsights.totalContribution) : '—'} hint="Contribution captured this week" tone="warn" icon={<Sparkles className="size-5" />} animated={false} />
                <KpiCard label="Baseline Coverage" value={weeklyInsights ? `${weeklyInsights.baselineCoverage}%` : '—'} hint="Power baseline readiness" tone="neutral" icon={<CalendarClock className="size-5" />} animated={false} />
              </div>
            </Panel>

            <Panel title="Alliance Leader" subtitle="Best pass-rate alliance in the active week.">
              {weeklyInsights?.topAlliance ? (
                <div className="rounded-[26px] border border-white/10 bg-white/4 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-heading text-xl text-white">{weeklyInsights.topAlliance.allianceLabel}</p>
                      <p className="mt-1 text-sm text-white/54">{weeklyInsights.topAlliance.passCount} passing players out of {weeklyInsights.topAlliance.members}</p>
                    </div>
                    <StatusPill label={`${weeklyInsights.topAlliance.passRate}%`} tone="good" />
                  </div>
                  <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/8">
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#6aa4ff,#8ee7ff)]" style={{ width: `${weeklyInsights.topAlliance.passRate}%` }} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-white/56">Alliance pass-rate data appears once weekly scoring is available.</p>
              )}
            </Panel>
          </motion.div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Panel title="Movement Watch" subtitle="The players climbing or dropping fastest since the previous scored week.">
            {weekMovement ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="border-emerald-400/16 bg-emerald-400/6">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 font-heading text-base text-white">
                      <TrendingUp className="size-4 text-emerald-200" /> Top Risers
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {weekMovement.risers.map((row) => (
                      <div key={row.governorDbId} className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/10 px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-white">{row.governorName}</p>
                          <p className="text-xs text-white/52">{row.allianceLabel}</p>
                        </div>
                        <p className="font-heading text-lg text-emerald-100">+{row.delta.toFixed(1)}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card className="border-rose-400/16 bg-rose-400/6">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 font-heading text-base text-white">
                      <TrendingDown className="size-4 text-rose-200" /> Top Fallers
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {weekMovement.fallers.length ? weekMovement.fallers.map((row) => (
                      <div key={row.governorDbId} className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/10 px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-white">{row.governorName}</p>
                          <p className="text-xs text-white/52">{row.allianceLabel}</p>
                        </div>
                        <p className="font-heading text-lg text-rose-100">{row.delta.toFixed(1)}</p>
                      </div>
                    )) : <p className="text-sm text-white/56">No fallers were detected in the current comparison window.</p>}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-white/12 bg-white/5 p-5">
                <p className="font-heading text-lg text-white">Movement Tracking Locked</p>
                <p className="mt-2 text-sm text-white/58">Score at least two weekly cycles to unlock risers and fallers with week-over-week deltas.</p>
              </div>
            )}
          </Panel>

          <Panel title="Board Quick Read" subtitle="Snapshots, events, and MVP context in one place.">
            <div className="space-y-4">
              <Card className="border-white/10 bg-white/4">
                <CardContent className="flex items-center justify-between gap-4 p-5">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">Weekly MVP</p>
                    <p className="mt-2 font-heading text-xl text-white">{weeklyMvp?.row.governorName ?? 'Pending'}</p>
                    <p className="mt-1 text-sm text-white/54">{weeklyMvp?.row.allianceLabel ?? 'No scored week yet'}</p>
                  </div>
                  {weeklyMvp ? <StatusPill label={`${weeklyMvp.score.toFixed(1)} pts`} tone="good" /> : null}
                </CardContent>
              </Card>
              <div className="grid gap-4 sm:grid-cols-2">
                <Card className="border-white/10 bg-white/4">
                  <CardContent className="p-5">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">Total Players</p>
                    <p className="mt-2 font-heading text-2xl text-white">{governorCount.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card className="border-white/10 bg-white/4">
                  <CardContent className="p-5">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">Snapshots Indexed</p>
                    <p className="mt-2 font-heading text-2xl text-white">{totalSnapshots.toLocaleString()}</p>
                  </CardContent>
                </Card>
              </div>
              <div className="rounded-[26px] border border-white/10 bg-white/4 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">Recent Events</p>
                    <p className="mt-2 text-sm text-white/56">Latest windows available for compare and board building.</p>
                  </div>
                  <Button asChild variant="outline" className="rounded-full border-white/10 bg-white/4 text-white hover:bg-white/8 hover:text-white">
                    <Link href="/events">View all</Link>
                  </Button>
                </div>
                <div className="mt-4 space-y-3">
                  {events.slice(0, 4).map((event) => (
                    <div key={event.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/10 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-white">{event.name}</p>
                        <p className="text-xs text-white/50">{new Date(event.createdAt).toLocaleDateString()}</p>
                      </div>
                      <StatusPill label={`${event.snapshotCount} rows`} tone="neutral" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </SessionGate>
    </div>
  );
}
