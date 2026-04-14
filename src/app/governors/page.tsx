'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, TrendingUp } from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { abbreviateNumber } from '@/lib/utils';
import { GrowthLineChart, WeeklyActivityLineChart } from '@/components/Charts';
import {
  DataTableLite,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHero,
  Panel,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';

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
  contributionPoints: string;
  fortDestroying: string;
  powerGrowth: string | null;
  killPointsGrowth: string | null;
  compliance: {
    overall: 'PASS' | 'FAIL' | 'PARTIAL' | 'NO_STANDARD';
  };
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
    compliance: {
      overall: 'PASS' | 'FAIL' | 'PARTIAL' | 'NO_STANDARD';
    };
  } | null;
}

export default function GovernorsPage() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
  } = useWorkspaceSession();

  const [governors, setGovernors] = useState<GovernorItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(null);
  const [weeklyActivityRows, setWeeklyActivityRows] = useState<Record<string, WeeklyActivityRow>>({});
  const [weeklyHistory, setWeeklyHistory] = useState<WeeklyActivityHistoryEntry[] | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGovernors = useCallback(async (q = '') => {
    if (!workspaceReady) {
      setGovernors([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setError(null);
      const params = new URLSearchParams({
        workspaceId,
        search: q,
        limit: '200',
      });
      const res = await fetch(`/api/v2/governors?${params.toString()}`, {
        headers: {
          'x-access-token': accessToken,
        },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to load governors.');
      }
      const list = Array.isArray(payload?.data) ? payload.data : [];
      setGovernors(list);
      setTotal(Number(payload?.meta?.total || 0));

      const weeklyRes = await fetch(
        `/api/v2/activity/weekly?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          headers: {
            'x-access-token': accessToken,
          },
        }
      );
      const weeklyPayload = await weeklyRes.json();
      if (weeklyRes.ok && Array.isArray(weeklyPayload?.data?.rows)) {
        const map: Record<string, WeeklyActivityRow> = {};
        for (const row of weeklyPayload.data.rows as WeeklyActivityRow[]) {
          map[row.governorDbId] = row;
        }
        setWeeklyActivityRows(map);
      } else {
        setWeeklyActivityRows({});
      }
    } catch (cause) {
      setGovernors([]);
      setTotal(0);
      setWeeklyActivityRows({});
      setError(cause instanceof Error ? cause.message : 'Failed to load governors.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, accessToken, workspaceReady]);

  useEffect(() => {
    void fetchGovernors();
  }, [fetchGovernors]);

  useEffect(() => {
    const timeout = setTimeout(() => void fetchGovernors(search), 250);
    return () => clearTimeout(timeout);
  }, [search, fetchGovernors]);

  const toggleExpand = async (id: string) => {
    if (!workspaceReady) {
      setError(sessionLoading ? 'Connecting workspace session...' : 'Workspace session is not ready.');
      return;
    }

    if (expandedId === id) {
      setExpandedId(null);
      setTimeline(null);
      setWeeklyHistory(null);
      return;
    }

    setExpandedId(id);
    setTimelineLoading(true);

    try {
      setError(null);
      const params = new URLSearchParams({ workspaceId });
      const [timelineRes, weeklyRes] = await Promise.all([
        fetch(`/api/v2/governors/${id}/timeline?${params.toString()}`, {
          headers: {
            'x-access-token': accessToken,
          },
        }),
        fetch(
          `/api/v2/governors/${id}/weekly-activity?${new URLSearchParams({
            workspaceId,
            limit: '12',
          }).toString()}`,
          {
            headers: {
              'x-access-token': accessToken,
            },
          }
        ),
      ]);
      const timelinePayload = await timelineRes.json();
      const weeklyPayload = await weeklyRes.json();
      if (!timelineRes.ok) {
        throw new Error(timelinePayload?.error?.message || 'Failed to load timeline.');
      }
      setTimeline(timelinePayload?.data?.timeline || []);
      if (weeklyRes.ok && Array.isArray(weeklyPayload?.data?.history)) {
        setWeeklyHistory(weeklyPayload.data.history as WeeklyActivityHistoryEntry[]);
      } else {
        setWeeklyHistory([]);
      }
    } catch (cause) {
      setTimeline([]);
      setWeeklyHistory([]);
      setError(cause instanceof Error ? cause.message : 'Failed to load timeline.');
    } finally {
      setTimelineLoading(false);
    }
  };

  const avgSnapshots = useMemo(() => {
    if (governors.length === 0) return 0;
    return Math.round(governors.reduce((sum, governor) => sum + governor.snapshotCount, 0) / governors.length);
  }, [governors]);

  const governorsWithHighPower = useMemo(
    () => governors.filter((governor) => Number(governor.latestPower || 0) >= 100000000).length,
    [governors]
  );

  return (
    <div className="page-container">
      <PageHero
        title="Governor Registry"
        subtitle="Roster and timeline drill-down for each governor."
      />

      {!workspaceReady ? (
        <div className="card mb-24">
          <div className="text-sm text-muted">
            {sessionLoading ? 'Connecting workspace...' : sessionError || 'Workspace session is not ready yet.'}
          </div>
        </div>
      ) : null}
      {error ? <div className="delta-negative mb-16">{error}</div> : null}

      <div className="grid-4 mb-24">
        <KpiCard label="Tracked Governors" value={total} hint="Roster identities indexed" tone="info" />
        <KpiCard label="Visible Rows" value={governors.length} hint="Current search result count" tone="neutral" />
        <KpiCard label="Avg Snapshots" value={avgSnapshots} hint="Average snapshots per governor" tone="good" />
        <KpiCard label="100M+ Power" value={governorsWithHighPower} hint="High-power profiles in view" tone="warn" />
      </div>

      <Panel
        title="Governor Table"
        subtitle="Search by governor name or game ID"
        actions={
          <FilterBar>
            <div className="search-bar" style={{ minWidth: 240 }}>
              <Search size={14} className="search-icon" />
              <input
                placeholder="Search governor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <StatusPill label={`${governors.length} rows`} tone="info" />
          </FilterBar>
        }
      >
        {loading ? (
          <SkeletonSet rows={5} />
        ) : governors.length === 0 ? (
          <EmptyState
            title={search ? 'No matching governors' : 'No governors yet'}
            description={search ? 'Try another search term.' : 'Upload profile screenshots to build the roster.'}
          />
        ) : (
          <DataTableLite
            stickyFirst
            rows={governors}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'rank',
                label: '#',
                className: 'num',
                render: (_row, index) => index + 1,
              },
              {
                key: 'governor',
                label: 'Governor',
                render: (row) => (
                  <>
                    <strong>{row.name}</strong>
                    <div className="text-sm text-muted">ID {row.governorId}</div>
                  </>
                ),
              },
              {
                key: 'alliance',
                label: 'Alliance',
                mobileHidden: true,
                render: (row) => row.alliance || '—',
              },
              {
                key: 'power',
                label: 'Latest Power',
                className: 'num',
                render: (row) => abbreviateNumber(row.latestPower),
              },
              {
                key: 'snapshots',
                label: 'Snapshots',
                className: 'num',
                mobileHidden: true,
                render: (row) => row.snapshotCount,
              },
              {
                key: 'contribution',
                label: 'Week Contribution',
                className: 'num',
                mobileHidden: true,
                render: (row) =>
                  Number(
                    weeklyActivityRows[row.id]?.contributionPoints || 0
                  ).toLocaleString(),
              },
              {
                key: 'fort',
                label: 'Week Fort',
                className: 'num',
                mobileHidden: true,
                render: (row) =>
                  Number(weeklyActivityRows[row.id]?.fortDestroying || 0).toLocaleString(),
              },
              {
                key: 'powerGrowth',
                label: 'Week Power',
                className: 'num',
                mobileHidden: true,
                render: (row) => {
                  const value = weeklyActivityRows[row.id]?.powerGrowth;
                  return value != null ? Number(value).toLocaleString() : 'N/A';
                },
              },
              {
                key: 'kpGrowth',
                label: 'Week KP',
                className: 'num',
                mobileHidden: true,
                render: (row) => {
                  const value = weeklyActivityRows[row.id]?.killPointsGrowth;
                  return value != null ? Number(value).toLocaleString() : 'N/A';
                },
              },
              {
                key: 'action',
                label: 'Action',
                render: (row) => (
                  <button className="btn btn-secondary btn-sm" onClick={() => toggleExpand(row.id)}>
                    <TrendingUp size={13} /> {expandedId === row.id ? 'Hide timeline' : 'View timeline'}
                  </button>
                ),
              },
            ]}
          />
        )}
      </Panel>

      {expandedId ? (
        <Panel title="Governor Timeline" subtitle="Power, kill points, and deads across events" className="mt-24">
          {timelineLoading ? (
            <SkeletonSet rows={3} />
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
            <EmptyState title="No timeline data" description="This governor has no progression history yet." />
          )}

          {!timelineLoading && weeklyHistory && weeklyHistory.length > 0 ? (
            <div className="mt-16">
              <WeeklyActivityLineChart
                timeline={[...weeklyHistory]
                  .reverse()
                  .map((entry) => ({
                    weekName: entry.weekKey,
                    contributionPoints: Number(entry.metrics?.contributionPoints || 0),
                    fortDestroying: Number(entry.metrics?.fortDestroying || 0),
                    powerGrowth: Number(entry.metrics?.powerGrowth || 0),
                    killPointsGrowth: Number(entry.metrics?.killPointsGrowth || 0),
                  }))}
              />
              <table className="data-table data-table-dense">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th className="num">Contribution</th>
                    <th className="num">Fort</th>
                    <th className="num">Power Growth</th>
                    <th className="num">KP Growth</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyHistory.map((entry) => (
                    <tr key={entry.weekKey}>
                      <td>{entry.weekName}</td>
                      <td className="num">
                        {entry.metrics
                          ? Number(entry.metrics.contributionPoints).toLocaleString()
                          : 'N/A'}
                      </td>
                      <td className="num">
                        {entry.metrics
                          ? Number(entry.metrics.fortDestroying).toLocaleString()
                          : 'N/A'}
                      </td>
                      <td className="num">
                        {entry.metrics?.powerGrowth != null
                          ? Number(entry.metrics.powerGrowth).toLocaleString()
                          : 'N/A'}
                      </td>
                      <td className="num">
                        {entry.metrics?.killPointsGrowth != null
                          ? Number(entry.metrics.killPointsGrowth).toLocaleString()
                          : 'N/A'}
                      </td>
                      <td>
                        <StatusPill
                          label={entry.metrics?.compliance.overall || 'NO_DATA'}
                          tone={
                            entry.metrics?.compliance.overall === 'PASS'
                              ? 'good'
                              : entry.metrics?.compliance.overall === 'FAIL'
                                ? 'bad'
                                : entry.metrics
                                  ? 'warn'
                                  : 'neutral'
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <FilterBar className="mt-16">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setExpandedId(null);
                setWeeklyHistory(null);
              }}
            >
              Close Timeline
            </button>
          </FilterBar>
        </Panel>
      ) : null}
    </div>
  );
}
