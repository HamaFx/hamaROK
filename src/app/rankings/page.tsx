'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Crown, Filter, RefreshCw, Search } from 'lucide-react';
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
  const [rows, setRows] = useState<CanonicalRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denseRows, setDenseRows] = useState(false);
  const [sortHint, setSortHint] = useState(
    'metricValue DESC, sourceRank ASC NULLS LAST, normalizedName ASC, rowId ASC'
  );

  const loadData = useCallback(
    async (cursor: string | null = null) => {
      if (!workspaceReady) return;
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          workspaceId,
          limit: '50',
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
    [workspaceId, accessToken, search, workspaceReady]
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

  const displayRows = useMemo<DisplayRankingRow[]>(() => {
    return rows.map((row) => {
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
      };
    });
  }, [rows]);

  const spotlightRows = useMemo(() => {
    const activeRows = displayRows.filter((row) => row.status === 'ACTIVE');
    const base = activeRows.length >= 3 ? activeRows : displayRows;
    return base.slice(0, 3);
  }, [displayRows]);

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
            <span>{row.metricLabel}</span>
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
        render: (row: DisplayRankingRow) => <span className="ranking-updated">{new Date(row.updatedAt).toLocaleString()}</span>,
      },
    ];

    return base;
  }, []);

  return (
    <div className="page-container">
      <PageHero
        title="Rankings Board"
        subtitle="Clean leaderboard view with tie-aware ordering and stable ranking history."
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

      <section className="ranking-controls-card mb-16">
        <FilterBar className="ranking-controls-top">
          <div className="search-bar" style={{ minWidth: 240, flex: 1 }}>
            <Search size={16} className="search-icon" style={{ marginLeft: '4px' }} />
            <input placeholder="Search player name or governor ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-secondary" onClick={refresh} disabled={loading || !workspaceReady} style={{ padding: '0 16px' }}>
            <Filter size={14} /> Search
          </button>
        </FilterBar>
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
            <div className="ranking-desktop-table">
              <DataTableLite
                stickyFirst
                dense={denseRows}
                mobileCards={false}
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

            <div className="ranking-mobile-list" aria-label="Ranking rows mobile cards">
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
                    <span>{new Date(row.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </div>

                  {row.conflictFlags?.tie ? <div className="ranking-mobile-foot">Tie Group {row.tieGroup} • Shared score</div> : null}
                </article>
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            title="No players found"
            description="Try adjusting your search term."
          />
        )}
      </Panel>
    </div>
  );
}
