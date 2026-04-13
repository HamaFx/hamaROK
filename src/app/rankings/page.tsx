'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Filter, Layers, Search, SlidersHorizontal } from 'lucide-react';
import {
  ActionToolbar,
  DataTableLite,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHero,
  Panel,
  StatusPill,
} from '@/components/ui/primitives';

type RankingStatus = 'ACTIVE' | 'UNRESOLVED' | 'REJECTED';

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
  updatedAt: string;
}

interface SummaryPayload {
  total: number;
  statusCounts: Record<string, number>;
  rankingTypes: Array<{ rankingType: string; metricKey: string; total: number }>;
  topBuckets?: {
    top100: { count: number; totalMetric: string; averageMetric: string };
    top200: { count: number; totalMetric: string; averageMetric: string };
    top400: { count: number; totalMetric: string; averageMetric: string };
  };
}

function formatMetric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : value;
}

const ALL_STATUSES: RankingStatus[] = ['ACTIVE', 'UNRESOLVED', 'REJECTED'];

export default function RankingsPage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [eventId, setEventId] = useState('');
  const [rankingType, setRankingType] = useState('');
  const [metricKey, setMetricKey] = useState('');
  const [search, setSearch] = useState('');
  const [statuses, setStatuses] = useState<RankingStatus[]>(['ACTIVE', 'UNRESOLVED']);
  const [rows, setRows] = useState<CanonicalRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [dense, setDense] = useState(false);
  const [showMetaCols, setShowMetaCols] = useState(false);
  const [sortHint, setSortHint] = useState('metricValue DESC, sourceRank ASC, normalizedName ASC, rowId ASC');

  useEffect(() => {
    setWorkspaceId(localStorage.getItem('workspaceId') || '');
    setAccessToken(localStorage.getItem('workspaceToken') || '');
  }, []);

  useEffect(() => {
    if (workspaceId) localStorage.setItem('workspaceId', workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    if (accessToken) localStorage.setItem('workspaceToken', accessToken);
  }, [accessToken]);

  const statusQuery = useMemo(() => statuses.join(','), [statuses]);

  const loadData = useCallback(
    async (cursor: string | null = null) => {
      if (!workspaceId || !accessToken) return;
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          workspaceId,
          limit: '50',
          status: statusQuery,
        });

        if (eventId.trim()) params.set('eventId', eventId.trim());
        if (rankingType.trim()) params.set('rankingType', rankingType.trim());
        if (metricKey.trim()) params.set('metricKey', metricKey.trim());
        if (search.trim()) params.set('q', search.trim());
        if (cursor) params.set('cursor', cursor);

        const [rowsRes, summaryRes] = await Promise.all([
          fetch(`/api/v2/rankings?${params.toString()}`, {
            headers: { 'x-access-token': accessToken },
          }),
          fetch(
            `/api/v2/rankings/summary?${new URLSearchParams({
              workspaceId,
              ...(eventId.trim() ? { eventId: eventId.trim() } : {}),
              ...(rankingType.trim() ? { rankingType: rankingType.trim() } : {}),
              ...(metricKey.trim() ? { metricKey: metricKey.trim() } : {}),
              topN: '15',
            }).toString()}`,
            {
              headers: { 'x-access-token': accessToken },
            }
          ),
        ]);

        const rowsPayload = await rowsRes.json();
        const summaryPayload = await summaryRes.json();

        if (!rowsRes.ok) {
          throw new Error(rowsPayload?.error?.message || 'Failed to load canonical rankings.');
        }

        setRows(Array.isArray(rowsPayload?.data) ? rowsPayload.data : []);
        setNextCursor(rowsPayload?.meta?.nextCursor || null);
        if (Array.isArray(rowsPayload?.meta?.sort) && rowsPayload.meta.sort.length > 0) {
          setSortHint(rowsPayload.meta.sort.join(', '));
        }

        if (summaryRes.ok && summaryPayload?.data) {
          setSummary(summaryPayload.data as SummaryPayload);
        } else {
          setSummary(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load rankings.');
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, accessToken, eventId, rankingType, metricKey, search, statusQuery]
  );

  const refresh = useCallback(() => {
    setCursorStack([null]);
    setNextCursor(null);
    loadData(null);
  }, [loadData]);

  useEffect(() => {
    if (workspaceId && accessToken) refresh();
  }, [workspaceId, accessToken, refresh]);

  const goNext = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, nextCursor]);
    loadData(nextCursor);
  };

  const goBack = () => {
    if (cursorStack.length <= 1) return;
    const next = [...cursorStack];
    next.pop();
    const previousCursor = next[next.length - 1] || null;
    setCursorStack(next);
    loadData(previousCursor);
  };

  const toggleStatus = (status: RankingStatus) => {
    setStatuses((prev) =>
      prev.includes(status) ? prev.filter((entry) => entry !== status) : [...prev, status]
    );
  };

  const columns = useMemo(() => {
    const base = [
      {
        key: 'stable',
        label: 'Stable Rank',
        className: 'num',
        render: (row: CanonicalRow) => (
          <>
            #{row.stableRank}
            {row.conflictFlags?.tie ? <span className="text-muted"> (T{row.tieGroup})</span> : null}
          </>
        ),
      },
      {
        key: 'governor',
        label: 'Governor',
        render: (row: CanonicalRow) => (
          <>
            <strong>{row.governorNameRaw || 'Unknown'}</strong>
            <div className="text-sm text-muted">{row.governorId ? `ID ${row.governorId}` : 'No profile link'}</div>
          </>
        ),
      },
      {
        key: 'metric',
        label: 'Metric',
        className: 'num',
        render: (row: CanonicalRow) => formatMetric(row.metricValue),
      },
      {
        key: 'source',
        label: 'Source Rank',
        className: 'num',
        render: (row: CanonicalRow) => row.sourceRank ?? '—',
      },
      {
        key: 'status',
        label: 'Status',
        render: (row: CanonicalRow) => (
          <StatusPill
            label={row.status}
            tone={row.status === 'ACTIVE' ? 'good' : row.status === 'UNRESOLVED' ? 'warn' : 'bad'}
          />
        ),
      },
      {
        key: 'updated',
        label: 'Updated',
        render: (row: CanonicalRow) => new Date(row.updatedAt).toLocaleString(),
      },
    ];

    if (!showMetaCols) return base;

    return [
      ...base.slice(0, 2),
      {
        key: 'type',
        label: 'Type / Metric',
        render: (row: CanonicalRow) => `${row.rankingType} / ${row.metricKey}`,
      },
      ...base.slice(2),
      {
        key: 'event',
        label: 'Event ID',
        className: 'font-mono text-sm text-muted',
        render: (row: CanonicalRow) => row.eventId,
      },
    ];
  }, [showMetaCols]);

  return (
    <div className="page-container">
      <PageHero
        title="Canonical Rankings"
        subtitle="Deterministic sorting, tie-aware display, and stable pagination for review-safe operations."
        badges={['Stable sort contract', sortHint]}
        actions={
          <>
            <button className="btn btn-secondary" onClick={refresh} disabled={loading}>
              <Filter size={14} /> {loading ? 'Loading...' : 'Refresh'}
            </button>
            <button className="btn btn-secondary" onClick={() => setDense((prev) => !prev)}>
              <SlidersHorizontal size={14} /> {dense ? 'Comfortable' : 'Dense'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowMetaCols((prev) => !prev)}>
              <Layers size={14} /> {showMetaCols ? 'Hide Meta' : 'Show Meta'}
            </button>
          </>
        }
      />

      <Panel title="Workspace + Filters" subtitle="Scoped ranking list with cursor pagination" className="mb-24">
        <div className="grid-2">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Workspace ID</label>
            <input className="form-input" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Access Token</label>
            <input className="form-input" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
          </div>
        </div>

        <FilterBar className="mt-12">
          <div className="form-group" style={{ marginBottom: 0, minWidth: 180 }}>
            <label className="form-label">Event ID</label>
            <input className="form-input" value={eventId} onChange={(e) => setEventId(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 180 }}>
            <label className="form-label">Ranking Type</label>
            <input className="form-input" value={rankingType} onChange={(e) => setRankingType(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 180 }}>
            <label className="form-label">Metric Key</label>
            <input className="form-input" value={metricKey} onChange={(e) => setMetricKey(e.target.value)} />
          </div>
          <div className="search-bar" style={{ minWidth: 220 }}>
            <Search size={14} className="search-icon" />
            <input placeholder="Search governor..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </FilterBar>

        <FilterBar className="mt-12">
          {ALL_STATUSES.map((status) => (
            <button
              key={status}
              className={`btn btn-sm ${statuses.includes(status) ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => toggleStatus(status)}
              type="button"
            >
              {status}
            </button>
          ))}
          <button className="btn btn-secondary btn-sm" onClick={refresh} disabled={loading}>
            Apply Filters
          </button>
        </FilterBar>
      </Panel>

      {summary ? (
        <div className="grid-4 mb-24">
          <KpiCard label="Total Rows" value={summary.total} hint="Canonical snapshot rows" tone="info" />
          <KpiCard label="Active" value={summary.statusCounts.ACTIVE || 0} hint="Ready for analytics" tone="good" />
          <KpiCard
            label="Unresolved"
            value={summary.statusCounts.UNRESOLVED || 0}
            hint="Need identity review"
            tone={(summary.statusCounts.UNRESOLVED || 0) > 0 ? 'warn' : 'good'}
          />
          <KpiCard label="Rejected" value={summary.statusCounts.REJECTED || 0} hint="Excluded from canonical" tone="bad" />
        </div>
      ) : null}

      {summary?.topBuckets ? (
        <Panel title="Top-N Buckets" subtitle="Contribution totals by stable rank buckets" className="mb-24">
          <div className="grid-3">
            <KpiCard
              label="Top 100"
              value={formatMetric(summary.topBuckets.top100.totalMetric)}
              hint={`${summary.topBuckets.top100.count} rows`}
              tone="warn"
            />
            <KpiCard
              label="Top 200"
              value={formatMetric(summary.topBuckets.top200.totalMetric)}
              hint={`${summary.topBuckets.top200.count} rows`}
              tone="info"
            />
            <KpiCard
              label="Top 400"
              value={formatMetric(summary.topBuckets.top400.totalMetric)}
              hint={`${summary.topBuckets.top400.count} rows`}
              tone="neutral"
            />
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Canonical Ranking Rows"
        subtitle="Order: metricValue DESC, sourceRank ASC NULLS LAST, normalizedName ASC, rowId ASC"
        actions={
          <ActionToolbar>
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

        {rows.length > 0 ? (
          <DataTableLite
            stickyFirst
            dense={dense}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            emptyLabel="No canonical ranking rows found for these filters."
          />
        ) : (
          <EmptyState
            title="No canonical rows found"
            description="Try broadening status/type filters or verify workspace link access."
          />
        )}
      </Panel>
    </div>
  );
}
