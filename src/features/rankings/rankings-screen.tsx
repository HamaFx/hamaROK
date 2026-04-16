'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Filter,
  RefreshCcw,
  Search,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { splitGovernorNameAndAlliance } from '@/lib/alliances';
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  CompactControlDrawer,
  CompactControlRow,
  DataTableLite,
  EmptyState,
  FilterBar,
  Panel,
  StatusPill,
} from '@/components/ui/primitives';
import {
  csvValue,
  downloadCsv,
  formatMetric,
  formatRelativeDate,
  parseBigIntSafe,
} from '@/features/shared/formatters';
import type { CompactControlDrawerState } from '@/features/shared/types';

const ALL_VALUE = '__all__';
const PRESET_NONE = '__none__';

type RankingStatus = 'ACTIVE' | 'UNRESOLVED' | 'REJECTED';
type RankingsViewMode = 'auto' | 'table' | 'cards';
type MetricVisualMode = 'numeric' | 'bars';

interface CanonicalRow {
  id: string;
  eventId: string;
  rankingType: string;
  metricKey: string;
  governorId: string | null;
  governorNameRaw: string;
  metricValue: string;
  sourceRank: number | null;
  status: RankingStatus;
  stableRank: number;
  stableIndex: number;
  tieGroup: number;
  conflictFlags?: {
    unresolved: boolean;
    rejected: boolean;
    tie: boolean;
  };
  governor?: {
    id: string;
    governorId: string;
    name: string;
  } | null;
  allianceRaw?: string | null;
  titleRaw?: string | null;
  updatedAt: string;
}

interface DisplayRankingRow extends CanonicalRow {
  displayName: string;
  allianceLabel: string | null;
  allianceTag: string | null;
  metricLabel: string;
  boardLabel: string;
  linkedGovernorId: string | null;
  metricValueBigInt: bigint | null;
  metricRatio: number;
}

interface WeeklyEventInfo {
  id: string;
  name: string;
  weekKey: string | null;
  startsAt: string | null;
  endsAt?: string | null;
  isClosed?: boolean;
}

interface WeeklyActivitySummary {
  membersTracked: number;
  unresolvedIdentityCount?: number;
  noPowerBaselineCount?: number;
  noKillPointsBaselineCount?: number;
  pendingSyncCount?: number;
  allianceSummary: Array<{
    allianceTag: string;
    allianceLabel: string;
    members: number;
    passCount: number;
    failCount: number;
    partialCount?: number;
    noStandardCount: number;
    totalContribution: string;
    totalPowerGrowth: string;
    totalFortDestroying?: string;
    totalKillPointsGrowth?: string;
  }>;
}

interface WeeklyActivityResponse {
  event: {
    id: string;
    weekKey: string | null;
    name: string;
    startsAt: string | null;
  };
  summary: WeeklyActivitySummary;
}

interface RankingsFilterPreset {
  id: string;
  name: string;
  search: string;
  rankingTypeFilter: string;
  metricFilter: string;
  allianceFilter: string;
  weekKey: string;
  denseRows: boolean;
  viewMode: RankingsViewMode;
  metricVisualMode: MetricVisualMode;
  createdAt: string;
}

interface SourceCoverageSummary {
  power: { profile: number; rankboard: number; total: number };
  killPoints: { profile: number; rankboard: number; total: number };
}

const RANKING_TYPE_FILTERS = [
  { value: '', label: 'All Boards' },
  { value: 'individual_power', label: 'Individual Power' },
  { value: 'mad_scientist', label: 'Mad Scientist' },
  { value: 'fort_destroyer', label: 'Fort Destroyer' },
  { value: 'kill_point', label: 'Kill Point' },
];

const METRIC_FILTERS = [
  { value: '', label: 'All Metrics' },
  { value: 'power', label: 'Power' },
  { value: 'contribution_points', label: 'Contribution' },
  { value: 'fort_destroying', label: 'Fort Destroying' },
  { value: 'kill_points', label: 'Kill Points' },
];

const ALLIANCE_FILTERS = [
  { value: '', label: 'All Alliances' },
  { value: 'GODt', label: '[GODt]' },
  { value: 'V57', label: '[V57]' },
  { value: 'P57R', label: '[P57R]' },
];

