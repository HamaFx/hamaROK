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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  CompactControlDrawer,
  CompactControlRow,
  DataTableLite,
  EmptyState,
  FilterBar,
  KpiCard,
  MetricStrip,
  PageHero,
  Panel,
  StatusPill,
} from '@/components/ui/primitives';
import { csvValue, downloadCsv, formatMetric, formatCompactNumber, toSafeBigInt } from '@/features/shared/formatters';
import type { CompactControlDrawerState } from '@/features/shared/types';

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
  t4KillsGrowth: string | null;
  t5KillsGrowth: string | null;
  deadsGrowth: string | null;
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
  const [broadcasting, setBroadcasting] = useState(false);
  const [denseRows, setDenseRows] = useState(true);
  const [presets, setPresets] = useState<ActivityFilterPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [uiNotice, setUiNotice] = useState<string | null>(null);
  const [drawerState, setDrawerState] = useState<Pick<CompactControlDrawerState, 'statsFilters'>>({
    statsFilters: false,
  });

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

  const handleBroadcast = async () => {
    if (!workspaceId || !selectedWeekKey || !accessToken) return;
    setBroadcasting(true);
    setUiNotice(null);
    try {
      const headers = { 'Content-Type': 'application/json', 'x-access-token': accessToken };
      const res = await fetch('/api/v2/activity/broadcast', {
        method: 'POST',
        headers,
        body: JSON.stringify({ workspaceId, weekKey: selectedWeekKey })
      });
      if (!res.ok) throw new Error((await res.json())?.error?.message || 'Failed to broadcast');
      setUiNotice('Broadcasted to Discord successfully 🚀');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Broadcast failed');
    } finally {
      setBroadcasting(false);
    }
  };

  const handleCopyPurgeList = () => {
    const deadweight = sortedRows.filter(r => 
      r.compliance.overall === 'FAIL' && 
      toSafeBigInt(r.killPointsGrowth) <= BigInt(0) && 
      toSafeBigInt(r.fortDestroying) <= BigInt(0)
    );
    if (!deadweight.length) {
      setUiNotice('No deadweights detected this week! 🎉');
      return;
    }
    const text = `🚨 Recommended Purge List (Week ${selectedWeekKey}):\n` + deadweight.map(r => `- ${r.governorName} (ID: ${r.governorId})`).join('\n');
    void navigator.clipboard.writeText(text);
    setUiNotice(`Copied ${deadweight.length} deadweights to clipboard.`);
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

    const OVERALL_ORDER: Record<string, number> = { FAIL: 0, PARTIAL: 1, NO_STANDARD: 2, PASS: 3 };

    rows.sort((a, b) => {
      if (sortKey === 'rank') {
        // Rank sorts by contribution (descending = top contributor first)
        const diff = toSafeBigInt(a.contributionPoints) - toSafeBigInt(b.contributionPoints);
        return diff === BigInt(0) ? 0 : diff > BigInt(0) ? 1 : -1;
      }
      if (sortKey === 'player') return a.governorName.localeCompare(b.governorName);
      if (sortKey === 'overall') {
        return (OVERALL_ORDER[a.compliance.overall] ?? 4) - (OVERALL_ORDER[b.compliance.overall] ?? 4);
      }
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

  const topPerformerLanes = useMemo(
    () =>
      data
        ? [
            { title: 'Contribution', rows: data.summary.topContribution, key: 'contributionPoints' as const, icon: Sparkles },
            { title: 'Fort Destroying', rows: data.summary.topFortDestroying, key: 'fortDestroying' as const, icon: Shield },
            { title: 'Power Growth', rows: data.summary.topPowerGrowth, key: 'powerGrowth' as const, icon: TrendingUp },
            { title: 'KP Growth', rows: data.summary.topKillPointsGrowth, key: 'killPointsGrowth' as const, icon: Trophy },
          ]
        : [],
    [data]
  );

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

  const maxStats = useMemo(() => {
    let maxDeads = BigInt(0);
    let maxT5 = BigInt(0);
    let topDeadsGovId = '';
    let topT5GovId = '';

    for (const r of sortedRows) {
      if (r.deadsGrowth) {
        const deads = BigInt(r.deadsGrowth);
        if (deads > maxDeads && deads > BigInt(0)) {
          maxDeads = deads;
          topDeadsGovId = r.governorId;
        }
      }
      if (r.t5KillsGrowth) {
        const t5 = BigInt(r.t5KillsGrowth);
        if (t5 > maxT5 && t5 > BigInt(0)) {
          maxT5 = t5;
          topT5GovId = r.governorId;
        }
      }
    }
    return { topDeadsGovId, topT5GovId };
  }, [sortedRows]);

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
        render: (row: ActivityRow) => {
          const isAnvil = maxStats.topDeadsGovId === row.governorId;
          const isExecutioner = maxStats.topT5GovId === row.governorId;
          const isGhost = row.compliance.overall === 'FAIL' && 
                          Number(row.killPointsGrowth || 0) <= 0 && 
                          Number(row.fortDestroying) <= 0;

          return (
            <div className="space-y-2">
              <strong className="font-heading text-base text-tier-1 flex items-center gap-2">
                {row.governorName}
                {isGhost && <span title="Failed all metrics completely" className="text-lg leading-none">👻</span>}
                {isAnvil && <span title="The Anvil (Highest Deads)" className="text-lg leading-none" style={{ textShadow: '0 0 10px var(--rok-gold)' }}>🛡️</span>}
                {isExecutioner && <span title="The Executioner (Highest T5 Kills)" className="text-lg leading-none" style={{ textShadow: '0 0 10px var(--rok-crimson)' }}>🗡️</span>}
              </strong>
              <div className="flex flex-wrap gap-2">
                <StatusPill label={row.allianceTag} tone={row.allianceTag === 'GODt' ? 'warn' : row.allianceTag === 'V57' ? 'info' : 'neutral'} />
                <StatusPill label={`ID ${row.governorId}`} tone="neutral" />
              </div>
            </div>
          );
        },
      },
      {
        key: 'contribution',
        label: 'Contribution',
        sortable: true,
        className: 'text-right',
        render: (row: ActivityRow) => (
          <div className="flex flex-col items-end gap-2">
            <span className="font-heading text-lg text-tier-1">{formatMetric(row.contributionPoints)}</span>
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
            <span className="font-heading text-lg text-tier-1">{formatMetric(row.fortDestroying)}</span>
            <StatusPill label={row.compliance.fortDestroying} tone={metricTone(row.compliance.fortDestroying)} />
          </div>
        ),
      },
      {
        key: 'power',
        label: 'Power Growth',
        sortable: true,
        className: 'text-right',
        render: (row: ActivityRow) => {
          const powerValue = row.powerGrowth ? Number(row.powerGrowth) : 0;
          const isPowerDrop = powerValue < 0;
          const powerColorClass = isPowerDrop 
            ? 'text-[color:var(--rok-crimson,var(--text-error))]' 
            : 'text-emerald-400';
            
          return (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <span className={`font-mono text-sm ${powerColorClass}`}>
                  {powerValue > 0 ? '+' : ''}
                  {formatCompactNumber(row.powerGrowth)}
                </span>
                <StatusPill label={row.compliance.powerGrowth} tone={metricTone(row.compliance.powerGrowth)} />
              </div>
              <span className="text-xs text-tier-3">
                {formatCompactNumber(row.currentPower)} Cur
              </span>
            </div>
          );
        },
      },
      {
        key: 'kp',
        label: 'KP Growth',
        sortable: true,
        className: 'text-right',
        render: (row: ActivityRow) => (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-tier-1">{formatCompactNumber(row.killPointsGrowth)}</span>
              <StatusPill label={row.compliance.killPointsGrowth} tone={metricTone(row.compliance.killPointsGrowth)} />
            </div>
            <div className="flex gap-2">
              {row.deadsGrowth && Number(row.deadsGrowth) > 0 && (
                <span className="text-[10px] text-[color:var(--rok-crimson)] font-mono">{formatCompactNumber(row.deadsGrowth)} Dead</span>
              )}
              {row.t5KillsGrowth && Number(row.t5KillsGrowth) > 0 && (
                <span className="text-[10px] text-[color:var(--rok-gold)] font-mono">{formatCompactNumber(row.t5KillsGrowth)} T5</span>
              )}
            </div>
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
    [maxStats]
  );

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <PageHero
        title="Stats"
        subtitle="A player-facing weekly statboard with top performers, alliance pressure, and compliance data kept intact under a cleaner, mobile-first surface."
        badges={[
          selectedWeekKey ? `Week ${selectedWeekKey}` : 'Week pending',
          `${sortedRows.length} visible players`,
          data?.previousEvent ? `vs ${data.previousEvent.name}` : 'No previous week',
        ]}
        actions={
          <div className="flex flex-wrap gap-2 justify-end">
            <Button asChild variant="outline" className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1">
              <Link href="/rankings">
                <Trophy data-icon="inline-start" /> Rankings
              </Link>
            </Button>
            <Button variant="outline" className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={exportActivityCsv} disabled={!sortedRows.length}>
              <Download data-icon="inline-start" /> CSV
            </Button>
            <Button variant="outline" className="rounded-full border-sky-400/20 bg-sky-400/10 text-sky-100 hover:bg-sky-400/20" onClick={handleBroadcast} disabled={broadcasting || !sortedRows.length}>
              {broadcasting ? '📢 Broadcasting...' : '📢 Broadcaster'}
            </Button>
            <Button variant="outline" className="rounded-full border-rose-400/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20" onClick={handleCopyPurgeList} disabled={!sortedRows.length}>
              💀 Purge List
            </Button>
          </div>
        }
      />

      <SessionGate ready={ready} loading={sessionLoading} error={sessionError} onRetry={() => void refreshSession()}>
        {error ? <InlineError message={error} /> : null}

        <Panel title="Weekly Filters" subtitle="Switch weeks and keep advanced controls compact inside a drawer.">
          <div className="space-y-3">
            <CompactControlRow>
              <Button variant="outline" className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={goPreviousWeek} disabled={currentWeekIndex >= weeks.length - 1 || loading}>
                <ArrowLeft data-icon="inline-start" /> Older
              </Button>
              <Select value={selectedWeekKey || (weeks[0]?.weekKey ?? ALL_VALUE)} onValueChange={(value) => setSelectedWeekKey(value === ALL_VALUE ? '' : value)}>
                <SelectTrigger className="w-[172px] min-w-[172px] rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"><SelectValue placeholder="Select week" /></SelectTrigger>
                <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
                  {weeks.length ? weeks.map((week) => (
                    <SelectItem key={week.id} value={week.weekKey}>{week.name}</SelectItem>
                  )) : <SelectItem value={ALL_VALUE}>No weeks available</SelectItem>}
                </SelectContent>
              </Select>
              <Button variant="outline" className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={goNextWeek} disabled={currentWeekIndex <= 0 || loading}>
                Newer <ArrowRight data-icon="inline-end" />
              </Button>
              <CompactControlDrawer
                open={drawerState.statsFilters}
                onOpenChange={(open) => setDrawerState((prev) => ({ ...prev, statsFilters: open }))}
                triggerLabel="Filters"
                title="Stats Filters"
                description="Alliance, layout mode, and presets."
              >
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Select value={allianceFilter || ALL_VALUE} onValueChange={(value) => setAllianceFilter(value === ALL_VALUE ? '' : value)}>
                    <SelectTrigger className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"><SelectValue placeholder="Alliance" /></SelectTrigger>
                    <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
                      {ALLIANCE_FILTER_OPTIONS.map((option) => (
                        <SelectItem key={option.label} value={option.value || ALL_VALUE}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={viewMode} onValueChange={(value) => setViewMode(value as ActivityViewMode)}>
                    <SelectTrigger className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"><SelectValue placeholder="View" /></SelectTrigger>
                    <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
                      <SelectItem value="cards">Cards</SelectItem>
                      <SelectItem value="table">Table</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button variant="outline" className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={() => setDenseRows((prev) => !prev)}>
                  {denseRows ? 'Comfort spacing' : 'Compact rows'}
                </Button>

                <div className="space-y-3 rounded-[20px] border border-[color:var(--stroke-soft)] bg-black/20 p-3">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                    <Select value={selectedPresetId || PRESET_NONE} onValueChange={(value) => applyPreset(value === PRESET_NONE ? '' : value)}>
                      <SelectTrigger className="w-full min-w-0 rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"><SelectValue placeholder="Saved presets" /></SelectTrigger>
                      <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
                        <SelectItem value={PRESET_NONE}>Saved presets</SelectItem>
                        {presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Preset name" className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3 " />
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    <Button variant="outline" className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={savePreset}>Save Preset</Button>
                    <Button variant="outline" className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={deleteSelectedPreset} disabled={!selectedPresetId}>Delete</Button>
                    <Button variant="outline" className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={resetFilters}>Reset</Button>
                  </div>
                </div>
              </CompactControlDrawer>
            </CompactControlRow>

            <FilterBar className="border-[color:var(--stroke-subtle)] bg-black/20">
              {isHistoricalWeek ? <StatusPill label="Historical week" tone="neutral" /> : null}
              {data?.event?.startsAt ? <StatusPill label={`Starts ${new Date(data.event.startsAt).toLocaleDateString()}`} tone="neutral" /> : null}
              <StatusPill label={`No power baseline ${kpis.noPowerBaseline}`} tone={kpis.noPowerBaseline ? 'warn' : 'good'} />
              <StatusPill label={`No KP baseline ${kpis.noKillPointsBaseline}`} tone={kpis.noKillPointsBaseline ? 'warn' : 'good'} />
            </FilterBar>

            {uiNotice ? <p className="text-sm text-tier-3">{uiNotice}</p> : null}
          </div>
        </Panel>

        {data ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
              <KpiCard label="Tracked Players" value={kpis.total} hint="Members with activity rows this week" tone="info" icon={<Activity className="size-5" />} />
              <KpiCard label="Pass Rate" value={`${kpis.passRate}%`} hint={`${kpis.pass} pass / ${kpis.total} scored`} tone="good" icon={<CheckCircle2 className="size-5" />} animated={false} />
              <KpiCard label="Fails" value={kpis.fail} hint="Below the current alliance standards" tone={kpis.fail > 0 ? 'bad' : 'good'} icon={<XCircle className="size-5" />} />
              <KpiCard label="Partial" value={kpis.partial} hint="Mixed metric outcomes inside the same row" tone={kpis.partial > 0 ? 'warn' : 'neutral'} icon={<TrendingUp className="size-5" />} />
            </div>

            <Panel title="Insights" subtitle="Alliance pressure and top performers in one compact secondary module.">
              <Tabs defaultValue="alliance" className="space-y-4">
                <TabsList className="flex w-full justify-start gap-2 rounded-full border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-1 overflow-x-auto no-scrollbar whitespace-nowrap">
                  <TabsTrigger value="alliance" className="rounded-full px-4 text-xs  data-[state=active]:bg-sky-300/15 data-[state=active]:text-tier-1">Alliance Pressure</TabsTrigger>
                  <TabsTrigger value="performers" className="rounded-full px-4 text-xs  data-[state=active]:bg-sky-300/15 data-[state=active]:text-tier-1">Top Performers</TabsTrigger>
                </TabsList>

                <TabsContent value="alliance" className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {filteredSummary.map((alliance) => {
                      const total = Math.max(1, alliance.members || 0);
                      const passPercent = Math.round((alliance.passCount / total) * 100);
                      return (
                        <Card key={alliance.allianceTag} className="border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)]">
                          <CardContent className="space-y-3 p-3 min-[390px]:p-3.5 sm:p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-heading text-base text-tier-1">{alliance.allianceLabel}</p>
                                <p className="mt-1 text-xs text-tier-3">{alliance.members} tracked players</p>
                              </div>
                              <StatusPill label={`${passPercent}%`} tone={passPercent >= 70 ? 'good' : passPercent >= 45 ? 'warn' : 'bad'} />
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-4)]">
                              <div className="h-full rounded-full bg-[color:var(--primary)] shadow-[0_0_8px_var(--primary)]" style={{ width: `${passPercent}%` }} />
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
                </TabsContent>

                <TabsContent value="performers" className="space-y-3">
                  <div className="grid gap-3 lg:grid-cols-2">
                    {topPerformerLanes.map((lane) => {
                      const Icon = lane.icon;
                      return (
                        <Card key={lane.title} className="border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)]">
                          <CardHeader className="pb-2">
                            <CardTitle className="flex items-center gap-2 font-heading text-sm text-tier-1 sm:text-base">
                              <Icon className="size-4 text-tier-2" /> {lane.title}
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2.5">
                            {lane.rows.slice(0, 4).map((row, index) => (
                              <div key={`${lane.title}-${row.governorDbId}`} className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--stroke-subtle)] bg-black/10 px-3.5 py-2.5">
                                <div className="min-w-0">
                                  <p className="clamp-title-mobile text-sm font-medium text-tier-1" title={row.governorName}>{row.governorName}</p>
                                  <p className="text-xs text-tier-3">{row.allianceLabel}</p>
                                </div>
                                <div className="text-right">
                                  <p className="font-heading text-base text-tier-1">{formatMetric(row[lane.key])}</p>
                                  <p className="text-xs text-tier-3">#{index + 1}</p>
                                </div>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </TabsContent>
              </Tabs>
            </Panel>

            <Panel
              title="Player Compliance"
              subtitle={`${filteredRows.length} members • ${data.event.name}`}
              actions={
                <ToggleGroup type="single" value={viewMode} onValueChange={(value) => value && setViewMode(value as ActivityViewMode)}>
                  <ToggleGroupItem value="cards" className="rounded-full border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-4 text-xs  text-tier-2 data-[state=on]:border-sky-300/20 data-[state=on]:bg-sky-300/12 data-[state=on]:text-tier-1">
                    Cards
                  </ToggleGroupItem>
                  <ToggleGroupItem value="table" className="rounded-full border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-4 text-xs  text-tier-2 data-[state=on]:border-sky-300/20 data-[state=on]:bg-sky-300/12 data-[state=on]:text-tier-1">
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
                    mobileCards={viewMode !== 'table'}
                    rows={sortedRows}
                    rowKey={(row) => row.governorDbId}
                    columns={columns}
                    onSort={handleSort}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    emptyLabel="No activity rows found for these filters."
                  />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {sortedRows.map((row, index) => (
                      <motion.article key={row.governorDbId} initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, delay: Math.min(index * 0.015, 0.16) }} className="rounded-[20px] surface-2 p-3 min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4">
                        <div className="flex items-center justify-between gap-3">
                          <StatusPill label={`#${index + 1}`} tone="neutral" />
                          <StatusPill label={row.compliance.overall} tone={overallTone(row.compliance.overall)} />
                        </div>
                        <div className="mt-4 space-y-2">
                          <p className="clamp-title-mobile font-heading text-base text-tier-1 min-[390px]:text-lg sm:text-xl" title={row.governorName}>{row.governorName}</p>
                          <div className="flex flex-wrap gap-2">
                            <StatusPill label={row.allianceTag} tone={row.allianceTag === 'GODt' ? 'warn' : row.allianceTag === 'V57' ? 'info' : 'neutral'} />
                            <StatusPill label={`ID ${row.governorId}`} tone="neutral" />
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2.5">
                          {[
                            { label: 'Contribution', value: row.contributionPoints, status: row.compliance.contributionPoints },
                            { label: 'Fort', value: row.fortDestroying, status: row.compliance.fortDestroying },
                            { label: 'Power', value: row.powerGrowth, status: row.compliance.powerGrowth },
                            { label: 'KP', value: row.killPointsGrowth, status: row.compliance.killPointsGrowth },
                          ].map((metric) => (
                            <div key={`${row.governorDbId}-${metric.label}`} className="rounded-xl border border-[color:var(--stroke-subtle)] bg-[color:var(--surface-3)] p-2 min-[390px]:rounded-2xl min-[390px]:p-2.5">
                              <p className="text-xs  text-tier-3">{metric.label}</p>
                              <p className="mt-1.5 font-heading text-base text-tier-1 sm:text-lg">{metric.value != null ? formatMetric(metric.value) : 'N/A'}</p>
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
                <EmptyState title="No activity rows" description="Upload ranking screenshots and governor profiles to begin weekly tracking." action={<Button asChild variant="outline" className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"><Link href="/upload">Upload Screenshots</Link></Button>} />
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
