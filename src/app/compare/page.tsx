'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowDownUp, Download, Medal, Send, Swords, Users } from 'lucide-react';
import { formatDelta } from '@/lib/utils';
import { getTierConfig, WarriorTier } from '@/lib/warrior-score';
import TierBadge from '@/components/TierBadge';
import { KillsBarChart, TierPieChart } from '@/components/Charts';
import { DataTableLite, EmptyState, FilterBar, KpiCard, PageHero, Panel } from '@/components/ui/primitives';

interface Comparison {
  governor: { id: string; governorId: string; name: string };
  deltas: Record<string, string>;
  snapshotA: Record<string, string>;
  snapshotB: Record<string, string>;
  warriorScore: {
    actualDkp: number;
    expectedKp: number;
    kdRatio: number;
    totalScore: number;
    isDeadweight: boolean;
    tier: WarriorTier;
    rank: number;
  } | null;
}

interface CompareResult {
  eventA: { id: string; name: string; eventType: string };
  eventB: { id: string; name: string; eventType: string };
  comparisons: Comparison[];
  summary: {
    totalGovernors: number;
    avgWarriorScore: number;
    tierDistribution: Record<string, number>;
  };
}

interface EventOption {
  id: string;
  name: string;
  eventType: string;
}

function CompareContent() {
  const searchParams = useSearchParams();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventAId, setEventAId] = useState(searchParams.get('eventA') || '');
  const [eventBId, setEventBId] = useState(searchParams.get('eventB') || '');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortField, setSortField] = useState('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    fetch('/api/events')
      .then((r) => r.json())
      .then((data) => setEvents(data.events || []));
  }, []);

  useEffect(() => {
    if (!eventAId || !eventBId) return;
    setLoading(true);
    fetch(`/api/compare?eventA=${eventAId}&eventB=${eventBId}`)
      .then((r) => r.json())
      .then((data) => setResult(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [eventAId, eventBId]);

  const sortedComparisons = useMemo(() => {
    const rows = result?.comparisons || [];

    return rows
      .filter((item) => !search || item.governor.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        let aVal: number;
        let bVal: number;

        if (sortField === 'rank') {
          aVal = a.warriorScore?.rank || Number.MAX_SAFE_INTEGER;
          bVal = b.warriorScore?.rank || Number.MAX_SAFE_INTEGER;
        } else if (sortField === 'score') {
          aVal = a.warriorScore?.totalScore || 0;
          bVal = b.warriorScore?.totalScore || 0;
        } else {
          aVal = Number(a.deltas[sortField] || 0);
          bVal = Number(b.deltas[sortField] || 0);
        }

        return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
      });
  }, [result?.comparisons, search, sortDir, sortField]);

  const exportCSV = () => {
    if (!result) return;
    const headers =
      'Rank,Governor,ID,Start Power,Power Delta,Actual DKP,Expected DKP,KD Ratio,Score,Tier,Deadweight\n';
    const rows = sortedComparisons
      .map(
        (item) =>
          `${item.warriorScore?.rank || '-'},${item.governor.name},${item.governor.governorId},${item.snapshotA.power},${item.deltas.power},${item.warriorScore?.actualDkp || 0},${item.warriorScore?.expectedKp || 0},${item.warriorScore?.kdRatio || 0},${item.warriorScore?.totalScore || 0},${item.warriorScore?.tier || '-'},${item.warriorScore?.isDeadweight ? 'YES' : 'NO'}`
      )
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `comparison_${result.eventA.name}_vs_${result.eventB.name}.csv`.replace(/\s+/g, '_');
    link.click();
    URL.revokeObjectURL(url);
  };

  const publishToDiscord = async () => {
    if (!result) return;
    setPublishing(true);

    try {
      const res = await fetch('/api/discord/publish-leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventA: result.eventA,
          eventB: result.eventB,
          summary: result.summary,
          leaderboard: sortedComparisons,
        }),
      });

      if (res.ok) {
        alert('Leaderboard published to Discord.');
      } else {
        const payload = await res.json();
        alert(payload?.error || 'Publish failed.');
      }
    } catch {
      alert('Network error while publishing.');
    } finally {
      setPublishing(false);
    }
  };

  const onSort = (field: string) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortField(field);
    setSortDir(field === 'rank' ? 'asc' : 'desc');
  };

  return (
    <div className="page-container">
      <PageHero
        title="Compare Events"
        subtitle="Calculate deltas, rank warrior output, and publish combat leaderboards."
        actions={
          <>
            <button className="btn btn-secondary" onClick={exportCSV} disabled={!result}>
              <Download size={14} /> Export CSV
            </button>
            <button className="btn btn-primary" onClick={publishToDiscord} disabled={!result || publishing}>
              <Send size={14} /> {publishing ? 'Publishing...' : 'Publish to Discord'}
            </button>
          </>
        }
      />

      <Panel title="Comparison Setup" subtitle="Pick baseline and current event snapshots">
        <FilterBar>
          <div className="form-group" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
            <label className="form-label">Event A (Baseline)</label>
            <select className="form-select" value={eventAId} onChange={(e) => setEventAId(e.target.value)}>
              <option value="">Select baseline event</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </div>
          <div className="compare-vs">VS</div>
          <div className="form-group" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
            <label className="form-label">Event B (Current)</label>
            <select className="form-select" value={eventBId} onChange={(e) => setEventBId(e.target.value)}>
              <option value="">Select current event</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </div>
        </FilterBar>
      </Panel>

      {loading ? (
        <Panel title="Loading comparison" className="mt-24">
          <div className="shimmer shimmer-row" />
          <div className="shimmer shimmer-row" />
          <div className="shimmer shimmer-row" />
        </Panel>
      ) : null}

      {!loading && result ? (
        <>
          <div className="grid-3 mt-24 mb-24 animate-fade-in-up">
            <KpiCard
              label="Governors Compared"
              value={result.summary.totalGovernors}
              hint="Common governors across both events"
              tone="info"
            />
            <KpiCard
              label="Avg Warrior Score"
              value={`${result.summary.avgWarriorScore}%`}
              hint="Aggregate score across matched governors"
              tone="good"
            />
            <KpiCard
              label="War Legends"
              value={result.summary.tierDistribution['War Legend'] || 0}
              hint="Tier threshold exceeded"
              tone="warn"
            />
          </div>

          <Panel title="Warrior Leaderboard" subtitle="Top 10 by weighted total score" className="mb-24">
            {sortedComparisons.slice(0, 10).map((item) => {
              const score = item.warriorScore;
              if (!score) return null;
              const config = getTierConfig(score.tier);

              return (
                <div className="leaderboard-entry" key={item.governor.id}>
                  <div className={`leaderboard-rank ${score.rank <= 3 ? 'top-3' : ''}`}>
                    {score.rank <= 3 ? ['#1', '#2', '#3'][score.rank - 1] : `#${score.rank}`}
                  </div>
                  <div className="leaderboard-name">
                    <strong>{item.governor.name}</strong>
                    <div className="text-sm text-muted">ID {item.governor.governorId}</div>
                  </div>
                  <div className="leaderboard-score">
                    <div className="score-bar-wrap">
                      <div className="score-bar-track">
                        <div className="score-bar-fill" style={{ width: `${score.totalScore}%`, background: config.color }} />
                      </div>
                      <span className="score-bar-value" style={{ color: config.color }}>
                        {score.totalScore}
                      </span>
                    </div>
                    <TierBadge tier={score.tier} size="sm" />
                  </div>
                </div>
              );
            })}
          </Panel>

          <div className="grid-2 mb-24">
            <KillsBarChart
              data={sortedComparisons.map((item) => ({
                name: item.governor.name,
                killDelta: Number(item.deltas.killPoints),
              }))}
            />
            <TierPieChart distribution={result.summary.tierDistribution} />
          </div>

          <Panel
            title="Full Comparison Table"
            subtitle="Deterministic ranking and sortable combat deltas"
            actions={
              <FilterBar>
                <div className="search-bar">
                  <input
                    placeholder="Search governor..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <button className="btn btn-ghost btn-sm" type="button">
                  <ArrowDownUp size={14} /> Stable sort
                </button>
              </FilterBar>
            }
          >
            <DataTableLite
              stickyFirst
              columns={[
                {
                  key: 'rank',
                  label: 'Rank',
                  sortable: true,
                  render: (row: Comparison) => row.warriorScore?.rank || '—',
                },
                {
                  key: 'governor',
                  label: 'Governor',
                  render: (row: Comparison) => (
                    <>
                      <strong>{row.governor.name}</strong>
                      <div className="text-sm text-muted">ID {row.governor.governorId}</div>
                    </>
                  ),
                },
                {
                  key: 'power',
                  label: 'Power Delta',
                  sortable: true,
                  className: 'num',
                  render: (row: Comparison) => (
                    <span className={Number(row.deltas.power) >= 0 ? 'delta-positive' : 'delta-negative'}>
                      {formatDelta(row.deltas.power)}
                    </span>
                  ),
                },
                {
                  key: 'target',
                  label: 'Target DKP',
                  className: 'num',
                  mobileHidden: true,
                  render: (row: Comparison) => formatDelta(row.warriorScore?.expectedKp || 0),
                },
                {
                  key: 'actual',
                  label: 'Actual DKP',
                  className: 'num',
                  mobileHidden: true,
                  render: (row: Comparison) => formatDelta(row.warriorScore?.actualDkp || 0),
                },
                {
                  key: 'kd',
                  label: 'KD Ratio',
                  className: 'num',
                  mobileHidden: true,
                  render: (row: Comparison) => row.warriorScore?.kdRatio || 0,
                },
                {
                  key: 'score',
                  label: 'Score',
                  sortable: true,
                  className: 'num',
                  render: (row: Comparison) => `${row.warriorScore?.totalScore || 0}%`,
                },
                {
                  key: 'tier',
                  label: 'Tier',
                  render: (row: Comparison) =>
                    row.warriorScore ? (
                      <>
                        <TierBadge tier={row.warriorScore.tier} size="sm" showLabel={false} />
                        {row.warriorScore.rank <= 3 ? <Medal size={13} style={{ marginLeft: 6 }} /> : null}
                      </>
                    ) : (
                      '—'
                    ),
                },
              ]}
              rows={sortedComparisons}
              rowKey={(row) => row.governor.id}
              onSort={onSort}
              sortKey={sortField}
              sortDir={sortDir}
              emptyLabel="No governors matched the current filter."
            />
          </Panel>
        </>
      ) : null}

      {!loading && !result && (!eventAId || !eventBId) ? (
        <div className="mt-24">
          <EmptyState
            title="Select two events to start comparison"
            description="Choose baseline and current events to compute ranking and combat deltas."
            action={
              <button className="btn btn-secondary" type="button">
                <Users size={14} /> Waiting for selection
              </button>
            }
          />
        </div>
      ) : null}

      {!loading && !result && eventAId && eventBId ? (
        <div className="mt-24">
          <EmptyState
            title="No comparison data found"
            description="One or both events may not have compatible snapshots yet."
            action={
              <button className="btn btn-secondary" type="button">
                <Swords size={14} /> Check ingestion
              </button>
            }
          />
        </div>
      ) : null}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="page-container"><div className="shimmer shimmer-card" /></div>}>
      <CompareContent />
    </Suspense>
  );
}
