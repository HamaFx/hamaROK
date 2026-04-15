'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  Shield,
  Sparkles,
  Table2,
  TrendingUp,
  Trophy,
  XCircle,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  DataTableLite,
  EmptyState,
  FilterBar,
  KpiCard,
  MetricStrip,
  PageHero,
  Panel,
  StatusPill,
} from '@/components/ui/primitives';
import { csvValue, downloadCsv, formatMetric, toSafeBigInt } from '@/features/shared/formatters';

const ALL_VALUE = '__all__';
const PRESET_NONE = '__none__';

type ActivityViewMode = 'table' | 'cards';
type ActivitySortKey = 'rank' | 'player' | 'contribution' | 'fort' | 'power' | 'kp' | 'overall';

interface WeekOption {
  id: string;
  name: string;
  weekKey: string;
  startsAt: string | null;
  rankingSnapshotCount: number;
  snapshotCount: number;
}

interface AllianceSummary {
  allianceTag: string;
  allianceLabel: string;
  members: number;
  passCount: number;
  failCount: number;
  partialCount: number;
  noStandardCount: number;
  totalContribution: string;
  totalFortDestroying: string;
  totalPowerGrowth: string;
  totalKillPointsGrowth: string;
}

interface ActivityRow {
  governorDbId: string;
  governorId: string;
  governorName: string;
  allianceTag: string;
  allianceLabel: string;
  contributionPoints: string;
  fortDestroying: string;
  powerGrowth: string | null;
  killPointsGrowth: string | null;
  currentPower: string;
  previousPower: string;
  currentKillPoints: string;
  previousKillPoints: string;
  powerBaselineReady: boolean;
  killPointsBaselineReady: boolean;
  standards: {
    contributionPoints: string | null;
    fortDestroying: string | null;
    powerGrowth: string | null;
    killPointsGrowth: string | null;
  };
  compliance: {
    contributionPoints: 'PASS' | 'FAIL' | 'NO_STANDARD' | 'NO_BASELINE';
    fortDestroying: 'PASS' | 'FAIL' | 'NO_STANDARD' | 'NO_BASELINE';
    powerGrowth: 'PASS' | 'FAIL' | 'NO_STANDARD' | 'NO_BASELINE';
    killPointsGrowth: 'PASS' | 'FAIL' | 'NO_STANDARD' | 'NO_BASELINE';
    overall: 'PASS' | 'FAIL' | 'PARTIAL' | 'NO_STANDARD';
  };
}

interface ActivityResponse {
  event: {
    id: string;
    name: string;
    weekKey: string | null;
    startsAt: string | null;
  };
  previousEvent: {
    id: string;
    name: string;
    weekKey: string | null;
  } | null;
  rows: ActivityRow[];
  summary: {
    membersTracked: number;
    noPowerBaselineCount: number;
    noKillPointsBaselineCount: number;
    unresolvedIdentityCount: number;
    allianceSummary: AllianceSummary[];
    topContribution: ActivityRow[];
    topPowerGrowth: ActivityRow[];
    topFortDestroying: ActivityRow[];
    topKillPointsGrowth: ActivityRow[];
  };
}

interface ActivityFilterPreset {
  id: string;
  name: string;
  weekKey: string;
  allianceFilter: string;
  sortKey: ActivitySortKey;
  sortDir: 'asc' | 'desc';
  viewMode: ActivityViewMode;
  denseRows: boolean;
  createdAt: string;
}

const ALLIANCE_FILTER_OPTIONS = [
  { value: '', label: 'All Alliances' },
  { value: 'GODt', label: '[GODt]' },
  { value: 'V57', label: '[V57]' },
  { value: 'P57R', label: '[P57R]' },
];

function overallTone(status: ActivityRow['compliance']['overall']): 'good' | 'bad' | 'warn' | 'neutral' {
  if (status === 'PASS') return 'good';
  if (status === 'FAIL') return 'bad';
  if (status === 'PARTIAL') return 'warn';
  return 'neutral';
}

function metricTone(status: ActivityRow['compliance']['contributionPoints']): 'good' | 'bad' | 'warn' | 'neutral' {
  if (status === 'PASS') return 'good';
  if (status === 'FAIL') return 'bad';
  if (status === 'NO_BASELINE') return 'warn';
  return 'neutral';
}

