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
import { GrowthLineChart, WeeklyActivityLineChart, WeeklyRadarChart } from '@/components/Charts';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DataTableLite,
  EmptyState,
  FilterBar,
  KpiCard,
  MetricStrip,
  PageHero,
  Panel,
  RowDetailDrawer,
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
  deadsGrowth?: string | null;
  t4KillsGrowth?: string | null;
  t5KillsGrowth?: string | null;
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
    t4KillsGrowth?: string | null;
    t5KillsGrowth?: string | null;
    deadsGrowth?: string | null;
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
            <strong className="font-heading text-base text-tier-1">{formatWeekShort(row.weekKey)}</strong>
            <p className="text-xs text-tier-3">{row.weekName}</p>
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

  const progressionContent = loadingProfile ? (
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
  );

  const trendContent = loadingProfile ? (
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
      <WeeklyRadarChart
        timeline={[...(weeklyHistory || [])]
          .filter((entry) => entry.metrics)
          .map((entry) => ({
            weekName: formatWeekShort(entry.weekKey),
            contributionPoints: Number(entry.metrics?.contributionPoints || 0),
            fortDestroying: Number(entry.metrics?.fortDestroying || 0),
            t4KillsGrowth: Number(entry.metrics?.t4KillsGrowth || 0),
            t5KillsGrowth: Number(entry.metrics?.t5KillsGrowth || 0),
            deadsGrowth: Number(entry.metrics?.deadsGrowth || 0),
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
  );

  const movementContent = loadingProfile ? (
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
  );

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
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
            <Button asChild variant="outline" className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1">
              <Link href="/rankings">
                <Crown data-icon="inline-start" /> Rankings
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1">
              <Link href="/compare">
                <Swords data-icon="inline-start" /> Compare
              </Link>
            </Button>
          </>
        }
      />

      <SessionGate ready={ready} loading={sessionLoading} error={sessionError} onRetry={() => void refreshSession()}>
        {error ? <InlineError message={error} /> : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <KpiCard label="Tracked Players" value={kpis.tracked} hint="Roster identities indexed in this workspace" tone="info" icon={<Users className="size-5" />} />
          <KpiCard label="Visible in Directory" value={kpis.visible} hint="Rows after current alliance and search filters" tone="neutral" icon={<Search className="size-5" />} />
          <KpiCard label="Avg Snapshots" value={kpis.avgSnapshots} hint="Average snapshot depth across the visible roster" tone="good" icon={<LineChart className="size-5" />} />
          <KpiCard label="100M+ Power" value={kpis.highPower} hint="Profiles with high current power in the visible set" tone="warn" icon={<TrendingUp className="size-5" />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <Panel
            className="order-2 xl:order-1"
            title="Player Directory"
            subtitle="Search the roster, filter by alliance, and open a profile spotlight."
            actions={
              <FilterBar className="w-full items-stretch gap-2.5 sm:items-center">
                <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-tier-3" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search player or governor ID"
                    className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] pl-11 text-tier-1 placeholder:text-tier-3 "
                  />
                </div>
                <Select value={allianceFilter || ALL_VALUE} onValueChange={(value) => setAllianceFilter(value === ALL_VALUE ? '' : value)}>
                  <SelectTrigger className="w-full min-w-0 rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 sm:min-w-40"><SelectValue placeholder="Alliance" /></SelectTrigger>
                  <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
                    <SelectItem value={ALL_VALUE}>All Alliances</SelectItem>
                    <SelectItem value="GODt">[GODt]</SelectItem>
                    <SelectItem value="V57">[V57]</SelectItem>
                    <SelectItem value="P57R">[P57R]</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sortKey} onValueChange={(value) => setSortKey(value as DirectorySortKey)}>
                  <SelectTrigger className="w-full min-w-0 rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 sm:min-w-40"><SelectValue placeholder="Sort" /></SelectTrigger>
                  <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
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
                      'rounded-[24px] glass-panel p-4 text-left transition-all duration-300 hover:border-white/20 hover:shadow-[0_8px_32px_rgba(0,229,255,0.1)] hover:-translate-y-0.5',
                      row.id === selectedGovernorId && 'border-[color:var(--rok-gold)] bg-[color:color-mix(in_oklab,var(--rok-gold)_15%,transparent)] shadow-[0_0_24px_rgba(216,184,120,0.2)]'
                    )}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill label={`#${index + 1}`} tone="neutral" />
                          <StatusPill label={row.weekly?.allianceTag || row.alliance || 'No alliance'} tone={allianceTone(row.weekly?.allianceTag || row.alliance || '')} />
                          {row.weekly ? <StatusPill label={row.weekly.compliance.overall} tone={statusTone(row.weekly.compliance.overall)} /> : null}
                        </div>
                        <div>
                          <p className="clamp-title-mobile font-heading text-base text-tier-1 min-[390px]:text-lg sm:text-xl" title={row.name}>{row.name}</p>
                          <p className="mt-1 text-xs text-tier-3 min-[390px]:text-[13px] sm:text-sm">ID {row.governorId}</p>
                        </div>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="font-heading text-xl text-tier-1 sm:text-2xl">{formatCompactNumber(row.latestPower)}</p>
                        <p className="mt-1 text-xs text-tier-3">power</p>
                      </div>
                    </div>
                    <div className="mt-4 border-t border-white/5 pt-3 grid grid-cols-3 gap-2.5 text-xs min-[390px]:text-[13px] sm:text-sm">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-tier-3">Forts</p>
                        <p className="mt-1 font-heading text-lg font-bold text-[color:var(--rok-blue)]">{formatCompactNumber(row.weekly?.fortDestroying || '0')}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-tier-3">KP Growth</p>
                        <p className="mt-1 font-heading text-lg font-bold text-[color:var(--rok-red)]">{formatCompactNumber(row.weekly?.killPointsGrowth || '0')}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-tier-3">Deads</p>
                        <p className="mt-1 font-heading text-lg font-bold text-[color:var(--rok-gold)]">{formatCompactNumber(row.weekly?.deadsGrowth || '0')}</p>
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
            className="order-1 xl:order-2 xl:sticky xl:top-[96px] xl:self-start"
            title="Spotlight Profile"
            subtitle={profile ? `${profile.name} • live weekly context plus progression history` : 'Select a player to inspect profile detail'}
          >
            {selectedGovernor && profile ? (
              <motion.div key={selectedGovernor.id} initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }} className="space-y-4 sm:space-y-5">
                <div className="space-y-4 rounded-[20px] surface-2 p-3 min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill label={profile.allianceTag || 'No alliance'} tone={allianceTone(profile.allianceTag || '')} />
                        <StatusPill label={profile.currentStatus} tone={statusTone(profile.currentStatus as ComplianceState)} />
                        <StatusPill label={`ID ${profile.governorId || 'unknown'}`} tone="neutral" />
                      </div>
                      <div>
                        <h2 className="clamp-title-mobile font-heading text-xl text-tier-1 min-[390px]:text-2xl sm:text-3xl" title={profile.name}>{profile.name}</h2>
                        <p className="clamp-secondary mt-1.5 text-xs text-tier-3 min-[390px]:text-[13px] sm:mt-2 sm:text-sm" title={profile.allianceLabel || ''}>{profile.allianceLabel}</p>
                      </div>
                    </div>
                    <div className="rounded-[20px] border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-4 py-3 text-left min-[390px]:rounded-[22px] sm:rounded-[24px] sm:px-5 sm:py-4 sm:text-right">
                      <p className="text-xs  text-tier-3">Latest Power</p>
                      <p className="mt-2 font-heading text-2xl text-tier-1 sm:text-3xl">{formatCompactNumber(profile.latestPower)}</p>
                      <p className="mt-1.5 text-xs text-tier-3 min-[390px]:text-[13px] sm:mt-2 sm:text-sm">{profile.snapshotCount} snapshots tracked</p>
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

                <div className="rounded-[20px] border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3 min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4">
                  <MetricStrip
                    items={[
                      {
                        label: 'Contribution',
                        value: formatCompactNumber(profile.metrics[0]?.value || '0'),
                        accent: 'teal',
                      },
                      {
                        label: 'Power Growth',
                        value: profile.metrics[2]?.value ? formatCompactNumber(profile.metrics[2].value) : 'N/A',
                        accent: 'gold',
                      },
                      {
                        label: 'KP Growth',
                        value: profile.metrics[3]?.value ? formatCompactNumber(profile.metrics[3].value) : 'N/A',
                        accent: 'slate',
                      },
                    ]}
                  />
                  <div className="mt-3">
                    <RowDetailDrawer
                      triggerLabel="Open Full Metric Breakdown"
                      title={`${profile.name} Weekly Metrics`}
                      description="Current week metrics are compact by default and fully expanded in this drawer."
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        {profile.metrics.map((metric) => (
                          <div key={metric.label} className="rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3">
                            <p className="text-xs  text-tier-3">{metric.label}</p>
                            <p className="mt-2 font-heading text-lg text-tier-1">{metric.value != null ? formatCompactNumber(metric.value) : 'N/A'}</p>
                          </div>
                        ))}
                      </div>
                    </RowDetailDrawer>
                  </div>
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
          <Panel
            title="Performance"
            subtitle={`${selectedGovernor.name} progression, weekly trend, and movement in a compact reveal-first layout.`}
          >
            <div className="grid gap-2.5 md:hidden">
              <RowDetailDrawer
                triggerLabel="Event Progression"
                title="Event Progression"
                description="Power, kill points, and deads across recorded snapshots."
              >
                {progressionContent}
              </RowDetailDrawer>
              <RowDetailDrawer
                triggerLabel="Weekly Trend"
                title="Weekly Trend"
                description="Rolling weekly metrics for contribution, fort, power, and KP growth."
              >
                {trendContent}
              </RowDetailDrawer>
              <RowDetailDrawer
                triggerLabel="Recent Movement"
                title="Recent Movement"
                description={`${selectedGovernor.name} across the latest weekly checkpoints.`}
              >
                {movementContent}
              </RowDetailDrawer>
            </div>

            <div className="hidden md:block">
              <Tabs defaultValue="progression" className="space-y-4">
                <TabsList className="flex w-full justify-start gap-2 rounded-full border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-1 overflow-x-auto no-scrollbar whitespace-nowrap">
                  <TabsTrigger value="progression" className="rounded-full px-4 text-xs  data-[state=active]:bg-sky-300/15 data-[state=active]:text-tier-1">Event Progression</TabsTrigger>
                  <TabsTrigger value="trend" className="rounded-full px-4 text-xs  data-[state=active]:bg-sky-300/15 data-[state=active]:text-tier-1">Weekly Trend</TabsTrigger>
                  <TabsTrigger value="movement" className="rounded-full px-4 text-xs  data-[state=active]:bg-sky-300/15 data-[state=active]:text-tier-1">Recent Movement</TabsTrigger>
                </TabsList>
                <TabsContent value="progression">{progressionContent}</TabsContent>
                <TabsContent value="trend">{trendContent}</TabsContent>
                <TabsContent value="movement">{movementContent}</TabsContent>
              </Tabs>
            </div>
          </Panel>
        ) : null}
      </SessionGate>
    </div>
  );
}