function formatTokenLabel(value: string) {
  const normalized = String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return 'Metric';
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusTone(status: RankingStatus): 'good' | 'warn' | 'bad' {
  if (status === 'ACTIVE') return 'good';
  if (status === 'UNRESOLVED') return 'warn';
  return 'bad';
}

function allianceTone(tag: string | null): 'warn' | 'info' | 'neutral' {
  if (tag === 'GODt') return 'warn';
  if (tag === 'V57') return 'info';
  return 'neutral';
}

export default function RankingsScreen() {
  const { workspaceId, accessToken, ready, loading: sessionLoading, error: sessionError, refreshSession } = useWorkspaceSession();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<CanonicalRow[]>([]);
  const [weeks, setWeeks] = useState<WeeklyEventInfo[]>([]);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>('');
  const [rankingTypeFilter, setRankingTypeFilter] = useState('');
  const [metricFilter, setMetricFilter] = useState('');
  const [allianceFilter, setAllianceFilter] = useState('');
  const [weeklyActivity, setWeeklyActivity] = useState<WeeklyActivityResponse | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [sourceCoverage, setSourceCoverage] = useState<SourceCoverageSummary | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denseRows, setDenseRows] = useState(false);
  const [viewMode, setViewMode] = useState<RankingsViewMode>('auto');
  const [metricVisualMode, setMetricVisualMode] = useState<MetricVisualMode>('numeric');
  const [presets, setPresets] = useState<RankingsFilterPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [uiNotice, setUiNotice] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [drawerState, setDrawerState] = useState<Pick<CompactControlDrawerState, 'rankingsFilters'>>({
    rankingsFilters: false,
  });

  const presetStorageKey = useMemo(() => `hama:rankings:presets:${workspaceId || 'unknown'}`, [workspaceId]);

  const loadWeekOptions = useCallback(async () => {
    if (!ready) {
      setWeeks([]);
      return null;
    }

    try {
      const weeksRes = await fetch(`/api/v2/activity/weeks?workspaceId=${encodeURIComponent(workspaceId)}&limit=26`, {
        headers: { 'x-access-token': accessToken },
      });
      const weeksPayload = await weeksRes.json();
      const weekRows = (Array.isArray(weeksPayload?.data) ? weeksPayload.data : []) as WeeklyEventInfo[];

      if (weekRows.length > 0) {
        setWeeks(weekRows);
        const preferred = weekRows.find((week) => week.weekKey === selectedWeekKey) || weekRows[0];
        setSelectedWeekKey(preferred.weekKey || '');
        return preferred.weekKey || null;
      }

      const weeklyRes = await fetch(`/api/v2/events/weekly?workspaceId=${encodeURIComponent(workspaceId)}&autoCreate=true`, {
        headers: { 'x-access-token': accessToken },
      });
      const weeklyPayload = await weeklyRes.json();
      if (!weeklyRes.ok || !weeklyPayload?.data?.id) {
        setWeeks([]);
        setSelectedWeekKey('');
        return null;
      }

      const week: WeeklyEventInfo = {
        id: weeklyPayload.data.id,
        name: weeklyPayload.data.name,
        weekKey: weeklyPayload.data.weekKey || null,
        startsAt: weeklyPayload.data.startsAt || null,
        endsAt: weeklyPayload.data.endsAt || null,
        isClosed: Boolean(weeklyPayload.data.isClosed),
      };
      setWeeks([week]);
      setSelectedWeekKey(week.weekKey || '');
      return week.weekKey || null;
    } catch {
      setWeeks([]);
      return null;
    }
  }, [workspaceId, accessToken, ready, selectedWeekKey]);

  const loadWeeklyActivity = useCallback(
    async (weekKey: string | null) => {
      if (!ready) {
        setWeeklyActivity(null);
        return;
      }

      try {
        const activityRes = await fetch(
          `/api/v2/activity/weekly?workspaceId=${encodeURIComponent(workspaceId)}${
            weekKey ? `&weekKey=${encodeURIComponent(weekKey)}` : ''
          }`,
          {
            headers: { 'x-access-token': accessToken },
          }
        );
        const activityPayload = await activityRes.json();
        setWeeklyActivity(activityRes.ok && activityPayload?.data ? (activityPayload.data as WeeklyActivityResponse) : null);
      } catch {
        setWeeklyActivity(null);
      }
    },
    [workspaceId, accessToken, ready]
  );

  const loadData = useCallback(
    async (cursor: string | null = null, weekKeyOverride?: string | null) => {
      if (!ready) return;
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ workspaceId, limit: '50', includeUnresolved: 'false' });
        if (search.trim()) params.set('q', search.trim());
        const activeWeekKey = weekKeyOverride ?? (selectedWeekKey || null);
        if (activeWeekKey) params.set('weekKey', activeWeekKey);
        if (rankingTypeFilter) params.set('rankingType', rankingTypeFilter);
        if (metricFilter) params.set('metricKey', metricFilter);
        if (allianceFilter) params.set('alliance', allianceFilter);
        if (cursor) params.set('cursor', cursor);

        const rowsRes = await fetch(`/api/v2/rankings?${params.toString()}`, {
          headers: { 'x-access-token': accessToken },
        });
        const rowsPayload = await rowsRes.json();

        if (!rowsRes.ok) {
          throw new Error(rowsPayload?.error?.message || 'Failed to load canonical rankings.');
        }

        setRows(Array.isArray(rowsPayload?.data) ? rowsPayload.data : []);
        setNextCursor(rowsPayload?.meta?.nextCursor || null);
        setPendingSyncCount(Number(rowsPayload?.meta?.pendingSyncCount || 0));
        setSourceCoverage((rowsPayload?.meta?.sourceCoverage || null) as SourceCoverageSummary | null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to load rankings.');
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, accessToken, search, ready, selectedWeekKey, rankingTypeFilter, metricFilter, allianceFilter]
  );

  const refresh = useCallback(() => {
    const run = async () => {
      setCursorStack([null]);
      setNextCursor(null);
      const weekKey = await loadWeekOptions();
      await Promise.all([loadWeeklyActivity(weekKey), loadData(null, weekKey)]);
    };
    void run();
  }, [loadData, loadWeekOptions, loadWeeklyActivity]);

  useEffect(() => {
    if (ready) refresh();
  }, [ready, refresh]);

  useEffect(() => {
    if (!ready || !selectedWeekKey) return;
    setCursorStack([null]);
    setNextCursor(null);
    void Promise.all([loadWeeklyActivity(selectedWeekKey), loadData(null, selectedWeekKey)]);
  }, [ready, selectedWeekKey, rankingTypeFilter, metricFilter, allianceFilter, weeks, loadWeeklyActivity, loadData]);

  useEffect(() => {
    if (!ready) return;
    try {
      const raw = localStorage.getItem(presetStorageKey);
      const parsed = raw ? (JSON.parse(raw) as RankingsFilterPreset[]) : [];
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
    if (currentWeekIndex < 0 || currentWeekIndex >= weeks.length - 1) return;
    setSelectedWeekKey(weeks[currentWeekIndex + 1].weekKey || '');
  };

  const goNextWeek = () => {
    if (currentWeekIndex <= 0) return;
    setSelectedWeekKey(weeks[currentWeekIndex - 1].weekKey || '');
  };

  const goNext = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, nextCursor]);
    void loadData(nextCursor);
  };

  const goBack = () => {
    if (cursorStack.length <= 1) return;
    const next = [...cursorStack];
    next.pop();
    const previousCursor = next[next.length - 1] || null;
    setCursorStack(next);
    void loadData(previousCursor);
  };

  const runMetricSync = useCallback(async () => {
    if (!ready || syncBusy) return;
    setSyncBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspaceId, limit: '50' });
      const res = await fetch(`/api/v2/sync/metrics/drain?${params.toString()}`, {
        method: 'POST',
        headers: { 'x-access-token': accessToken },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to run metric sync.');
      }
      const succeeded = Number(payload?.data?.succeeded || 0);
      const failed = Number(payload?.data?.failed || 0);
      const pending = Number(payload?.data?.pending || 0);
      setUiNotice(`Metric sync finished. Succeeded ${succeeded}, failed ${failed}, pending ${pending}.`);
      setPendingSyncCount(pending);
      await loadData(cursorStack[cursorStack.length - 1] || null, selectedWeekKey || null);
      await loadWeeklyActivity(selectedWeekKey || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to run metric sync.');
    } finally {
      setSyncBusy(false);
    }
  }, [ready, syncBusy, workspaceId, accessToken, loadData, cursorStack, selectedWeekKey, loadWeeklyActivity]);

  const displayRows = useMemo<DisplayRankingRow[]>(() => {
    const mapped = rows.map((row) => {
      const split = splitGovernorNameAndAlliance({
        governorNameRaw: row.governorNameRaw,
        allianceRaw: row.allianceRaw || row.titleRaw || undefined,
      });
      const displayName = split.governorNameRaw || row.governorNameRaw || 'Unknown';
      const metricLabel = formatTokenLabel(row.metricKey);
      const boardLabel = `${formatTokenLabel(row.rankingType)} • ${metricLabel}`;
      return {
        ...row,
        displayName,
        allianceLabel: split.allianceRaw || row.allianceRaw || null,
        allianceTag: split.allianceTag,
        metricLabel,
        boardLabel,
        linkedGovernorId: row.governor?.governorId || null,
        metricValueBigInt: parseBigIntSafe(row.metricValue),
        metricRatio: 0,
      };
    });

    const maxMetric = mapped.reduce((max, row) => {
      if (row.metricValueBigInt == null) return max;
      return row.metricValueBigInt > max ? row.metricValueBigInt : max;
    }, BigInt(0));

    return mapped.map((row) => {
      if (!row.metricValueBigInt || maxMetric <= BigInt(0)) return row;
      const ratio = Number((row.metricValueBigInt * BigInt(10_000)) / maxMetric) / 100;
      return {
        ...row,
        metricRatio: Math.max(0, Math.min(100, ratio)),
      };
    });
  }, [rows]);

  const freshness = useMemo(() => {
    if (!displayRows.length) return null;
    const latest = displayRows.reduce((current, row) => {
      const ts = new Date(row.updatedAt).getTime();
      if (!Number.isFinite(ts)) return current;
      return ts > current ? ts : current;
    }, 0);
    if (!latest) return null;

    const hoursOld = Math.floor((Date.now() - latest) / 3_600_000);
    if (hoursOld <= 24) return { tone: 'good' as const, label: `Fresh ${formatRelativeDate(new Date(latest).toISOString())}` };
    if (hoursOld <= 72) return { tone: 'warn' as const, label: `Aging ${formatRelativeDate(new Date(latest).toISOString())}` };
    return { tone: 'bad' as const, label: `Outdated ${formatRelativeDate(new Date(latest).toISOString())}` };
  }, [displayRows]);

  const latestWeekKey = weeks[0]?.weekKey || '';
  const isHistoricalWeek = Boolean(selectedWeekKey && latestWeekKey && selectedWeekKey !== latestWeekKey);

  const savePreset = useCallback(() => {
    if (!ready) return;
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.round(Math.random() * 1000)}`;

    const nextPreset: RankingsFilterPreset = {
      id,
      name,
      search,
      rankingTypeFilter,
      metricFilter,
      allianceFilter,
      weekKey: selectedWeekKey,
      denseRows,
      viewMode,
      metricVisualMode,
      createdAt: new Date().toISOString(),
    };

    const trimmed = [nextPreset, ...presets].slice(0, 20);
    setPresets(trimmed);
    setSelectedPresetId(id);
    setPresetName('');
    localStorage.setItem(presetStorageKey, JSON.stringify(trimmed));
    setUiNotice(`Saved preset: ${name}`);
  }, [ready, presetName, presets, search, rankingTypeFilter, metricFilter, allianceFilter, selectedWeekKey, denseRows, viewMode, metricVisualMode, presetStorageKey]);

  const applyPreset = useCallback(
    (presetId: string) => {
      setSelectedPresetId(presetId);
      if (!presetId) return;
      const target = presets.find((preset) => preset.id === presetId);
      if (!target) return;

      setSearch(target.search);
      setRankingTypeFilter(target.rankingTypeFilter);
      setMetricFilter(target.metricFilter);
      setAllianceFilter(target.allianceFilter);
      setDenseRows(target.denseRows);
      setViewMode(target.viewMode);
      setMetricVisualMode(target.metricVisualMode);

      if (target.weekKey && weeks.some((week) => week.weekKey === target.weekKey)) {
        setSelectedWeekKey(target.weekKey);
      }

      window.setTimeout(() => {
        setCursorStack([null]);
        setNextCursor(null);
        void loadData(null, target.weekKey || selectedWeekKey || null);
      }, 0);

      setUiNotice(`Applied preset: ${target.name}`);
    },
    [presets, weeks, loadData, selectedWeekKey]
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
    setSearch('');
    setRankingTypeFilter('');
    setMetricFilter('');
    setAllianceFilter('');
    setDenseRows(false);
    setViewMode('auto');
    setMetricVisualMode('numeric');
    setSelectedPresetId('');
    window.setTimeout(() => {
      setCursorStack([null]);
      setNextCursor(null);
      void loadData(null, selectedWeekKey || null);
    }, 0);
  }, [loadData, selectedWeekKey]);

  const exportLeaderboardCsv = useCallback(() => {
    if (!displayRows.length) return;
    const headers = ['Stable Rank', 'Player', 'Alliance', 'Governor ID', 'Metric', 'Metric Value', 'Board', 'Source Rank', 'Status', 'Updated At'];
    const body = displayRows.map((row) => [
      row.stableRank,
      row.displayName,
      row.allianceLabel || '',
      row.linkedGovernorId || '',
      row.metricLabel,
      row.metricValue,
      row.boardLabel,
      row.sourceRank ?? '',
      row.status,
      row.updatedAt,
    ]);

    const filename = `rankings-${selectedWeekKey || 'current'}-${new Date().toISOString().slice(0, 10)}.csv`;
    const lines = [headers.map((cell) => csvValue(cell)).join(',')].concat(
      body.map((line) => line.map((cell) => csvValue(cell)).join(','))
    );
    downloadCsv(filename, lines);
    setUiNotice(`Exported ${displayRows.length} rows.`);
  }, [displayRows, selectedWeekKey]);

  const columns = useMemo(
    () => [
      {
        key: 'stable',
        label: 'Rank',
        className: 'text-nowrap',
        render: (row: DisplayRankingRow) => (
          <div className="flex flex-col items-start gap-2">
            <StatusPill label={`#${row.stableRank}`} tone={row.stableRank <= 3 ? 'warn' : 'neutral'} />
            {row.conflictFlags?.tie ? <span className="text-xs text-tier-3">Tie group {row.tieGroup}</span> : <span className="text-xs text-tier-3">Stable rank</span>}
          </div>
        ),
      },
      {
        key: 'governor',
        label: 'Player',
        render: (row: DisplayRankingRow) => (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="font-heading text-base text-tier-1">{row.displayName}</strong>
              {row.titleRaw ? <StatusPill label={row.titleRaw} tone="info" /> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill label={row.allianceLabel || 'No alliance'} tone={allianceTone(row.allianceTag)} />
              <StatusPill label={row.linkedGovernorId ? `ID ${row.linkedGovernorId}` : 'Unlinked'} tone="neutral" />
            </div>
          </div>
        ),
      },
      {
        key: 'metric',
        label: 'Metric',
        className: 'text-right',
        render: (row: DisplayRankingRow) => (
          <div className="flex flex-col items-end gap-2 text-right">
            <div>
              <p className="font-heading text-lg text-tier-1">{formatMetric(row.metricValue)}</p>
              <p className="text-xs  text-tier-3">{row.metricLabel}</p>
            </div>
            {metricVisualMode === 'bars' ? (
              <div className="w-full max-w-40 overflow-hidden rounded-full bg-[color:var(--surface-4)]">
                <div className="h-2 rounded-full bg-[linear-gradient(90deg,#5a7fff,#7ce6ff)]" style={{ width: `${Math.max(4, row.metricRatio)}%` }} />
              </div>
            ) : null}
          </div>
        ),
      },
      {
        key: 'board',
        label: 'Board',
        mobileHidden: true,
        render: (row: DisplayRankingRow) => <span className="text-sm text-tier-3">{row.boardLabel}</span>,
      },
      {
        key: 'source',
        label: 'Source',
        mobileHidden: true,
        render: (row: DisplayRankingRow) => <span className="text-sm text-tier-3">{row.sourceRank ? `#${row.sourceRank}` : '—'}</span>,
      },
      {
        key: 'status',
        label: 'State',
        render: (row: DisplayRankingRow) => <StatusPill label={row.status} tone={statusTone(row.status)} />,
      },
      {
        key: 'updated',
        label: 'Updated',
        mobileHidden: true,
        render: (row: DisplayRankingRow) => <span className="text-sm text-tier-3">{formatRelativeDate(row.updatedAt)}</span>,
      },
    ],
    [metricVisualMode]
  );

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <SessionGate ready={ready} loading={sessionLoading} error={sessionError} onRetry={() => void refreshSession()}>
        {error ? <InlineError message={error} /> : null}

        <motion.section initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="relative z-10 space-y-2">
          <CompactControlRow>
            <Button type="button" variant="outline" className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={goPreviousWeek} disabled={loading || currentWeekIndex >= weeks.length - 1}>
              <ArrowLeft data-icon="inline-start" /> Older
            </Button>
            <Select value={selectedWeekKey || ALL_VALUE} onValueChange={(value) => setSelectedWeekKey(value === ALL_VALUE ? '' : value)}>
              <SelectTrigger className="w-[168px] rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1">
                <SelectValue placeholder="Select week" />
              </SelectTrigger>
              <SelectContent className="border-[color:var(--stroke-soft)] bg-[rgba(8,10,16,0.98)] text-tier-1">
                {weeks.map((week) => (
                  <SelectItem key={week.id} value={week.weekKey || ALL_VALUE}>
                    {week.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={goNextWeek} disabled={loading || currentWeekIndex <= 0}>
              Newer <ArrowRight data-icon="inline-end" />
            </Button>
            <div className="relative w-[240px] min-w-[240px]">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-tier-3" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    setCursorStack([null]);
                    setNextCursor(null);
                    void loadData(null, selectedWeekKey || null);
                  }
                }}
                placeholder="Search player or ID"
                className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] pl-11 text-tier-1 placeholder:text-tier-3"
              />
            </div>
            <CompactControlDrawer
              open={drawerState.rankingsFilters}
              onOpenChange={(open) => setDrawerState((prev) => ({ ...prev, rankingsFilters: open }))}
              triggerLabel={
                <>
                  <Filter className="mr-2 size-4" />
                  Filters
                </>
              }
              title="Ranking Filters"
              description="Filters, status chips, presets, and layout options."
            >
              <div className="grid gap-2.5 sm:grid-cols-3">
                <Select value={rankingTypeFilter || ALL_VALUE} onValueChange={(value) => setRankingTypeFilter(value === ALL_VALUE ? '' : value)}>
                  <SelectTrigger className="w-full min-w-0 rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"><SelectValue placeholder="Board" /></SelectTrigger>
                  <SelectContent className="border-[color:var(--stroke-soft)] bg-[rgba(8,10,16,0.98)] text-tier-1">
                    {RANKING_TYPE_FILTERS.map((item) => <SelectItem key={item.label} value={item.value || ALL_VALUE}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={metricFilter || ALL_VALUE} onValueChange={(value) => setMetricFilter(value === ALL_VALUE ? '' : value)}>
                  <SelectTrigger className="w-full min-w-0 rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"><SelectValue placeholder="Metric" /></SelectTrigger>
                  <SelectContent className="border-[color:var(--stroke-soft)] bg-[rgba(8,10,16,0.98)] text-tier-1">
                    {METRIC_FILTERS.map((item) => <SelectItem key={item.label} value={item.value || ALL_VALUE}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={allianceFilter || ALL_VALUE} onValueChange={(value) => setAllianceFilter(value === ALL_VALUE ? '' : value)}>
                  <SelectTrigger className="w-full min-w-0 rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"><SelectValue placeholder="Alliance" /></SelectTrigger>
                  <SelectContent className="border-[color:var(--stroke-soft)] bg-[rgba(8,10,16,0.98)] text-tier-1">
                    {ALLIANCE_FILTERS.map((item) => <SelectItem key={item.label} value={item.value || ALL_VALUE}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <FilterBar className="border-[color:var(--stroke-subtle)] bg-black/20">
                {weeklyActivity ? <StatusPill label={`${weeklyActivity.summary.membersTracked} tracked`} tone="info" /> : null}
                <StatusPill label={`Pending sync ${pendingSyncCount}`} tone={pendingSyncCount > 0 ? 'warn' : 'good'} />
                {isHistoricalWeek ? <StatusPill label="Historical week" tone="neutral" /> : null}
                {freshness ? <StatusPill label={freshness.label} tone={freshness.tone} /> : null}
                {sourceCoverage ? <StatusPill label={`Power P${sourceCoverage.power.profile}/R${sourceCoverage.power.rankboard}`} tone="neutral" /> : null}
                {sourceCoverage ? <StatusPill label={`KP P${sourceCoverage.killPoints.profile}/R${sourceCoverage.killPoints.rankboard}`} tone="neutral" /> : null}
              </FilterBar>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <Button onClick={exportLeaderboardCsv} variant="outline" className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" disabled={!displayRows.length}>
                  <Download data-icon="inline-start" /> Export
                </Button>
                <Button onClick={runMetricSync} className="w-full rounded-full bg-[linear-gradient(135deg,#5a7fff,#7ce6ff)] text-black hover:opacity-95" disabled={loading || syncBusy || !ready}>
                  <RefreshCcw data-icon="inline-start" className={syncBusy ? 'animate-spin' : ''} />
                  {syncBusy ? 'Syncing...' : 'Run Sync'}
                </Button>
              </div>

              <div className="space-y-4 rounded-[20px] border border-[color:var(--stroke-soft)] bg-black/20 p-3 min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4">
                <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_11rem]">
                  <Select value={selectedPresetId || PRESET_NONE} onValueChange={(value) => applyPreset(value === PRESET_NONE ? '' : value)}>
                    <SelectTrigger className="w-full min-w-0 rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"><SelectValue placeholder="Saved presets" /></SelectTrigger>
                    <SelectContent className="border-[color:var(--stroke-soft)] bg-[rgba(8,10,16,0.98)] text-tier-1">
                      <SelectItem value={PRESET_NONE}>Saved presets</SelectItem>
                      {presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Preset name" className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3" />
                </div>

                <div className="grid gap-2.5 sm:grid-cols-3">
                  <Button variant="outline" className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={savePreset}>Save Preset</Button>
                  <Button variant="outline" className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={deleteSelectedPreset} disabled={!selectedPresetId}>Delete</Button>
                  <Button variant="outline" className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={resetFilters}>Reset</Button>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div>
                    <p className="mb-2 text-xs  text-tier-3">Leaderboard layout</p>
                    <ToggleGroup className="w-full flex-wrap justify-start" type="single" value={viewMode} onValueChange={(value) => value && setViewMode(value as RankingsViewMode)}>
                      {['auto', 'table', 'cards'].map((item) => (
                        <ToggleGroupItem key={item} value={item} className="rounded-full border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-4 text-xs font-medium  text-tier-2 data-[state=on]:border-sky-300/20 data-[state=on]:bg-sky-300/12 data-[state=on]:text-tier-1">
                          {item}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                  <div>
                    <p className="mb-2 text-xs  text-tier-3">Metric rendering</p>
                    <ToggleGroup className="w-full flex-wrap justify-start sm:w-auto" type="single" value={metricVisualMode} onValueChange={(value) => value && setMetricVisualMode(value as MetricVisualMode)}>
                      {['numeric', 'bars'].map((item) => (
                        <ToggleGroupItem key={item} value={item} className="rounded-full border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-4 text-xs font-medium  text-tier-2 data-[state=on]:border-sky-300/20 data-[state=on]:bg-sky-300/12 data-[state=on]:text-tier-1">
                          {item}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                </div>
              </div>
            </CompactControlDrawer>
          </CompactControlRow>

          {uiNotice ? <p className="text-sm text-tier-3">{uiNotice}</p> : null}
        </motion.section>

        <Panel
          title="Leaderboard"
          subtitle="Canonical board rows with current filters applied."
        >
          <div className="mb-3 flex items-center justify-between gap-2 overflow-x-auto whitespace-nowrap">
            <p className="text-xs text-tier-3 min-[390px]:text-sm">{displayRows.length} rows visible</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={goBack} disabled={loading || cursorStack.length <= 1}>
                <ArrowLeft data-icon="inline-start" /> Prev
              </Button>
              <Button variant="outline" className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={goNext} disabled={loading || !nextCursor}>
                Next <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </div>
          {displayRows.length ? (
            viewMode === 'cards' ? (
              <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {displayRows.map((row) => (
                  <article
                    key={row.id}
                    className={
                      row.status === 'ACTIVE'
                        ? 'rounded-[20px] border border-[color:var(--stroke-soft)] bg-[rgba(11,15,24,0.92)] p-3 shadow-[0_12px_28px_rgba(0,0,0,0.24)] min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4'
                        : row.status === 'UNRESOLVED'
                          ? 'rounded-[20px] border border-sky-300/20 bg-[rgba(76,127,197,0.14)] p-3 shadow-[0_12px_28px_rgba(0,0,0,0.24)] min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4'
                          : 'rounded-[20px] border border-rose-300/20 bg-[rgba(150,62,90,0.15)] p-3 shadow-[0_12px_28px_rgba(0,0,0,0.24)] min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4'
                    }
                  >
                    <div className="flex items-center justify-between gap-3">
                      <StatusPill label={`#${row.stableRank}`} tone={row.stableRank <= 3 ? 'warn' : 'neutral'} />
                      <StatusPill label={row.status} tone={statusTone(row.status)} />
                    </div>
                    <div className="mt-4 space-y-2">
                      <p className="clamp-title-mobile font-heading text-base text-tier-1 min-[390px]:text-lg sm:text-xl" title={row.displayName}>{row.displayName}</p>
                      <div className="flex flex-wrap gap-2">
                        <StatusPill label={row.allianceLabel || 'No alliance'} tone={allianceTone(row.allianceTag)} />
                        <StatusPill label={row.linkedGovernorId ? `ID ${row.linkedGovernorId}` : 'Unlinked'} tone="neutral" />
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-[color:var(--stroke-subtle)] bg-[color:var(--surface-3)] p-3">
                        <p className="text-xs  text-tier-3">{row.metricLabel}</p>
                        <p className="mt-1.5 font-heading text-base text-tier-1 sm:text-lg">{formatMetric(row.metricValue)}</p>
                      </div>
                      <div className="rounded-2xl border border-[color:var(--stroke-subtle)] bg-[color:var(--surface-3)] p-3">
                        <p className="text-xs  text-tier-3">Board</p>
                        <p className="clamp-secondary mt-1.5 text-xs text-tier-2 min-[390px]:text-[13px]" title={formatTokenLabel(row.rankingType)}>{formatTokenLabel(row.rankingType)}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-tier-3">Updated {formatRelativeDate(row.updatedAt)}</p>
                  </article>
                ))}
              </div>
            ) : (
              <DataTableLite
                stickyFirst
                dense={denseRows}
                mobileCards
                columns={columns}
                rows={displayRows}
                rowKey={(row) => row.id}
                rowClassName={(row) =>
                  row.status === 'ACTIVE'
                    ? 'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.01)]'
                    : row.status === 'UNRESOLVED'
                      ? 'bg-[rgba(76,127,197,0.06)]'
                      : 'bg-[rgba(150,62,90,0.08)]'
                }
                emptyLabel="No canonical ranking rows found for these filters."
              />
            )
          ) : (
            <EmptyState
              title="No board rows found"
              description="Adjust the current filters or upload more ranking screenshots for the selected week."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild variant="outline" className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1">
                    <Link href="/upload">Upload Screenshots</Link>
                  </Button>
                  <Button variant="outline" className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1" onClick={resetFilters}>
                    Reset Filters
                  </Button>
                </div>
              }
            />
          )}
        </Panel>
      </SessionGate>
    </div>
  );
}
