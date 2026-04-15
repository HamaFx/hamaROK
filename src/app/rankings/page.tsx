'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Crown,
  Download,
  Filter,
  LayoutGrid,
  Save,
  Search,
  Sparkles,
  Table2,
  Trash2,
} from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { splitGovernorNameAndAlliance } from '@/lib/alliances';
import {
  ActionToolbar,
  DataTableLite,
  EmptyState,
  FilterBar,
  PageHero,
  Panel,
  StatusPill,
} from '@/components/ui/primitives';

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

function formatMetric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : value;
}

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

function allianceClass(tag: string | null) {
  if (!tag) return '';
  return `alliance-${tag.toLowerCase()}`;
}

function parseBigIntSafe(value: string | null | undefined): bigint | null {
  if (!value) return null;
  try {
    const parsed = BigInt(value);
    return parsed >= BigInt(0) ? parsed : BigInt(0);
  } catch {
    return null;
  }
}

function formatRelativeDate(iso: string): string {
  const now = Date.now();
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return 'unknown';
  const deltaMs = Math.max(0, now - ts);
  const hours = Math.floor(deltaMs / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function csvValue(value: string | number | null | undefined): string {
  const raw = value == null ? '' : String(value);
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function downloadCsv(filename: string, lines: string[]) {
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const RANKING_TYPE_FILTERS = [
  { value: '', label: 'All Types' },
  { value: 'individual_power', label: 'Individual Power' },
  { value: 'mad_scientist', label: 'Mad Scientist' },
  { value: 'fort_destroyer', label: 'Fort Destroyer' },
  { value: 'kill_point', label: 'Kill Point' },
];

const METRIC_FILTERS = [
  { value: '', label: 'All Metrics' },
  { value: 'power', label: 'Power' },
  { value: 'contribution_points', label: 'Contribution Points' },
  { value: 'fort_destroying', label: 'Fort Destroying' },
  { value: 'kill_points', label: 'Kill Points' },
];

const ALLIANCE_FILTERS = [
  { value: '', label: 'All Alliances' },
  { value: 'GODt', label: '[GODt]' },
  { value: 'V57', label: '[V57]' },
  { value: 'P57R', label: '[P57R]' },
];

export default function RankingsPage() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
  } = useWorkspaceSession();

  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<CanonicalRow[]>([]);
  const [weeklyEvent, setWeeklyEvent] = useState<WeeklyEventInfo | null>(null);
  const [weeks, setWeeks] = useState<WeeklyEventInfo[]>([]);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>('');
  const [rankingTypeFilter, setRankingTypeFilter] = useState('');
  const [metricFilter, setMetricFilter] = useState('');
  const [allianceFilter, setAllianceFilter] = useState('');
  const [weeklyActivity, setWeeklyActivity] = useState<WeeklyActivityResponse | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denseRows, setDenseRows] = useState(false);
  const [viewMode, setViewMode] = useState<RankingsViewMode>('auto');
  const [metricVisualMode, setMetricVisualMode] = useState<MetricVisualMode>('numeric');
  const [sortHint, setSortHint] = useState(
    'metricValue DESC, sourceRank ASC NULLS LAST, normalizedName ASC, rowId ASC'
  );
  const [presets, setPresets] = useState<RankingsFilterPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [uiNotice, setUiNotice] = useState<string | null>(null);

  const presetStorageKey = useMemo(
    () => `hama:rankings:presets:${workspaceId || 'unknown'}`,
    [workspaceId]
  );

  const loadWeekOptions = useCallback(async () => {
    if (!workspaceReady) {
      setWeeks([]);
      setWeeklyEvent(null);
      return null;
    }

    try {
      const weeksRes = await fetch(
        `/api/v2/activity/weeks?workspaceId=${encodeURIComponent(workspaceId)}&limit=26`,
        {
          headers: { 'x-access-token': accessToken },
        }
      );
      const weeksPayload = await weeksRes.json();
      const weekRows = (Array.isArray(weeksPayload?.data) ? weeksPayload.data : []) as WeeklyEventInfo[];

      if (weekRows.length > 0) {
        setWeeks(weekRows);
        const preferred = weekRows.find((week) => week.weekKey === selectedWeekKey) || weekRows[0];
        setSelectedWeekKey(preferred.weekKey || '');
        setWeeklyEvent(preferred);
        return preferred.weekKey || null;
      }

      const weeklyRes = await fetch(
        `/api/v2/events/weekly?workspaceId=${encodeURIComponent(workspaceId)}&autoCreate=true`,
        {
          headers: { 'x-access-token': accessToken },
        }
      );
      const weeklyPayload = await weeklyRes.json();
      if (!weeklyRes.ok || !weeklyPayload?.data?.id) {
        setWeeks([]);
        setWeeklyEvent(null);
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
      setWeeklyEvent(week);
      setSelectedWeekKey(week.weekKey || '');
      return week.weekKey || null;
    } catch {
      setWeeks([]);
      setWeeklyEvent(null);
      return null;
    }
  }, [workspaceId, accessToken, workspaceReady, selectedWeekKey]);

  const loadWeeklyActivity = useCallback(
    async (weekKey: string | null) => {
      if (!workspaceReady) {
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
        if (activityRes.ok && activityPayload?.data) {
          setWeeklyActivity(activityPayload.data as WeeklyActivityResponse);
        } else {
          setWeeklyActivity(null);
        }
      } catch {
        setWeeklyActivity(null);
      }
    },
    [workspaceId, accessToken, workspaceReady]
  );

  const loadData = useCallback(
    async (cursor: string | null = null, weekKeyOverride?: string | null) => {
      if (!workspaceReady) return;
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          workspaceId,
          limit: '50',
          includeUnresolved: 'false',
        });

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
        if (Array.isArray(rowsPayload?.meta?.sort) && rowsPayload.meta.sort.length > 0) {
          setSortHint(rowsPayload.meta.sort.join(', '));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load rankings.');
      } finally {
        setLoading(false);
      }
    },
    [
      workspaceId,
      accessToken,
      search,
      workspaceReady,
      selectedWeekKey,
      rankingTypeFilter,
      metricFilter,
      allianceFilter,
    ]
  );

  const runSearch = useCallback(() => {
    setCursorStack([null]);
    setNextCursor(null);
    void loadData(null, selectedWeekKey || null);
  }, [loadData, selectedWeekKey]);

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
    if (workspaceReady) {
      refresh();
    }
  }, [workspaceReady, refresh]);

  useEffect(() => {
    if (!workspaceReady || !selectedWeekKey) return;
    const selectedWeek = weeks.find((week) => week.weekKey === selectedWeekKey) || null;
    if (selectedWeek) {
      setWeeklyEvent(selectedWeek);
    }
    setCursorStack([null]);
    setNextCursor(null);
    void Promise.all([loadWeeklyActivity(selectedWeekKey), loadData(null, selectedWeekKey)]);
  }, [
    workspaceReady,
    selectedWeekKey,
    rankingTypeFilter,
    metricFilter,
    allianceFilter,
    weeks,
    loadWeeklyActivity,
    loadData,
  ]);

  useEffect(() => {
    if (!workspaceReady) return;
    try {
      const raw = localStorage.getItem(presetStorageKey);
      const parsed = raw ? (JSON.parse(raw) as RankingsFilterPreset[]) : [];
      if (Array.isArray(parsed)) {
        setPresets(parsed);
      } else {
        setPresets([]);
      }
    } catch {
      setPresets([]);
    }
  }, [workspaceReady, presetStorageKey]);

  useEffect(() => {
    if (!uiNotice) return;
    const timer = window.setTimeout(() => setUiNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [uiNotice]);

  const currentWeekIndex = useMemo(
    () => weeks.findIndex((week) => week.weekKey === selectedWeekKey),
    [weeks, selectedWeekKey]
  );

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

  const spotlightRows = useMemo(() => {
    const activeRows = displayRows.filter((row) => row.status === 'ACTIVE');
    const base = activeRows.length >= 3 ? activeRows : displayRows;
    return base.slice(0, 3);
  }, [displayRows]);

  const freshness = useMemo(() => {
    if (displayRows.length === 0) return null;
    const latest = displayRows.reduce((current, row) => {
      const ts = new Date(row.updatedAt).getTime();
      if (!Number.isFinite(ts)) return current;
      return ts > current ? ts : current;
    }, 0);

    if (!latest) return null;

    const hoursOld = Math.floor((Date.now() - latest) / 3_600_000);
    if (hoursOld <= 24) {
      return {
        tone: 'good' as const,
        label: `Fresh ${formatRelativeDate(new Date(latest).toISOString())}`,
      };
    }
    if (hoursOld <= 72) {
      return {
        tone: 'warn' as const,
        label: `Aging ${formatRelativeDate(new Date(latest).toISOString())}`,
      };
    }
    return {
      tone: 'bad' as const,
      label: `Outdated ${formatRelativeDate(new Date(latest).toISOString())}`,
    };
  }, [displayRows]);

  const latestWeekKey = weeks[0]?.weekKey || '';
  const isHistoricalWeek = Boolean(selectedWeekKey && latestWeekKey && selectedWeekKey !== latestWeekKey);

  const savePreset = useCallback(() => {
    if (!workspaceReady) return;
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
  }, [
    workspaceReady,
    presetName,
    presets,
    search,
    rankingTypeFilter,
    metricFilter,
    allianceFilter,
    selectedWeekKey,
    denseRows,
    viewMode,
    metricVisualMode,
    presetStorageKey,
  ]);

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
    if (target) {
      setUiNotice(`Deleted preset: ${target.name}`);
    }
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
    if (displayRows.length === 0) return;

    const headers = [
      'Stable Rank',
      'Player',
      'Alliance',
      'Governor ID',
      'Metric',
      'Metric Value',
      'Board',
      'Source Rank',
      'Status',
      'Updated At',
    ];

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

  const columns = useMemo(() => {
    const base = [
      {
        key: 'stable',
        label: 'Rank',
        className: 'num',
        render: (row: DisplayRankingRow) => (
          <div className="ranking-rank-cell">
            <span className={`ranking-rank-chip ${row.stableRank <= 3 ? 'top' : ''}`}>#{row.stableRank}</span>
            {row.conflictFlags?.tie ? (
              <span className="ranking-tie-pill">Tie Group {row.tieGroup}</span>
            ) : (
              <span className="ranking-rank-sub">Stable</span>
            )}
          </div>
        ),
      },
      {
        key: 'governor',
        label: 'Player',
        render: (row: DisplayRankingRow) => (
          <div className="ranking-player-cell">
            <div className="ranking-player-head">
              <strong className="ranking-player-name">{row.displayName}</strong>
              {row.titleRaw ? <span className="ranking-title-pill">{row.titleRaw}</span> : null}
            </div>
            <div className="ranking-player-meta">
              {row.allianceLabel ? (
                <span className={`ranking-alliance-pill ${allianceClass(row.allianceTag)}`}>
                  {row.allianceLabel}
                </span>
              ) : (
                <span className="ranking-alliance-pill neutral">No alliance</span>
              )}
              <span className="ranking-id-pill">
                {row.linkedGovernorId ? `ID ${row.linkedGovernorId}` : 'Unlinked profile'}
              </span>
            </div>
          </div>
        ),
      },
      {
        key: 'metric',
        label: 'Metric',
        className: 'num',
        render: (row: DisplayRankingRow) => (
          <div className="ranking-metric-cell">
            <strong>{formatMetric(row.metricValue)}</strong>
            {metricVisualMode === 'bars' ? (
              <div className="ranking-metric-progress">
                <span>{row.metricLabel}</span>
                <div className="ranking-metric-progress-track" aria-label={`${row.metricRatio.toFixed(1)} percent of top score`}>
                  <div
                    className="ranking-metric-progress-fill"
                    style={{ width: `${Math.max(4, row.metricRatio)}%` }}
                  />
                </div>
              </div>
            ) : (
              <span>{row.metricLabel}</span>
            )}
          </div>
        ),
      },
      {
        key: 'board',
        label: 'Board',
        mobileHidden: true,
        render: (row: DisplayRankingRow) => <span className="ranking-board-label">{row.boardLabel}</span>,
      },
      {
        key: 'source',
        label: 'Source Rank',
        className: 'num',
        mobileHidden: true,
        render: (row: DisplayRankingRow) => (
          <span className="ranking-source-value">{row.sourceRank ? `#${row.sourceRank}` : '—'}</span>
        ),
      },
      {
        key: 'status',
        label: 'State',
        render: (row: DisplayRankingRow) => (
          <div className="ranking-status-cell">
            <StatusPill label={row.status} tone={statusTone(row.status)} />
            {row.conflictFlags?.tie ? <span className="ranking-status-note">Shared score</span> : null}
          </div>
        ),
      },
      {
        key: 'updated',
        label: 'Updated',
        mobileHidden: true,
        render: (row: DisplayRankingRow) => (
          <span className="ranking-updated">{new Date(row.updatedAt).toLocaleString()}</span>
        ),
      },
    ];

    return base;
  }, [metricVisualMode]);

  return (
    <div className="page-container">
      <PageHero
        title="Rankings Board"
        subtitle="Leaderboard with strict filters, saved presets, export, and weekly navigation."
      />

      {!workspaceReady ? (
        <div className="card mb-24">
          <div className="text-sm text-muted">
            {sessionLoading ? 'Connecting workspace...' : sessionError || 'Workspace session is not ready yet.'}
          </div>
        </div>
      ) : null}

      {weeklyEvent ? (
        <section className="ranking-controls-card mb-16">
          <FilterBar className="ranking-controls-top">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={goPreviousWeek}
                disabled={loading || currentWeekIndex >= weeks.length - 1}
              >
                <ArrowLeft size={14} /> Prev Week
              </button>
              <select
                className="form-select"
                value={selectedWeekKey}
                onChange={(event) => setSelectedWeekKey(event.target.value)}
                style={{ minWidth: 240 }}
              >
                {weeks.map((week) => (
                  <option key={week.id} value={week.weekKey || ''}>
                    {week.name}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-secondary btn-sm"
                onClick={goNextWeek}
                disabled={loading || currentWeekIndex <= 0}
              >
                Next Week <ArrowRight size={14} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {weeklyActivity ? (
                <div className="text-sm text-muted">
                  Tracked Members: <strong>{weeklyActivity.summary.membersTracked}</strong>
                </div>
              ) : null}
              {isHistoricalWeek ? <StatusPill label="Historical Week" tone="info" /> : null}
              {freshness ? <StatusPill label={freshness.label} tone={freshness.tone} /> : null}
            </div>
          </FilterBar>

          <FilterBar style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <span className="text-sm text-muted">
              {weeklyEvent.weekKey || 'week key pending'}
              {weeklyEvent.startsAt
                ? ` • ${new Date(weeklyEvent.startsAt).toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}`
                : ''}
            </span>
            {weeklyActivity?.summary?.unresolvedIdentityCount != null ? (
              <StatusPill
                label={`Unlinked rows ${weeklyActivity.summary.unresolvedIdentityCount}`}
                tone={weeklyActivity.summary.unresolvedIdentityCount > 0 ? 'warn' : 'good'}
              />
            ) : null}
            {weeklyActivity?.summary?.noPowerBaselineCount != null ? (
              <StatusPill
                label={`No power baseline ${weeklyActivity.summary.noPowerBaselineCount}`}
                tone={weeklyActivity.summary.noPowerBaselineCount > 0 ? 'warn' : 'good'}
              />
            ) : null}
            {weeklyActivity?.summary?.noKillPointsBaselineCount != null ? (
              <StatusPill
                label={`No KP baseline ${weeklyActivity.summary.noKillPointsBaselineCount}`}
                tone={weeklyActivity.summary.noKillPointsBaselineCount > 0 ? 'warn' : 'good'}
              />
            ) : null}
          </FilterBar>

          {weeklyActivity?.summary?.allianceSummary?.length ? (
            <div className="ranking-mobile-meta-line" style={{ marginTop: 10, flexWrap: 'wrap' }}>
              {weeklyActivity.summary.allianceSummary.map((alliance) => (
                <span key={alliance.allianceTag}>
                  {alliance.allianceLabel}: {alliance.passCount}/{alliance.members} pass
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="ranking-controls-card mb-16">
        <FilterBar className="ranking-controls-top">
          <div className="search-bar" style={{ minWidth: 240, flex: 1 }}>
            <Search size={16} className="search-icon" style={{ marginLeft: '4px' }} />
            <input
              placeholder="Search player name or governor ID..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  runSearch();
                }
              }}
            />
          </div>
          <select
            className="form-select"
            value={rankingTypeFilter}
            onChange={(event) => setRankingTypeFilter(event.target.value)}
            style={{ minWidth: 190 }}
          >
            {RANKING_TYPE_FILTERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            className="form-select"
            value={metricFilter}
            onChange={(event) => setMetricFilter(event.target.value)}
            style={{ minWidth: 190 }}
          >
            {METRIC_FILTERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-secondary"
            onClick={runSearch}
            disabled={loading || !workspaceReady}
            style={{ padding: '0 16px' }}
          >
            <Filter size={14} /> Search
          </button>
        </FilterBar>

        <FilterBar style={{ marginTop: 10 }}>
          {ALLIANCE_FILTERS.map((alliance) => (
            <button
              key={alliance.value}
              className={`btn btn-sm ${allianceFilter === alliance.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setAllianceFilter(alliance.value)}
            >
              {alliance.label}
            </button>
          ))}
        </FilterBar>

        <FilterBar className="ranking-advanced-strip" style={{ marginTop: 10 }}>
          <select
            className="form-select"
            style={{ minWidth: 210 }}
            value={selectedPresetId}
            onChange={(event) => applyPreset(event.target.value)}
          >
            <option value="">Saved presets</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          <input
            className="form-input"
            style={{ minWidth: 190, width: 220 }}
            placeholder="Preset name"
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
          />
          <button className="btn btn-secondary btn-sm" onClick={savePreset} type="button">
            <Save size={14} /> Save Preset
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={deleteSelectedPreset}
            type="button"
            disabled={!selectedPresetId}
          >
            <Trash2 size={14} /> Delete
          </button>
          <button className="btn btn-secondary btn-sm" onClick={resetFilters} type="button">
            Reset
          </button>

          <span className="ranking-segment-wrap" role="group" aria-label="view mode">
            <button
              className={`ranking-segment ${viewMode === 'auto' ? 'active' : ''}`}
              onClick={() => setViewMode('auto')}
              type="button"
            >
              <Sparkles size={13} /> Auto
            </button>
            <button
              className={`ranking-segment ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
              type="button"
            >
              <Table2 size={13} /> Table
            </button>
            <button
              className={`ranking-segment ${viewMode === 'cards' ? 'active' : ''}`}
              onClick={() => setViewMode('cards')}
              type="button"
            >
              <LayoutGrid size={13} /> Cards
            </button>
          </span>

          <span className="ranking-segment-wrap" role="group" aria-label="metric visual mode">
            <button
              className={`ranking-segment ${metricVisualMode === 'numeric' ? 'active' : ''}`}
              onClick={() => setMetricVisualMode('numeric')}
              type="button"
            >
              Numeric
            </button>
            <button
              className={`ranking-segment ${metricVisualMode === 'bars' ? 'active' : ''}`}
              onClick={() => setMetricVisualMode('bars')}
              type="button"
            >
              Bars
            </button>
          </span>
        </FilterBar>

        {uiNotice ? (
          <div className="text-sm text-muted" style={{ marginTop: 8 }}>
            {uiNotice}
          </div>
        ) : null}
      </section>

      {spotlightRows.length > 0 ? (
        <section className="ranking-spotlight-grid mb-16">
          {spotlightRows.map((row, index) => (
            <article key={row.id} className={`ranking-spotlight-card spotlight-${index + 1}`}>
              <div className="ranking-spotlight-head">
                <span className="ranking-spotlight-rank">
                  <Crown size={14} />
                  #{row.stableRank}
                </span>
                <StatusPill label={row.status} tone={statusTone(row.status)} />
              </div>
              <strong className="ranking-spotlight-name">{row.displayName}</strong>
              <div className="ranking-spotlight-meta">
                {row.allianceLabel ? (
                  <span className={`ranking-alliance-pill ${allianceClass(row.allianceTag)}`}>
                    {row.allianceLabel}
                  </span>
                ) : (
                  <span className="ranking-alliance-pill neutral">No alliance</span>
                )}
                <span className="ranking-id-pill">
                  {row.linkedGovernorId ? `ID ${row.linkedGovernorId}` : 'Unlinked profile'}
                </span>
              </div>
              <div className="ranking-spotlight-metric">{formatMetric(row.metricValue)}</div>
              <div className="ranking-spotlight-foot">{row.boardLabel}</div>
            </article>
          ))}
        </section>
      ) : null}

      <Panel
        title="Leaderboard"
        subtitle={`Sort: ${sortHint}`}
        actions={
          <ActionToolbar>
            <button className="btn btn-secondary btn-sm" onClick={() => setDenseRows((prev) => !prev)} type="button">
              {denseRows ? 'Comfort Spacing' : 'Compact Rows'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={exportLeaderboardCsv} disabled={displayRows.length === 0}>
              <Download size={14} /> Export CSV
            </button>
            <button className="btn btn-secondary btn-sm" onClick={goBack} disabled={loading || cursorStack.length <= 1}>
              <ArrowLeft size={14} /> Prev
            </button>
            <button className="btn btn-secondary btn-sm" onClick={goNext} disabled={loading || !nextCursor}>
              Next <ArrowRight size={14} />
            </button>
          </ActionToolbar>
        }
      >
        {error ? <div className="delta-negative mb-12">{error}</div> : null}

        {displayRows.length > 0 ? (
          <>
            {viewMode !== 'cards' ? (
              <div className="ranking-desktop-table">
                <DataTableLite
                  stickyFirst
                  dense={denseRows}
                  mobileCards={viewMode === 'table'}
                  columns={columns}
                  rows={displayRows}
                  rowKey={(row) => row.id}
                  rowClassName={(row) =>
                    [
                      'ranking-player-row',
                      row.status === 'ACTIVE'
                        ? 'is-active'
                        : row.status === 'UNRESOLVED'
                          ? 'is-unresolved'
                          : 'is-rejected',
                      row.stableRank <= 3 ? 'is-top' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')
                  }
                  emptyLabel="No canonical ranking rows found for these filters."
                />
              </div>
            ) : null}

            {viewMode !== 'table' ? (
              <div className={`ranking-mobile-list ${viewMode === 'cards' ? 'force-grid' : ''}`} aria-label="Ranking rows card view">
                {displayRows.map((row) => (
                  <article key={row.id} className={`ranking-mobile-card ${row.stableRank <= 3 ? 'is-top' : ''}`}>
                    <header className="ranking-mobile-head">
                      <span className={`ranking-rank-chip ${row.stableRank <= 3 ? 'top' : ''}`}>#{row.stableRank}</span>
                      <div className="ranking-mobile-metric-main">
                        <span>{row.metricLabel}</span>
                        <strong>{formatMetric(row.metricValue)}</strong>
                      </div>
                      <StatusPill label={row.status} tone={statusTone(row.status)} />
                    </header>

                    <div className="ranking-mobile-main">
                      <div className="ranking-mobile-name-wrap">
                        <strong className="ranking-mobile-name">{row.displayName}</strong>
                        {row.titleRaw ? <span className="ranking-title-pill">{row.titleRaw}</span> : null}
                      </div>
                      <div className="ranking-player-meta">
                        {row.allianceLabel ? (
                          <span className={`ranking-alliance-pill ${allianceClass(row.allianceTag)}`}>
                            {row.allianceLabel}
                          </span>
                        ) : (
                          <span className="ranking-alliance-pill neutral">No alliance</span>
                        )}
                        <span className="ranking-id-pill">
                          {row.linkedGovernorId ? `ID ${row.linkedGovernorId}` : 'Unlinked profile'}
                        </span>
                      </div>
                    </div>

                    <div className="ranking-mobile-meta-line">
                      <span>Source {row.sourceRank ? `#${row.sourceRank}` : '—'}</span>
                      <span>{formatTokenLabel(row.rankingType)}</span>
                      <span>
                        {new Date(row.updatedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>

                    {row.conflictFlags?.tie ? (
                      <div className="ranking-mobile-foot">Tie Group {row.tieGroup} • Shared score</div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState
            title="No players found"
            description="Try adjusting your filters or upload new ranking screenshots for this week."
            action={
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link href="/upload" className="btn btn-secondary btn-sm">
                  Upload Screenshots
                </Link>
                <button type="button" className="btn btn-secondary btn-sm" onClick={resetFilters}>
                  Reset Filters
                </button>
              </div>
            }
          />
        )}
      </Panel>
    </div>
  );
}
