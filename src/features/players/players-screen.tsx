'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Crown,
  LineChart,
  Search,
  Swords,
  TrendingUp,
  Users,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { GrowthLineChart, WeeklyActivityLineChart } from '@/components/Charts';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DataTableLite,
  EmptyState,
  FilterBar,
  KpiCard,
  MetricStrip,
  PageHero,
  Panel,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';
import type { PlayerProfileViewModel } from '@/features/shared/types';
import { formatCompactNumber, formatMetric, formatWeekShort, toSafeBigInt } from '@/features/shared/formatters';
import { cn } from '@/lib/utils';
import { useWorkspaceSession } from '@/lib/workspace-session';

const ALL_VALUE = '__all__';

type DirectorySortKey = 'power' | 'contribution' | 'snapshots' | 'name';

type ComplianceState = 'PASS' | 'FAIL' | 'PARTIAL' | 'NO_STANDARD';

interface GovernorItem {
  id: string;
  governorId: string;
  name: string;
  alliance: string;
  snapshotCount: number;
  latestPower: string;
}

interface WeeklyActivityRow {
  governorDbId: string;
  governorId: string;
  governorName: string;
  allianceTag: string;
  allianceLabel: string;
  contributionPoints: string;
  fortDestroying: string;
  powerGrowth: string | null;
  killPointsGrowth: string | null;
  compliance: {
    overall: ComplianceState;
  };
}

interface WeeklyActivityResponse {
  event: {
    id: string;
    name: string;
    weekKey: string | null;
    startsAt: string | null;
  };
  rows: WeeklyActivityRow[];
}

interface TimelineEntry {
  event: { id: string; name: string };
  power: string;
  killPoints: string;
  deads: string;
  date: string;
}

interface WeeklyActivityHistoryEntry {
  weekKey: string;
  weekName: string;
  startsAt: string | null;
  metrics: {
    contributionPoints: string;
    fortDestroying: string;
    powerGrowth: string | null;
    killPointsGrowth: string | null;
    powerBaselineReady: boolean;
    killPointsBaselineReady: boolean;
    compliance: {
      overall: ComplianceState;
    };
  } | null;
}

interface DirectoryRow extends GovernorItem {
  weekly: WeeklyActivityRow | null;
}

function statusTone(status: ComplianceState): 'good' | 'bad' | 'warn' | 'neutral' {
  if (status === 'PASS') return 'good';
  if (status === 'FAIL') return 'bad';
  if (status === 'PARTIAL') return 'warn';
  return 'neutral';
}

function allianceTone(alliance: string): 'warn' | 'info' | 'neutral' {
  if (alliance === 'GODt') return 'warn';
  if (alliance === 'V57') return 'info';
  return 'neutral';
}

function compareNullableMetric(a: string | null, b: string | null) {
  const diff = toSafeBigInt(a) - toSafeBigInt(b);
  if (diff === BigInt(0)) return 0;
  return diff > BigInt(0) ? 1 : -1;
}