export default function ActivityScreen() {
  const { workspaceId, accessToken, ready, loading: sessionLoading, error: sessionError, refreshSession } = useWorkspaceSession();
  const [weeks, setWeeks] = useState<WeekOption[]>([]);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>('');
  const [allianceFilter, setAllianceFilter] = useState<string>('');
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<ActivitySortKey>('contribution');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<ActivityViewMode>('cards');
  const [denseRows, setDenseRows] = useState(true);
  const [presets, setPresets] = useState<ActivityFilterPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [uiNotice, setUiNotice] = useState<string | null>(null);

  const presetStorageKey = useMemo(() => `hama:activity:presets:${workspaceId || 'unknown'}`, [workspaceId]);

  const loadWeeks = useCallback(async () => {
    if (!ready) return;
    try {
      const res = await fetch(`/api/v2/activity/weeks?workspaceId=${encodeURIComponent(workspaceId)}`, {
        headers: { 'x-access-token': accessToken },
      });
      const payload = await res.json();
      if (res.ok && Array.isArray(payload?.data)) {
        const nextWeeks = payload.data as WeekOption[];
        setWeeks(nextWeeks);
        if (!selectedWeekKey && nextWeeks.length > 0) {
          setSelectedWeekKey(nextWeeks[0].weekKey);
        }
      }
    } catch {
      // keep page usable without week metadata
    }
  }, [workspaceId, accessToken, ready, selectedWeekKey]);

  const loadActivity = useCallback(
    async (weekKey?: string) => {
      if (!ready) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ workspaceId });
        const wk = weekKey || selectedWeekKey;
        if (wk) params.set('weekKey', wk);

        const res = await fetch(`/api/v2/activity/weekly?${params.toString()}`, {
          headers: { 'x-access-token': accessToken },
        });
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.error?.message || 'Failed to load activity data.');
        }
        setData(payload.data as ActivityResponse);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to load activity data.');
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, accessToken, ready, selectedWeekKey]
  );

  useEffect(() => {
    if (ready) void loadWeeks();
  }, [ready, loadWeeks]);

  useEffect(() => {
    if (ready && selectedWeekKey) void loadActivity(selectedWeekKey);
  }, [ready, selectedWeekKey, loadActivity]);

  useEffect(() => {
    if (!ready) return;
    try {
      const raw = localStorage.getItem(presetStorageKey);
      const parsed = raw ? (JSON.parse(raw) as ActivityFilterPreset[]) : [];
      setPresets(Array.isArray(parsed) ? parsed : []);
    } catch {
      setPresets([]);
    }
  }, [ready, presetStorageKey]);

  useEffect(() => {
    if (!uiNotice) return;
    const timer = window.setTimeout(() => setUiNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [uiNotice]);

  const currentWeekIndex = useMemo(() => weeks.findIndex((week) => week.weekKey === selectedWeekKey), [weeks, selectedWeekKey]);

  const goPreviousWeek = () => {
    if (currentWeekIndex < weeks.length - 1) setSelectedWeekKey(weeks[currentWeekIndex + 1].weekKey);
  };

  const goNextWeek = () => {
    if (currentWeekIndex > 0) setSelectedWeekKey(weeks[currentWeekIndex - 1].weekKey);
  };

  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    if (!allianceFilter) return data.rows;
    return data.rows.filter((row) => row.allianceTag === allianceFilter);
  }, [data?.rows, allianceFilter]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
    const compareBigIntMaybe = (a: string | null, b: string | null) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      const diff = toSafeBigInt(a) - toSafeBigInt(b);
      if (diff === BigInt(0)) return 0;
      return diff > BigInt(0) ? 1 : -1;
    };

    rows.sort((a, b) => {
      if (sortKey === 'rank') return 0;
      if (sortKey === 'player') return a.governorName.localeCompare(b.governorName);
      if (sortKey === 'overall') return a.compliance.overall.localeCompare(b.compliance.overall);
      if (sortKey === 'contribution') {
        const diff = toSafeBigInt(a.contributionPoints) - toSafeBigInt(b.contributionPoints);
        return diff === BigInt(0) ? 0 : diff > BigInt(0) ? 1 : -1;
      }
      if (sortKey === 'fort') {
        const diff = toSafeBigInt(a.fortDestroying) - toSafeBigInt(b.fortDestroying);
        return diff === BigInt(0) ? 0 : diff > BigInt(0) ? 1 : -1;
      }
      if (sortKey === 'power') return compareBigIntMaybe(a.powerGrowth, b.powerGrowth);
      return compareBigIntMaybe(a.killPointsGrowth, b.killPointsGrowth);
    });

    if (sortDir === 'desc') rows.reverse();
    return rows;
  }, [filteredRows, sortDir, sortKey]);

  const handleSort = useCallback(
    (nextKey: string) => {
      const key = nextKey as ActivitySortKey;
      if (key === sortKey) {
        setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
        return;
      }
      setSortKey(key);
      setSortDir(key === 'player' || key === 'overall' ? 'asc' : 'desc');
    },
    [sortKey]
  );

  const filteredSummary = useMemo(() => {
    const alliances = data?.summary?.allianceSummary || [];
    if (!allianceFilter) return alliances;
    return alliances.filter((row) => row.allianceTag === allianceFilter);
  }, [data?.summary?.allianceSummary, allianceFilter]);

  const kpis = useMemo(() => {
    const rows = sortedRows;
    return {
      total: rows.length,
      pass: rows.filter((row) => row.compliance.overall === 'PASS').length,
      fail: rows.filter((row) => row.compliance.overall === 'FAIL').length,
      partial: rows.filter((row) => row.compliance.overall === 'PARTIAL').length,
      noPowerBaseline: rows.filter((row) => !row.powerBaselineReady).length,
      noKillPointsBaseline: rows.filter((row) => !row.killPointsBaselineReady).length,
      passRate: rows.length ? Math.round((rows.filter((row) => row.compliance.overall === 'PASS').length / rows.length) * 100) : 0,
    };
  }, [sortedRows]);

  const latestWeekKey = weeks[0]?.weekKey || '';
  const isHistoricalWeek = Boolean(selectedWeekKey && latestWeekKey && selectedWeekKey !== latestWeekKey);

  const savePreset = useCallback(() => {
    if (!ready) return;
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1000)}`;

    const nextPreset: ActivityFilterPreset = {
      id,
      name,
      weekKey: selectedWeekKey,
      allianceFilter,
      sortKey,
      sortDir,
      viewMode,
      denseRows,
      createdAt: new Date().toISOString(),
    };

    const next = [nextPreset, ...presets].slice(0, 20);
    setPresets(next);
    setSelectedPresetId(id);
    setPresetName('');
    localStorage.setItem(presetStorageKey, JSON.stringify(next));
    setUiNotice(`Saved preset: ${name}`);
  }, [ready, presetName, presets, selectedWeekKey, allianceFilter, sortKey, sortDir, viewMode, denseRows, presetStorageKey]);

  const applyPreset = useCallback(
    (presetId: string) => {
      setSelectedPresetId(presetId);
      if (!presetId) return;
      const target = presets.find((preset) => preset.id === presetId);
      if (!target) return;
      setAllianceFilter(target.allianceFilter);
      setSortKey(target.sortKey);
      setSortDir(target.sortDir);
      setViewMode(target.viewMode);
      setDenseRows(target.denseRows);
      if (target.weekKey && weeks.some((week) => week.weekKey === target.weekKey)) {
        setSelectedWeekKey(target.weekKey);
        window.setTimeout(() => void loadActivity(target.weekKey), 0);
      }
      setUiNotice(`Applied preset: ${target.name}`);
    },
    [presets, weeks, loadActivity]
  );

  const deleteSelectedPreset = useCallback(() => {
    if (!selectedPresetId) return;
    const target = presets.find((preset) => preset.id === selectedPresetId);
    const next = presets.filter((preset) => preset.id !== selectedPresetId);
    setPresets(next);
    setSelectedPresetId('');
    localStorage.setItem(presetStorageKey, JSON.stringify(next));
    if (target) setUiNotice(`Deleted preset: ${target.name}`);
  }, [selectedPresetId, presets, presetStorageKey]);

  const resetFilters = useCallback(() => {
    setAllianceFilter('');
    setSortKey('contribution');
    setSortDir('desc');
    setViewMode('cards');
    setDenseRows(true);
    setSelectedPresetId('');
  }, []);

  const exportActivityCsv = useCallback(() => {
    if (!sortedRows.length || !data?.event) return;
    const headers = ['Rank', 'Player', 'Alliance', 'Governor ID', 'Contribution', 'Fort Destroying', 'Power Growth', 'KP Growth', 'Contribution Status', 'Fort Status', 'Power Status', 'KP Status', 'Overall', 'Week Key', 'Event Name'];
    const body = sortedRows.map((row, index) => [
      index + 1,
      row.governorName,
      row.allianceTag,
      row.governorId,
      row.contributionPoints,
      row.fortDestroying,
      row.powerGrowth || '',
      row.killPointsGrowth || '',
      row.compliance.contributionPoints,
      row.compliance.fortDestroying,
      row.compliance.powerGrowth,
      row.compliance.killPointsGrowth,
      row.compliance.overall,
      data.event.weekKey || selectedWeekKey,
      data.event.name,
    ]);

    const lines = [headers.map((cell) => csvValue(cell)).join(',')].concat(body.map((line) => line.map((cell) => csvValue(cell)).join(',')));
    const filename = `activity-${data.event.weekKey || selectedWeekKey || 'current'}-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(filename, lines);
    setUiNotice(`Exported ${sortedRows.length} rows.`);
  }, [sortedRows, data?.event, selectedWeekKey]);

  const columns = useMemo(
    () => [
      {
        key: 'rank',
        label: '#',
        sortable: true,
        render: (_row: ActivityRow, index: number) => <StatusPill label={`#${index + 1}`} tone="neutral" />,
      },
      {
        key: 'player',
        label: 'Player',
        sortable: true,
        render: (row: ActivityRow) => (
          <div className="space-y-2">
            <strong className="font-heading text-base text-white">{row.governorName}</strong>
            <div className="flex flex-wrap gap-2">
              <StatusPill label={row.allianceTag} tone={row.allianceTag === 'GODt' ? 'warn' : row.allianceTag === 'V57' ? 'info' : 'neutral'} />
              <StatusPill label={`ID ${row.governorId}`} tone="neutral" />
            </div>
          </div>
        ),
      },
      {
        key: 'contribution',
        label: 'Contribution',
        sortable: true,
        className: 'text-right',
        render: (row: ActivityRow) => (
          <div className="flex flex-col items-end gap-2">
            <span className="font-heading text-lg text-white">{formatMetric(row.contributionPoints)}</span>
            <StatusPill label={row.compliance.contributionPoints} tone={metricTone(row.compliance.contributionPoints)} />
          </div>
        ),
      },
      {
        key: 'fort',
        label: 'Fort',
        sortable: true,
        className: 'text-right',
        render: (row: ActivityRow) => (
          <div className="flex flex-col items-end gap-2">
            <span className="font-heading text-lg text-white">{formatMetric(row.fortDestroying)}</span>
            <StatusPill label={row.compliance.fortDestroying} tone={metricTone(row.compliance.fortDestroying)} />
          </div>
        ),
      },
      {
        key: 'power',
        label: 'Power Growth',
        sortable: true,
        className: 'text-right',
        render: (row: ActivityRow) => (
          <div className="flex flex-col items-end gap-2">
            <span className="font-heading text-lg text-white">{row.powerGrowth != null ? formatMetric(row.powerGrowth) : 'N/A'}</span>
            <StatusPill label={row.compliance.powerGrowth} tone={metricTone(row.compliance.powerGrowth)} />
          </div>
        ),
      },
      {
        key: 'kp',
        label: 'KP Growth',
        sortable: true,
        className: 'text-right',
        render: (row: ActivityRow) => (
          <div className="flex flex-col items-end gap-2">
            <span className="font-heading text-lg text-white">{row.killPointsGrowth != null ? formatMetric(row.killPointsGrowth) : 'N/A'}</span>
            <StatusPill label={row.compliance.killPointsGrowth} tone={metricTone(row.compliance.killPointsGrowth)} />
          </div>
        ),
      },
      {
        key: 'overall',
        label: 'Status',
        sortable: true,
        render: (row: ActivityRow) => <StatusPill label={row.compliance.overall} tone={overallTone(row.compliance.overall)} />,
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHero
        title="Stats"
        subtitle="A player-facing weekly statboard with top performers, alliance pressure, and compliance data kept intact under a cleaner, mobile-first surface."
        badges={[
          selectedWeekKey ? `Week ${selectedWeekKey}` : 'Week pending',
          `${sortedRows.length} visible players`,
          data?.previousEvent ? `vs ${data.previousEvent.name}` : 'No previous week',
        ]}
        actions={
          <>
            <Button asChild variant="outline" className="rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white">
              <Link href="/rankings">
                <Trophy data-icon="inline-start" /> Rankings
              </Link>
            </Button>
            <Button variant="outline" className="rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white" onClick={exportActivityCsv} disabled={!sortedRows.length}>
              <Download data-icon="inline-start" /> Export CSV
            </Button>
          </>
        }
      />

      <SessionGate ready={ready} loading={sessionLoading} error={sessionError} onRetry={() => void refreshSession()}>
        {error ? <InlineError message={error} /> : null}

        <Panel title="Weekly Filters" subtitle="Switch weeks, scope to one alliance, and preserve favorite views.">
          <div className="space-y-4">
            <div className="sticky top-[78px] z-20 -mx-1 rounded-[24px] border border-white/10 bg-[rgba(8,11,19,0.94)] p-3.5 shadow-[0_14px_36px_rgba(0,0,0,0.32)] backdrop-blur xl:static xl:mx-0 xl:border-white/8 xl:bg-black/20 xl:shadow-none xl:backdrop-blur-none">
              <div className="grid gap-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                <Button variant="outline" className="w-full rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white sm:w-auto" onClick={goPreviousWeek} disabled={currentWeekIndex >= weeks.length - 1 || loading}>
                  <ArrowLeft data-icon="inline-start" /> Older
                </Button>
                <Select value={selectedWeekKey || (weeks[0]?.weekKey ?? ALL_VALUE)} onValueChange={setSelectedWeekKey}>
                  <SelectTrigger className="w-full min-w-0 rounded-full border-white/10 bg-white/4 text-white"><SelectValue placeholder="Select week" /></SelectTrigger>
                  <SelectContent className="border-white/10 bg-[rgba(8,10,16,0.98)] text-white">
                    {weeks.length ? weeks.map((week) => (
                      <SelectItem key={week.id} value={week.weekKey}>{week.name}</SelectItem>
                    )) : <SelectItem value={ALL_VALUE}>No weeks available</SelectItem>}
                  </SelectContent>
                </Select>
                <Button variant="outline" className="w-full rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white sm:w-auto" onClick={goNextWeek} disabled={currentWeekIndex <= 0 || loading}>
                  Newer <ArrowRight data-icon="inline-end" />
                </Button>
              </div>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Select value={allianceFilter || ALL_VALUE} onValueChange={(value) => setAllianceFilter(value === ALL_VALUE ? '' : value)}>
                  <SelectTrigger className="w-full min-w-0 rounded-full border-white/10 bg-white/4 text-white"><SelectValue placeholder="Alliance" /></SelectTrigger>
                  <SelectContent className="border-white/10 bg-[rgba(8,10,16,0.98)] text-white">
                    {ALLIANCE_FILTER_OPTIONS.map((option) => (
                      <SelectItem key={option.label} value={option.value || ALL_VALUE}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={viewMode} onValueChange={(value) => setViewMode(value as ActivityViewMode)}>
                  <SelectTrigger className="w-full min-w-0 rounded-full border-white/10 bg-white/4 text-white"><SelectValue placeholder="View" /></SelectTrigger>
                  <SelectContent className="border-white/10 bg-[rgba(8,10,16,0.98)] text-white">
                    <SelectItem value="cards">Cards</SelectItem>
                    <SelectItem value="table">Table</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" className="w-full rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white sm:w-auto" onClick={() => setDenseRows((prev) => !prev)}>
                  {denseRows ? 'Comfort spacing' : 'Compact rows'}
                </Button>
              </div>
            </div>

            <FilterBar className="rounded-[22px] bg-black/20 p-3.5">
              {isHistoricalWeek ? <StatusPill label="Historical week" tone="neutral" /> : null}
              {data?.event?.startsAt ? <StatusPill label={`Starts ${new Date(data.event.startsAt).toLocaleDateString()}`} tone="neutral" /> : null}
              <StatusPill label={`No power baseline ${kpis.noPowerBaseline}`} tone={kpis.noPowerBaseline ? 'warn' : 'good'} />
              <StatusPill label={`No KP baseline ${kpis.noKillPointsBaseline}`} tone={kpis.noKillPointsBaseline ? 'warn' : 'good'} />
            </FilterBar>

            <details className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <summary className="cursor-pointer list-none text-sm font-medium text-white">
                Advanced presets
              </summary>
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                  <Select value={selectedPresetId || PRESET_NONE} onValueChange={(value) => applyPreset(value === PRESET_NONE ? '' : value)}>
                    <SelectTrigger className="w-full min-w-0 rounded-full border-white/10 bg-white/4 text-white"><SelectValue placeholder="Saved presets" /></SelectTrigger>
                    <SelectContent className="border-white/10 bg-[rgba(8,10,16,0.98)] text-white">
                      <SelectItem value={PRESET_NONE}>Saved presets</SelectItem>
                      {presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Preset name" className="w-full rounded-full border-white/10 bg-white/4 text-white placeholder:text-white/28" />
                </div>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <Button variant="outline" className="w-full rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white" onClick={savePreset}>Save Preset</Button>
                  <Button variant="outline" className="w-full rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white" onClick={deleteSelectedPreset} disabled={!selectedPresetId}>Delete</Button>
                  <Button variant="outline" className="w-full rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white" onClick={resetFilters}>Reset</Button>
                </div>
              </div>
            </details>

            {uiNotice ? <p className="text-sm text-white/56">{uiNotice}</p> : null}
          </div>
        </Panel>

        {data ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Tracked Players" value={kpis.total} hint="Members with activity rows this week" tone="info" icon={<Activity className="size-5" />} />
              <KpiCard label="Pass Rate" value={`${kpis.passRate}%`} hint={`${kpis.pass} pass / ${kpis.total} scored`} tone="good" icon={<CheckCircle2 className="size-5" />} animated={false} />
              <KpiCard label="Fails" value={kpis.fail} hint="Below the current alliance standards" tone={kpis.fail > 0 ? 'bad' : 'good'} icon={<XCircle className="size-5" />} />
              <KpiCard label="Partial" value={kpis.partial} hint="Mixed metric outcomes inside the same row" tone={kpis.partial > 0 ? 'warn' : 'neutral'} icon={<TrendingUp className="size-5" />} />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <Panel title="Alliance Pressure" subtitle="How each alliance is converting players into passing weeks.">
                <div className="grid gap-4 sm:grid-cols-2">
                  {filteredSummary.map((alliance) => {
                    const total = Math.max(1, alliance.members || 0);
                    const passPercent = Math.round((alliance.passCount / total) * 100);
                    return (
                      <Card key={alliance.allianceTag} className="border-white/10 bg-white/4">
                        <CardContent className="space-y-4 p-5">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-heading text-lg text-white">{alliance.allianceLabel}</p>
                              <p className="mt-1 text-sm text-white/56">{alliance.members} tracked players</p>
                            </div>
                            <StatusPill label={`${passPercent}%`} tone={passPercent >= 70 ? 'good' : passPercent >= 45 ? 'warn' : 'bad'} />
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-white/8">
                            <div className="h-full rounded-full bg-[linear-gradient(90deg,#5a7fff,#7ce6ff)]" style={{ width: `${passPercent}%` }} />
                          </div>
                          <MetricStrip items={[
                            { label: 'Pass', value: alliance.passCount, accent: 'teal' },
                            { label: 'Fail', value: alliance.failCount, accent: 'rose' },
                            { label: 'Fort', value: formatMetric(alliance.totalFortDestroying), accent: 'slate' },
                          ]} />
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </Panel>

              <Panel title="Top Performers" subtitle="The best weekly rows across the major statboards.">
                <div className="grid gap-4 lg:grid-cols-2">
                  {[
                    { title: 'Contribution', rows: data.summary.topContribution, key: 'contributionPoints' as const, icon: Sparkles },
                    { title: 'Fort Destroying', rows: data.summary.topFortDestroying, key: 'fortDestroying' as const, icon: Shield },
                    { title: 'Power Growth', rows: data.summary.topPowerGrowth, key: 'powerGrowth' as const, icon: TrendingUp },
                    { title: 'KP Growth', rows: data.summary.topKillPointsGrowth, key: 'killPointsGrowth' as const, icon: Trophy },
                  ].map((lane) => {
                    const Icon = lane.icon;
                    return (
                      <Card key={lane.title} className="border-white/10 bg-white/4">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 font-heading text-base text-white">
                            <Icon className="size-4 text-white/68" /> {lane.title}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {lane.rows.slice(0, 4).map((row, index) => (
                            <div key={`${lane.title}-${row.governorDbId}`} className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/10 px-4 py-3">
                              <div>
                                <p className="text-sm font-medium text-white">{row.governorName}</p>
                                <p className="text-xs text-white/52">{row.allianceLabel}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-heading text-lg text-white">{formatMetric(row[lane.key])}</p>
                                <p className="text-xs text-white/42">#{index + 1}</p>
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </Panel>
            </div>

            <Panel
              title="Player Compliance"
              subtitle={`${filteredRows.length} members • ${data.event.name}`}
              actions={
                <ToggleGroup type="single" value={viewMode} onValueChange={(value) => value && setViewMode(value as ActivityViewMode)}>
                  <ToggleGroupItem value="cards" className="rounded-full border border-white/10 bg-white/5 px-4 text-xs uppercase tracking-[0.16em] text-white/64 data-[state=on]:border-sky-300/20 data-[state=on]:bg-sky-300/12 data-[state=on]:text-white">
                    Cards
                  </ToggleGroupItem>
                  <ToggleGroupItem value="table" className="rounded-full border border-white/10 bg-white/5 px-4 text-xs uppercase tracking-[0.16em] text-white/64 data-[state=on]:border-sky-300/20 data-[state=on]:bg-sky-300/12 data-[state=on]:text-white">
                    <Table2 className="mr-2 size-4" /> Table
                  </ToggleGroupItem>
                </ToggleGroup>
              }
            >
              {sortedRows.length ? (
                viewMode === 'table' ? (
                  <DataTableLite
                    stickyFirst
                    dense={denseRows}
                    mobileCards
                    rows={sortedRows}
                    rowKey={(row) => row.governorDbId}
                    columns={columns}
                    onSort={handleSort}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    emptyLabel="No activity rows found for these filters."
                  />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {sortedRows.map((row, index) => (
                      <motion.article key={row.governorDbId} initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, delay: Math.min(index * 0.015, 0.16) }} className="rounded-[26px] border border-white/10 bg-[rgba(11,15,24,0.92)] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.24)]">
                        <div className="flex items-center justify-between gap-3">
                          <StatusPill label={`#${index + 1}`} tone="neutral" />
                          <StatusPill label={row.compliance.overall} tone={overallTone(row.compliance.overall)} />
                        </div>
                        <div className="mt-4 space-y-2">
                          <p className="font-heading text-xl text-white">{row.governorName}</p>
                          <div className="flex flex-wrap gap-2">
                            <StatusPill label={row.allianceTag} tone={row.allianceTag === 'GODt' ? 'warn' : row.allianceTag === 'V57' ? 'info' : 'neutral'} />
                            <StatusPill label={`ID ${row.governorId}`} tone="neutral" />
                          </div>
                        </div>
                        <div className="mt-5 grid grid-cols-2 gap-3">
                          {[
                            { label: 'Contribution', value: row.contributionPoints, status: row.compliance.contributionPoints },
                            { label: 'Fort', value: row.fortDestroying, status: row.compliance.fortDestroying },
                            { label: 'Power', value: row.powerGrowth, status: row.compliance.powerGrowth },
                            { label: 'KP', value: row.killPointsGrowth, status: row.compliance.killPointsGrowth },
                          ].map((metric) => (
                            <div key={`${row.governorDbId}-${metric.label}`} className="rounded-2xl border border-white/8 bg-white/4 p-3">
                              <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">{metric.label}</p>
                              <p className="mt-2 font-heading text-lg text-white">{metric.value != null ? formatMetric(metric.value) : 'N/A'}</p>
                              <div className="mt-2">
                                <StatusPill label={metric.status} tone={metricTone(metric.status)} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.article>
                    ))}
                  </div>
                )
              ) : (
                <EmptyState title="No activity rows" description="Upload ranking screenshots and governor profiles to begin weekly tracking." action={<Button asChild variant="outline" className="rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white"><Link href="/upload">Upload Screenshots</Link></Button>} />
              )}
            </Panel>
          </>
        ) : !loading ? (
          <EmptyState title="Activity not loaded" description="Select a week to view the player-facing statboard." />
        ) : null}
      </SessionGate>
    </div>
  );
}
