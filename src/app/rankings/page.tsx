'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Filter, RefreshCw, Search } from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
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

function formatMetric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : value;
}

const ALL_STATUSES: RankingStatus[] = ['ACTIVE', 'UNRESOLVED', 'REJECTED'];

export default function RankingsPage() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
    refreshSession,
  } = useWorkspaceSession();

  const [search, setSearch] = useState('');
  const [statuses, setStatuses] = useState<RankingStatus[]>(['ACTIVE', 'UNRESOLVED']);
  const [rows, setRows] = useState<CanonicalRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortHint, setSortHint] = useState(
    'metricValue DESC, sourceRank ASC NULLS LAST, normalizedName ASC, rowId ASC'
  );

  const statusQuery = useMemo(() => statuses.join(','), [statuses]);

  const loadData = useCallback(
    async (cursor: string | null = null) => {
      if (!workspaceReady) return;
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          workspaceId,
          limit: '50',
          status: statusQuery,
        });

        if (search.trim()) params.set('q', search.trim());
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
    [workspaceId, accessToken, search, statusQuery, workspaceReady]
  );

  const refresh = useCallback(() => {
    setCursorStack([null]);
    setNextCursor(null);
    loadData(null);
  }, [loadData]);

  useEffect(() => {
    if (workspaceReady) {
      refresh();
    }
  }, [workspaceReady, refresh]);

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
        label: 'Rank',
        className: 'num',
        render: (row: CanonicalRow) => (
          <div>
            <strong>#{row.stableRank}</strong>
            {row.conflictFlags?.tie ? <span className="text-muted"> • Tie {row.tieGroup}</span> : null}
          </div>
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
        mobileHidden: true,
        render: (row: CanonicalRow) => row.sourceRank ?? '—',
      },
      {
        key: 'status',
        label: 'State',
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
        mobileHidden: true,
        render: (row: CanonicalRow) => new Date(row.updatedAt).toLocaleString(),
      },
    ];

    return base;
  }, []);

  const activeCount = rows.filter((row) => row.status === 'ACTIVE').length;
  const unresolvedCount = rows.filter((row) => row.status === 'UNRESOLVED').length;
  const rejectedCount = rows.filter((row) => row.status === 'REJECTED').length;

  return (
    <div className="page-container">
      <PageHero
        title="Rankings Board"
        subtitle="Stable ordering, tie-aware display, and review-driven canonical ranking state."
        actions={
          <FilterBar>
            <button className="btn btn-secondary" onClick={refresh} disabled={loading || !workspaceReady}>
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
          <div className="text-sm text-muted">{sessionLoading ? 'Connecting workspace...' : sessionError || 'Workspace session is not ready yet.'}</div>
        </div>
      ) : null}

      <FilterBar className="mb-24">
        <div className="search-bar" style={{ minWidth: 260, flex: 1 }}>
          <Search size={16} className="search-icon" style={{ marginLeft: '4px' }} />
          <input placeholder="Search governor name or ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-secondary" onClick={refresh} disabled={loading || !workspaceReady} style={{ padding: '0 16px' }}>
          <Filter size={14} /> Search
        </button>
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
      </FilterBar>

      <FilterBar className="mb-16">
        <StatusPill label={`Rows ${rows.length}`} tone="info" />
        <StatusPill label={`Active ${activeCount}`} tone="good" />
        <StatusPill label={`Unresolved ${unresolvedCount}`} tone={unresolvedCount > 0 ? 'warn' : 'good'} />
        {rejectedCount > 0 ? <StatusPill label={`Rejected ${rejectedCount}`} tone="bad" /> : null}
      </FilterBar>

      <Panel
        title="Ranking Rows"
        subtitle={`Stable order: ${sortHint}`}
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
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            emptyLabel="No canonical ranking rows found for these filters."
          />
        ) : (
          <EmptyState
            title="No canonical rows found"
            description="Try broadening type/status filters and search filters."
          />
        )}
      </Panel>
    </div>
  );
}