export default function PlayersScreen() {
  const { workspaceId, accessToken, ready, loading: sessionLoading, error: sessionError, refreshSession } = useWorkspaceSession();
  const [governors, setGovernors] = useState<GovernorItem[]>([]);
  const [weeklyBoard, setWeeklyBoard] = useState<WeeklyActivityResponse | null>(null);
  const [selectedGovernorId, setSelectedGovernorId] = useState<string>('');
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(null);
  const [weeklyHistory, setWeeklyHistory] = useState<WeeklyActivityHistoryEntry[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [search, setSearch] = useState('');
  const [allianceFilter, setAllianceFilter] = useState('');
  const [sortKey, setSortKey] = useState<DirectorySortKey>('power');
  const [error, setError] = useState<string | null>(null);

  const loadWeeklyBoard = useCallback(async () => {
    if (!ready) {
      setWeeklyBoard(null);
      return;
    }

    try {
      const res = await fetch(`/api/v2/activity/weekly?workspaceId=${encodeURIComponent(workspaceId)}`, {
        headers: { 'x-access-token': accessToken },
      });
      const payload = await res.json();
      setWeeklyBoard(res.ok && payload?.data ? (payload.data as WeeklyActivityResponse) : null);
    } catch {
      setWeeklyBoard(null);
    }
  }, [workspaceId, accessToken, ready]);

  const loadGovernors = useCallback(
    async (query = '') => {
      if (!ready) {
        setGovernors([]);
        return;
      }

      setLoadingList(true);
      try {
        setError(null);
        const params = new URLSearchParams({
          workspaceId,
          search: query,
          limit: '200',
        });
        const res = await fetch(`/api/v2/governors?${params.toString()}`, {
          headers: { 'x-access-token': accessToken },
        });
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.error?.message || 'Failed to load players.');
        }
        setGovernors(Array.isArray(payload?.data) ? (payload.data as GovernorItem[]) : []);
      } catch (cause) {
        setGovernors([]);
        setError(cause instanceof Error ? cause.message : 'Failed to load players.');
      } finally {
        setLoadingList(false);
      }
    },
    [workspaceId, accessToken, ready]
  );

  const loadProfile = useCallback(
    async (governorId: string) => {
      if (!ready || !governorId) {
        setTimeline(null);
        setWeeklyHistory(null);
        return;
      }

      setLoadingProfile(true);
      try {
        setError(null);
        const params = new URLSearchParams({ workspaceId });
        const [timelineRes, weeklyRes] = await Promise.all([
          fetch(`/api/v2/governors/${governorId}/timeline?${params.toString()}`, {
            headers: { 'x-access-token': accessToken },
          }),
          fetch(
            `/api/v2/governors/${governorId}/weekly-activity?${new URLSearchParams({
              workspaceId,
              limit: '12',
            }).toString()}`,
            {
              headers: { 'x-access-token': accessToken },
            }
          ),
        ]);

        const [timelinePayload, weeklyPayload] = await Promise.all([
          timelineRes.json(),
          weeklyRes.json(),
        ]);

        if (!timelineRes.ok) {
          throw new Error(timelinePayload?.error?.message || 'Failed to load player timeline.');
        }

        setTimeline(Array.isArray(timelinePayload?.data?.timeline) ? timelinePayload.data.timeline : []);
        setWeeklyHistory(
          weeklyRes.ok && Array.isArray(weeklyPayload?.data?.history)
            ? (weeklyPayload.data.history as WeeklyActivityHistoryEntry[])
            : []
        );
      } catch (cause) {
        setTimeline([]);
        setWeeklyHistory([]);
        setError(cause instanceof Error ? cause.message : 'Failed to load player profile.');
      } finally {
        setLoadingProfile(false);
      }
    },
    [workspaceId, accessToken, ready]
  );

  useEffect(() => {
    if (!ready) return;
    void Promise.all([loadGovernors(), loadWeeklyBoard()]);
  }, [ready, loadGovernors, loadWeeklyBoard]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void loadGovernors(search);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, ready, loadGovernors]);

  const weeklyActivityMap = useMemo(() => {
    const rows = new Map<string, WeeklyActivityRow>();
    for (const row of weeklyBoard?.rows || []) {
      rows.set(row.governorDbId, row);
    }
    return rows;
  }, [weeklyBoard?.rows]);

  const directoryRows = useMemo<DirectoryRow[]>(() => {
    const mapped = governors.map((governor) => ({
      ...governor,
      weekly: weeklyActivityMap.get(governor.id) || null,
    }));

    const filtered = allianceFilter
      ? mapped.filter((row) => (row.weekly?.allianceTag || row.alliance || '') === allianceFilter)
      : mapped;

    return filtered.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'snapshots') return b.snapshotCount - a.snapshotCount;
      if (sortKey === 'contribution') {
        const diff = toSafeBigInt(b.weekly?.contributionPoints) - toSafeBigInt(a.weekly?.contributionPoints);
        if (diff === BigInt(0)) return a.name.localeCompare(b.name);
        return diff > BigInt(0) ? 1 : -1;
      }
      const diff = toSafeBigInt(b.latestPower) - toSafeBigInt(a.latestPower);
      if (diff === BigInt(0)) return a.name.localeCompare(b.name);
      return diff > BigInt(0) ? 1 : -1;
    });
  }, [governors, weeklyActivityMap, allianceFilter, sortKey]);

  useEffect(() => {
    if (!directoryRows.length) {
      setSelectedGovernorId('');
      return;
    }
    if (!selectedGovernorId || !directoryRows.some((row) => row.id === selectedGovernorId)) {
      setSelectedGovernorId(directoryRows[0].id);
    }
  }, [directoryRows, selectedGovernorId]);

  useEffect(() => {
    if (!selectedGovernorId) return;
    void loadProfile(selectedGovernorId);
  }, [selectedGovernorId, loadProfile]);

  const selectedGovernor = useMemo(
    () => directoryRows.find((row) => row.id === selectedGovernorId) || null,
    [directoryRows, selectedGovernorId]
  );

  const profile = useMemo<PlayerProfileViewModel | null>(() => {
    if (!selectedGovernor) return null;
    return {
      id: selectedGovernor.id,
      name: selectedGovernor.name,
      governorId: selectedGovernor.governorId,
      allianceLabel: selectedGovernor.weekly?.allianceLabel || selectedGovernor.alliance || 'No alliance',
      allianceTag: selectedGovernor.weekly?.allianceTag || selectedGovernor.alliance || null,
      latestPower: selectedGovernor.latestPower,
      snapshotCount: selectedGovernor.snapshotCount,
      currentStatus: selectedGovernor.weekly?.compliance.overall || 'NO_STANDARD',
      metrics: [
        {
          label: 'Contribution',
          value: selectedGovernor.weekly?.contributionPoints || '0',
        },
        {
          label: 'Fort Destroying',
          value: selectedGovernor.weekly?.fortDestroying || '0',
        },
        {
          label: 'Power Growth',
          value: selectedGovernor.weekly?.powerGrowth,
        },
        {
          label: 'KP Growth',
          value: selectedGovernor.weekly?.killPointsGrowth,
        },
      ],
    };
  }, [selectedGovernor]);

  const profileSummary = useMemo(() => {
    const history = weeklyHistory || [];
    const rowsWithMetrics = history.filter((entry) => entry.metrics);
    if (!rowsWithMetrics.length) {
      return {
        bestContribution: null as WeeklyActivityHistoryEntry | null,
        bestPower: null as WeeklyActivityHistoryEntry | null,
      };
    }

    const bestContribution = [...rowsWithMetrics].sort((a, b) => compareNullableMetric(b.metrics?.contributionPoints || null, a.metrics?.contributionPoints || null))[0] || null;
    const bestPower = [...rowsWithMetrics].sort((a, b) => compareNullableMetric(b.metrics?.powerGrowth || null, a.metrics?.powerGrowth || null))[0] || null;

    return { bestContribution, bestPower };
  }, [weeklyHistory]);

  const kpis = useMemo(() => {
    const highPower = directoryRows.filter((row) => toSafeBigInt(row.latestPower) >= BigInt(100_000_000)).length;
    const avgSnapshots =
      directoryRows.length > 0
        ? Math.round(directoryRows.reduce((sum, row) => sum + row.snapshotCount, 0) / directoryRows.length)
        : 0;

    return {
      tracked: governors.length,
      visible: directoryRows.length,
      avgSnapshots,
      highPower,
    };
  }, [governors.length, directoryRows]);

  const historyColumns = useMemo(
    () => [
      {
        key: 'week',
        label: 'Week',
        render: (row: WeeklyActivityHistoryEntry) => (
          <div className="space-y-1">
            <strong className="font-heading text-base text-white">{formatWeekShort(row.weekKey)}</strong>
            <p className="text-xs text-white/48">{row.weekName}</p>
          </div>
        ),
      },
      {
        key: 'contribution',
        label: 'Contribution',
        className: 'text-right',
        render: (row: WeeklyActivityHistoryEntry) => formatMetric(row.metrics?.contributionPoints || null),
      },
      {
        key: 'fort',
        label: 'Fort',
        className: 'text-right',
        mobileHidden: true,
        render: (row: WeeklyActivityHistoryEntry) => formatMetric(row.metrics?.fortDestroying || null),
      },
      {
        key: 'power',
        label: 'Power',
        className: 'text-right',
        render: (row: WeeklyActivityHistoryEntry) => formatMetric(row.metrics?.powerGrowth || null),
      },
      {
        key: 'kp',
        label: 'KP',
        className: 'text-right',
        mobileHidden: true,
        render: (row: WeeklyActivityHistoryEntry) => formatMetric(row.metrics?.killPointsGrowth || null),
      },
      {
        key: 'status',
        label: 'Status',
        render: (row: WeeklyActivityHistoryEntry) => (
          <StatusPill
            label={row.metrics?.compliance.overall || 'NO_DATA'}
            tone={statusTone(row.metrics?.compliance.overall || 'NO_STANDARD')}
          />
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHero
        title="Players"
        subtitle="Directory, spotlight profile, and week-over-week movement without breaking the existing governor and activity APIs."
        badges={[
          weeklyBoard?.event?.weekKey ? `Week ${weeklyBoard.event.weekKey}` : 'Week pending',
          `${directoryRows.length} visible players`,
          profile?.allianceTag ? `Spotlight ${profile.allianceTag}` : 'Spotlight pending',
        ]}
        actions={
          <>
            <Button asChild variant="outline" className="rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white">
              <Link href="/rankings">
                <Crown data-icon="inline-start" /> Rankings
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white">
              <Link href="/compare">
                <Swords data-icon="inline-start" /> Compare
              </Link>
            </Button>
          </>
        }
      />

      <SessionGate ready={ready} loading={sessionLoading} error={sessionError} onRetry={() => void refreshSession()}>
        {error ? <InlineError message={error} /> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Tracked Players" value={kpis.tracked} hint="Roster identities indexed in this workspace" tone="info" icon={<Users className="size-5" />} />
          <KpiCard label="Visible in Directory" value={kpis.visible} hint="Rows after current alliance and search filters" tone="neutral" icon={<Search className="size-5" />} />
          <KpiCard label="Avg Snapshots" value={kpis.avgSnapshots} hint="Average snapshot depth across the visible roster" tone="good" icon={<LineChart className="size-5" />} />
          <KpiCard label="100M+ Power" value={kpis.highPower} hint="Profiles with high current power in the visible set" tone="warn" icon={<TrendingUp className="size-5" />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <Panel
            className="order-1"
            title="Player Directory"
            subtitle="Search the roster, filter by alliance, and open a profile spotlight."
            actions={
              <FilterBar>
                <div className="relative min-w-0 flex-1 md:min-w-[220px]">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/34" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search player or governor ID"
                    className="rounded-full border-white/10 bg-white/4 pl-11 text-white placeholder:text-white/28"
                  />
                </div>
                <Select value={allianceFilter || ALL_VALUE} onValueChange={(value) => setAllianceFilter(value === ALL_VALUE ? '' : value)}>
                  <SelectTrigger className="min-w-40 rounded-full border-white/10 bg-white/4 text-white"><SelectValue placeholder="Alliance" /></SelectTrigger>
                  <SelectContent className="border-white/10 bg-[rgba(8,10,16,0.98)] text-white">
                    <SelectItem value={ALL_VALUE}>All Alliances</SelectItem>
                    <SelectItem value="GODt">[GODt]</SelectItem>
                    <SelectItem value="V57">[V57]</SelectItem>
                    <SelectItem value="P57R">[P57R]</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sortKey} onValueChange={(value) => setSortKey(value as DirectorySortKey)}>
                  <SelectTrigger className="min-w-40 rounded-full border-white/10 bg-white/4 text-white"><SelectValue placeholder="Sort" /></SelectTrigger>
                  <SelectContent className="border-white/10 bg-[rgba(8,10,16,0.98)] text-white">
                    <SelectItem value="power">Latest Power</SelectItem>
                    <SelectItem value="contribution">Contribution</SelectItem>
                    <SelectItem value="snapshots">Snapshots</SelectItem>
                    <SelectItem value="name">Name</SelectItem>
                  </SelectContent>
                </Select>
              </FilterBar>
            }
          >
            {loadingList ? (
              <SkeletonSet rows={5} />
            ) : directoryRows.length ? (
              <div className="grid gap-3">
                {directoryRows.map((row, index) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedGovernorId(row.id)}
                    className={cn(
                      'rounded-[24px] border border-white/10 bg-[linear-gradient(160deg,rgba(16,22,36,0.74),rgba(11,15,24,0.9))] p-5 text-left transition-all hover:bg-white/8',
                      row.id === selectedGovernorId && 'border-sky-300/22 bg-sky-300/10 shadow-[0_14px_40px_rgba(0,0,0,0.26)]'
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill label={`#${index + 1}`} tone="neutral" />
                          <StatusPill label={row.weekly?.allianceTag || row.alliance || 'No alliance'} tone={allianceTone(row.weekly?.allianceTag || row.alliance || '')} />
                          {row.weekly ? <StatusPill label={row.weekly.compliance.overall} tone={statusTone(row.weekly.compliance.overall)} /> : null}
                        </div>
                        <div>
                          <p className="truncate font-heading text-xl text-white">{row.name}</p>
                          <p className="mt-1 text-sm text-white/48">ID {row.governorId}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-heading text-2xl text-white">{formatCompactNumber(row.latestPower)}</p>
                        <p className="mt-1 text-xs text-white/40">power</p>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-white/58">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/34">Contribution</p>
                        <p className="mt-2 font-medium text-white">{formatCompactNumber(row.weekly?.contributionPoints || '0')}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/34">Snapshots</p>
                        <p className="mt-2 font-medium text-white">{row.snapshotCount}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState title="No players found" description="Try another search term or upload profile screenshots to populate the roster." />
            )}
          </Panel>

          <Panel
            className="order-2 xl:sticky xl:top-[96px] xl:self-start"
            title="Spotlight Profile"
            subtitle={profile ? `${profile.name} • live weekly context plus progression history` : 'Select a player to inspect profile detail'}
          >
            {selectedGovernor && profile ? (
              <motion.div key={selectedGovernor.id} initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }} className="space-y-6">
                <div className="space-y-4 rounded-[28px] border border-white/10 bg-[linear-gradient(145deg,rgba(14,19,31,0.94),rgba(8,11,19,0.92))] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill label={profile.allianceTag || 'No alliance'} tone={allianceTone(profile.allianceTag || '')} />
                        <StatusPill label={profile.currentStatus} tone={statusTone(profile.currentStatus as ComplianceState)} />
                        <StatusPill label={`ID ${profile.governorId || 'unknown'}`} tone="neutral" />
                      </div>
                      <div>
                        <h2 className="font-heading text-3xl text-white">{profile.name}</h2>
                        <p className="mt-2 text-sm text-white/56">{profile.allianceLabel}</p>
                      </div>
                    </div>
                    <div className="rounded-[24px] border border-white/10 bg-white/4 px-5 py-4 text-right">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-white/36">Latest Power</p>
                      <p className="mt-2 font-heading text-3xl text-white">{formatCompactNumber(profile.latestPower)}</p>
                      <p className="mt-2 text-sm text-white/48">{profile.snapshotCount} snapshots tracked</p>
                    </div>
                  </div>
                  <MetricStrip
                    items={[
                      {
                        label: 'Best Contribution',
                        value: profileSummary.bestContribution?.metrics?.contributionPoints
                          ? formatCompactNumber(profileSummary.bestContribution.metrics.contributionPoints)
                          : '—',
                        accent: 'teal',
                      },
                      {
                        label: 'Best Power Week',
                        value: profileSummary.bestPower?.metrics?.powerGrowth
                          ? formatCompactNumber(profileSummary.bestPower.metrics.powerGrowth)
                          : '—',
                        accent: 'gold',
                      },
                      {
                        label: 'Current Week',
                        value: weeklyBoard?.event?.weekKey ? formatWeekShort(weeklyBoard.event.weekKey) : '—',
                        accent: 'slate',
                      },
                    ]}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {profile.metrics.map((metric) => (
                    <Card key={metric.label} className="border-white/10 bg-white/4">
                      <CardContent className="space-y-3 p-5">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">{metric.label}</p>
                        <p className="font-heading text-2xl text-white">{metric.value != null ? formatCompactNumber(metric.value) : 'N/A'}</p>
                        <p className="text-sm text-white/48">Current week view</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </motion.div>
            ) : loadingList ? (
              <SkeletonSet rows={5} />
            ) : (
              <EmptyState title="No player selected" description="Search the directory or upload profile data to build a spotlight-ready roster." />
            )}
          </Panel>
        </div>

        {selectedGovernor ? (
          <>
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <Panel title="Event Progression" subtitle="Power, kill points, and deads across recorded snapshots.">
                {loadingProfile ? (
                  <SkeletonSet rows={4} />
                ) : timeline && timeline.length > 0 ? (
                  <GrowthLineChart
                    timeline={timeline.map((entry) => ({
                      eventName: entry.event.name,
                      power: Number(entry.power),
                      killPoints: Number(entry.killPoints),
                      deads: Number(entry.deads),
                    }))}
                  />
                ) : (
                  <EmptyState title="No progression history" description="This player does not have enough event snapshots for a timeline yet." />
                )}
              </Panel>

              <Panel title="Weekly Trend" subtitle="Rolling weekly metrics for contribution, fort, power, and KP growth.">
                {loadingProfile ? (
                  <SkeletonSet rows={4} />
                ) : weeklyHistory && weeklyHistory.some((entry) => entry.metrics) ? (
                  <div className="space-y-5">
                    <WeeklyActivityLineChart
                      timeline={[...(weeklyHistory || [])]
                        .reverse()
                        .filter((entry) => entry.metrics)
                        .map((entry) => ({
                          weekName: formatWeekShort(entry.weekKey),
                          contributionPoints: Number(entry.metrics?.contributionPoints || 0),
                          fortDestroying: Number(entry.metrics?.fortDestroying || 0),
                          powerGrowth: Number(entry.metrics?.powerGrowth || 0),
                          killPointsGrowth: Number(entry.metrics?.killPointsGrowth || 0),
                        }))}
                    />
                    <MetricStrip
                      items={[
                        {
                          label: 'Best Contribution Week',
                          value: profileSummary.bestContribution ? formatWeekShort(profileSummary.bestContribution.weekKey) : '—',
                          accent: 'teal',
                        },
                        {
                          label: 'Best Power Week',
                          value: profileSummary.bestPower ? formatWeekShort(profileSummary.bestPower.weekKey) : '—',
                          accent: 'gold',
                        },
                        {
                          label: 'History Rows',
                          value: `${weeklyHistory?.length || 0}`,
                          accent: 'slate',
                        },
                      ]}
                    />
                  </div>
                ) : (
                  <EmptyState title="No weekly trend yet" description="Weekly activity history becomes available after enough weekly boards have been ingested." />
                )}
              </Panel>
            </div>

            <Panel title="Recent Movement" subtitle={`${selectedGovernor.name} across the latest weekly checkpoints.`}>
              {loadingProfile ? (
                <SkeletonSet rows={4} />
              ) : weeklyHistory && weeklyHistory.length ? (
                <DataTableLite
                  rows={weeklyHistory}
                  rowKey={(row) => row.weekKey}
                  columns={historyColumns}
                  emptyLabel="No weekly history found for this player."
                />
              ) : (
                <EmptyState title="No weekly history" description="This player has not been captured in the last weekly boards yet." />
              )}
            </Panel>
          </>
        ) : null}
      </SessionGate>
    </div>
  );
}
