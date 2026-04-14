'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  CheckCircle2,
  RefreshCw,
  Shield,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
import {
  DataTableLite,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHero,
  Panel,
  StatusPill,
} from '@/components/ui/primitives';

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

function fmt(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : value;
}

function complianceIcon(status: string) {
  if (status === 'PASS') return <CheckCircle2 size={14} color="var(--clr-good)" />;
  if (status === 'FAIL') return <XCircle size={14} color="var(--clr-bad)" />;
  if (status === 'NO_BASELINE') return <CircleAlert size={14} color="var(--clr-warn)" />;
  return <span className="text-muted">—</span>;
}

function overallTone(status: string): 'good' | 'bad' | 'warn' | 'neutral' {
  if (status === 'PASS') return 'good';
  if (status === 'FAIL') return 'bad';
  if (status === 'PARTIAL') return 'warn';
  return 'neutral';
}

const ALLIANCE_FILTER_OPTIONS = [
  { value: '', label: 'All Alliances' },
  { value: 'GODt', label: '[GODt]' },
  { value: 'V57', label: '[V57]' },
  { value: 'P57R', label: '[P57R]' },
];

export default function ActivityPage() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
    refreshSession,
  } = useWorkspaceSession();

  const [weeks, setWeeks] = useState<WeekOption[]>([]);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>('');
  const [allianceFilter, setAllianceFilter] = useState<string>('');
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'rank' | 'player' | 'contribution' | 'fort' | 'power' | 'kp' | 'overall'>('contribution');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Load available weeks
  const loadWeeks = useCallback(async () => {
    if (!workspaceReady) return;
    try {
      const res = await fetch(
        `/api/v2/activity/weeks?workspaceId=${encodeURIComponent(workspaceId)}`,
        { headers: { 'x-access-token': accessToken } }
      );
      const payload = await res.json();
      if (res.ok && Array.isArray(payload?.data)) {
        setWeeks(payload.data as WeekOption[]);
        if (!selectedWeekKey && payload.data.length > 0) {
          setSelectedWeekKey(payload.data[0].weekKey);
        }
      }
    } catch {
      // Silently fail — weeks will be empty
    }
  }, [workspaceId, accessToken, workspaceReady, selectedWeekKey]);

  // Load activity data for selected week
  const loadActivity = useCallback(async (weekKey?: string) => {
    if (!workspaceReady) return;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity data.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, accessToken, workspaceReady, selectedWeekKey]);

  useEffect(() => {
    if (workspaceReady) {
      void loadWeeks();
    }
  }, [workspaceReady, loadWeeks]);

  useEffect(() => {
    if (workspaceReady && selectedWeekKey) {
      void loadActivity(selectedWeekKey);
    }
  }, [workspaceReady, selectedWeekKey, loadActivity]);

  // Week navigation
  const currentWeekIndex = useMemo(
    () => weeks.findIndex((w) => w.weekKey === selectedWeekKey),
    [weeks, selectedWeekKey]
  );
  const goPreviousWeek = () => {
    if (currentWeekIndex < weeks.length - 1) {
      setSelectedWeekKey(weeks[currentWeekIndex + 1].weekKey);
    }
  };
  const goNextWeek = () => {
    if (currentWeekIndex > 0) {
      setSelectedWeekKey(weeks[currentWeekIndex - 1].weekKey);
    }
  };

  // Filter rows by alliance
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
      const diff = BigInt(a) - BigInt(b);
      if (diff === BigInt(0)) return 0;
      return diff > BigInt(0) ? 1 : -1;
    };

    rows.sort((a, b) => {
      if (sortKey === 'rank') return 0;
      if (sortKey === 'player') {
        return a.governorName.localeCompare(b.governorName);
      }
      if (sortKey === 'overall') {
        return a.compliance.overall.localeCompare(b.compliance.overall);
      }
      if (sortKey === 'contribution') {
        const diff = BigInt(a.contributionPoints) - BigInt(b.contributionPoints);
        return diff === BigInt(0) ? 0 : diff > BigInt(0) ? 1 : -1;
      }
      if (sortKey === 'fort') {
        const diff = BigInt(a.fortDestroying) - BigInt(b.fortDestroying);
        return diff === BigInt(0) ? 0 : diff > BigInt(0) ? 1 : -1;
      }
      if (sortKey === 'power') {
        return compareBigIntMaybe(a.powerGrowth, b.powerGrowth);
      }
      return compareBigIntMaybe(a.killPointsGrowth, b.killPointsGrowth);
    });

    if (sortDir === 'desc') rows.reverse();
    return rows;
  }, [filteredRows, sortDir, sortKey]);

  const handleSort = useCallback((nextKey: string) => {
    const key = nextKey as typeof sortKey;
    if (key === sortKey) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'player' || key === 'overall' ? 'asc' : 'desc');
  }, [sortKey]);

  // Compute filtered summary
  const filteredSummary = useMemo(() => {
    const alliances = data?.summary?.allianceSummary || [];
    if (!allianceFilter) return alliances;
    return alliances.filter((a) => a.allianceTag === allianceFilter);
  }, [data?.summary?.allianceSummary, allianceFilter]);

  // Aggregate KPIs
  const kpis = useMemo(() => {
    const rows = sortedRows;
    return {
      total: rows.length,
      pass: rows.filter((r) => r.compliance.overall === 'PASS').length,
      fail: rows.filter((r) => r.compliance.overall === 'FAIL').length,
      partial: rows.filter((r) => r.compliance.overall === 'PARTIAL').length,
      noPowerBaseline: rows.filter((r) => !r.powerBaselineReady).length,
      noKillPointsBaseline: rows.filter((r) => !r.killPointsBaselineReady).length,
      passRate: rows.length > 0
        ? Math.round((rows.filter((r) => r.compliance.overall === 'PASS').length / rows.length) * 100)
        : 0,
    };
  }, [sortedRows]);

  const columns = useMemo(() => [
    {
      key: 'rank',
      label: '#',
      sortable: true,
      className: 'num',
      render: (_row: ActivityRow, index: number) => index + 1,
    },
    {
      key: 'player',
      label: 'Player',
      sortable: true,
      render: (row: ActivityRow) => (
        <div className="ranking-player-cell">
          <strong className="ranking-player-name">{row.governorName}</strong>
          <div className="ranking-player-meta">
            <span className={`ranking-alliance-pill alliance-${row.allianceTag.toLowerCase()}`}>
              {row.allianceTag}
            </span>
            <span className="ranking-id-pill">ID {row.governorId}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'contribution',
      label: 'Contribution',
      sortable: true,
      className: 'num',
      render: (row: ActivityRow) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
          {complianceIcon(row.compliance.contributionPoints)}
          <span>{fmt(row.contributionPoints)}</span>
        </div>
      ),
    },
    {
      key: 'fort',
      label: 'Fort Destroy',
      sortable: true,
      className: 'num',
      render: (row: ActivityRow) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
          {complianceIcon(row.compliance.fortDestroying)}
          <span>{fmt(row.fortDestroying)}</span>
        </div>
      ),
    },
    {
      key: 'power',
      label: 'Power Growth',
      sortable: true,
      className: 'num',
      render: (row: ActivityRow) => {
        const val = row.powerGrowth != null ? BigInt(row.powerGrowth) : null;
        const isNeg = val != null && val < BigInt(0);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
            {complianceIcon(row.compliance.powerGrowth)}
            <span className={isNeg ? 'delta-negative' : ''}>
              {row.powerGrowth != null ? fmt(row.powerGrowth) : 'N/A'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'kp',
      label: 'KP Growth',
      sortable: true,
      className: 'num',
      render: (row: ActivityRow) => {
        const val = row.killPointsGrowth != null ? BigInt(row.killPointsGrowth) : null;
        const isNeg = val != null && val < BigInt(0);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
            {complianceIcon(row.compliance.killPointsGrowth)}
            <span className={isNeg ? 'delta-negative' : ''}>
              {row.killPointsGrowth != null ? fmt(row.killPointsGrowth) : 'N/A'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'overall',
      label: 'Status',
      sortable: true,
      render: (row: ActivityRow) => (
        <StatusPill label={row.compliance.overall} tone={overallTone(row.compliance.overall)} />
      ),
    },
  ], []);

  return (
    <div className="page-container">
      <PageHero
        title="Weekly Activity"
        subtitle="Player compliance tracking across all activity metrics — contribution, fort destroying, power growth, and kill points."
        actions={
          <FilterBar>
            <button className="btn btn-secondary" onClick={() => void loadActivity()} disabled={loading || !workspaceReady}>
              <RefreshCw size={14} /> {loading ? 'Loading...' : 'Refresh'}
            </button>
            <button className="btn btn-secondary" onClick={() => void refreshSession()} disabled={sessionLoading}>
              {sessionLoading ? 'Connecting...' : 'Reconnect'}
            </button>
          </FilterBar>
        }
      />

      {!workspaceReady ? (
        <div className="card mb-24">
          <div className="text-sm text-muted">
            {sessionLoading ? 'Connecting workspace...' : sessionError || 'Workspace session is not ready yet.'}
          </div>
        </div>
      ) : null}

      {/* Week Navigator */}
      <section className="ranking-controls-card mb-16">
        <FilterBar className="ranking-controls-top">
          <button
            className="btn btn-secondary btn-sm"
            onClick={goPreviousWeek}
            disabled={currentWeekIndex >= weeks.length - 1 || loading}
          >
            <ArrowLeft size={14} /> Prev Week
          </button>
          <div className="form-group" style={{ minWidth: 200, marginBottom: 0 }}>
            <select
              className="form-select"
              value={selectedWeekKey}
              onChange={(e) => setSelectedWeekKey(e.target.value)}
            >
              {weeks.length === 0 ? (
                <option value="">No weeks available</option>
              ) : (
                weeks.map((w) => (
                  <option key={w.weekKey} value={w.weekKey}>
                    {w.name} ({w.weekKey})
                  </option>
                ))
              )}
            </select>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={goNextWeek}
            disabled={currentWeekIndex <= 0 || loading}
          >
            Next Week <ArrowRight size={14} />
          </button>
        </FilterBar>

        {/* Alliance filter */}
        <FilterBar style={{ marginTop: 8 }}>
          {ALLIANCE_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`btn btn-sm ${allianceFilter === opt.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setAllianceFilter(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </FilterBar>
      </section>

      {error ? <div className="delta-negative mb-16">{error}</div> : null}

      {data ? (
        <>
          {/* KPI Cards */}
          <div className="grid-4 mb-24 animate-fade-in-up">
            <KpiCard
              icon={<Activity size={18} />}
              label="Tracked"
              value={kpis.total}
              hint="Members with activity data"
              tone="info"
            />
            <KpiCard
              icon={<CheckCircle2 size={18} />}
              label="Passed"
              value={kpis.pass}
              hint={`${kpis.passRate}% pass rate`}
              tone="good"
            />
            <KpiCard
              icon={<XCircle size={18} />}
              label="Failed"
              value={kpis.fail}
              hint="Below minimum standards"
              tone={kpis.fail > 0 ? 'bad' : 'good'}
            />
            <KpiCard
              icon={<TrendingUp size={18} />}
              label="Partial"
              value={kpis.partial}
              hint="Some metrics pass, some fail"
              tone={kpis.partial > 0 ? 'warn' : 'good'}
            />
          </div>

          <FilterBar className="mb-16">
            <StatusPill
              label={`No Power Baseline: ${kpis.noPowerBaseline}`}
              tone={kpis.noPowerBaseline > 0 ? 'warn' : 'good'}
            />
            <StatusPill
              label={`No KP Baseline: ${kpis.noKillPointsBaseline}`}
              tone={kpis.noKillPointsBaseline > 0 ? 'warn' : 'good'}
            />
            <StatusPill
              label={`Unlinked Identity Rows: ${data.summary.unresolvedIdentityCount}`}
              tone={data.summary.unresolvedIdentityCount > 0 ? 'warn' : 'good'}
            />
          </FilterBar>

          {/* Alliance Summary Cards */}
          {filteredSummary.length > 0 ? (
            <div className="grid-3 mb-24">
              {filteredSummary.map((alliance) => {
                const total = alliance.members || 1;
                const passPercent = Math.round((alliance.passCount / total) * 100);
                return (
                  <Panel key={alliance.allianceTag} title={alliance.allianceLabel} className="mb-0">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                      <StatusPill label={`${alliance.passCount} pass`} tone="good" />
                      <StatusPill label={`${alliance.failCount} fail`} tone={alliance.failCount > 0 ? 'bad' : 'good'} />
                      <StatusPill label={`${alliance.members} total`} tone="info" />
                    </div>
                    <div className="activity-progress-bar" style={{ marginBottom: 12 }}>
                      <div className="activity-progress-fill" style={{ width: `${passPercent}%` }} />
                    </div>
                    <div className="text-sm text-muted" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                      <span>Contribution: <strong>{fmt(alliance.totalContribution)}</strong></span>
                      <span>Fort: <strong>{fmt(alliance.totalFortDestroying)}</strong></span>
                      <span>Power Growth: <strong>{fmt(alliance.totalPowerGrowth)}</strong></span>
                      <span>KP Growth: <strong>{fmt(alliance.totalKillPointsGrowth)}</strong></span>
                    </div>
                  </Panel>
                );
              })}
            </div>
          ) : null}

          <div className="grid-2 mb-24">
            <Panel title="Top Contribution" subtitle="Current week leaders">
              {(data.summary.topContribution || []).slice(0, 5).map((row) => (
                <div key={`contrib-${row.governorDbId}`} className="ranking-mobile-meta-line" style={{ justifyContent: 'space-between' }}>
                  <span>{row.governorName}</span>
                  <strong>{fmt(row.contributionPoints)}</strong>
                </div>
              ))}
            </Panel>
            <Panel title="Top Power Growth" subtitle="Baseline-ready rows">
              {(data.summary.topPowerGrowth || []).slice(0, 5).map((row) => (
                <div key={`power-${row.governorDbId}`} className="ranking-mobile-meta-line" style={{ justifyContent: 'space-between' }}>
                  <span>{row.governorName}</span>
                  <strong>{row.powerGrowth != null ? fmt(row.powerGrowth) : 'N/A'}</strong>
                </div>
              ))}
            </Panel>
          </div>

          {/* Player Compliance Table */}
          <Panel
            title="Player Compliance"
            subtitle={`${filteredRows.length} members • ${data.event.name}`}
            actions={
              <FilterBar>
                <Shield size={14} />
                <span className="text-sm text-muted">
                  {data.previousEvent ? `Compared vs ${data.previousEvent.name}` : 'No previous week for delta comparison'}
                </span>
              </FilterBar>
            }
          >
            {sortedRows.length > 0 ? (
              <DataTableLite
                stickyFirst
                dense
                rows={sortedRows}
                rowKey={(row) => row.governorDbId}
                columns={columns}
                onSort={handleSort}
                sortKey={sortKey}
                sortDir={sortDir}
                rowClassName={(row) =>
                  [
                    'ranking-player-row',
                    row.compliance.overall === 'PASS' ? 'is-active' : '',
                    row.compliance.overall === 'FAIL' ? 'is-rejected' : '',
                    row.compliance.overall === 'PARTIAL' ? 'is-unresolved' : '',
                  ].filter(Boolean).join(' ')
                }
                emptyLabel="No activity data for these filters."
              />
            ) : (
              <EmptyState
                title="No activity data"
                description="Upload ranking screenshots and governor profiles to begin weekly tracking."
              />
            )}
          </Panel>
        </>
      ) : !loading ? (
        <EmptyState
          title="Activity not loaded"
          description="Select a week and refresh to view player compliance data."
        />
      ) : null}
    </div>
  );
}
