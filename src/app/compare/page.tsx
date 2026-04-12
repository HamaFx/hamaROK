'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatDelta } from '@/lib/utils';
import { getTierConfig, WarriorTier } from '@/lib/warrior-score';
import TierBadge from '@/components/TierBadge';
import { KillsBarChart, TierPieChart } from '@/components/Charts';

interface Comparison {
  governor: { id: string; governorId: string; name: string };
  deltas: Record<string, string>;
  warriorScore: {
    killScore: number;
    deadScore: number;
    powerBonus: number;
    totalScore: number;
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

  useEffect(() => {
    fetch('/api/events').then((r) => r.json()).then((d) => setEvents(d.events || []));
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

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir(field === 'rank' ? 'asc' : 'desc'); }
  };

  const sortedComparisons = result?.comparisons
    ?.filter((c) => !search || c.governor.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let aVal: number, bVal: number;
      if (sortField === 'rank') { aVal = a.warriorScore?.rank || 999; bVal = b.warriorScore?.rank || 999; }
      else if (sortField === 'score') { aVal = a.warriorScore?.totalScore || 0; bVal = b.warriorScore?.totalScore || 0; }
      else { aVal = Number(a.deltas[sortField] || 0); bVal = Number(b.deltas[sortField] || 0); }
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
    }) || [];

  const sortArrow = (field: string) => sortField === field ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  const exportCSV = () => {
    if (!result) return;
    const headers = 'Rank,Governor,ID,Power Δ,Kill Pts Δ,T4 Kills Δ,T5 Kills Δ,Deads Δ,Warrior Score,Tier\n';
    const rows = sortedComparisons.map((c) =>
      `${c.warriorScore?.rank || '-'},${c.governor.name},${c.governor.governorId},${c.deltas.power},${c.deltas.killPoints},${c.deltas.t4Kills},${c.deltas.t5Kills},${c.deltas.deads},${c.warriorScore?.totalScore || 0},${c.warriorScore?.tier || '-'}`
    ).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comparison_${result.eventA.name}_vs_${result.eventB.name}.csv`.replace(/\s+/g, '_');
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>⚔️ Compare Events</h1>
        <p>Select two events to calculate deltas and warrior scores</p>
      </div>

      {/* Event Selectors */}
      <div className="compare-selectors animate-fade-in-up">
        <div className="compare-selector-box">
          <label className="form-label">Event A (Start)</label>
          <select className="form-select" value={eventAId} onChange={(e) => setEventAId(e.target.value)}>
            <option value="">— Select start event —</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.name}</option>
            ))}
          </select>
        </div>
        <div className="compare-vs">VS</div>
        <div className="compare-selector-box">
          <label className="form-label">Event B (End)</label>
          <select className="form-select" value={eventBId} onChange={(e) => setEventBId(e.target.value)}>
            <option value="">— Select end event —</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <div className="card card-no-hover mt-24">
          <div className="shimmer shimmer-row" />
          <div className="shimmer shimmer-row" />
          <div className="shimmer shimmer-row" />
        </div>
      )}

      {result && !loading && (
        <>
          {/* Summary Cards */}
          <div className="grid-3 mb-24 mt-24">
            <div className="card stats-card animate-fade-in-up stagger-1">
              <div className="stats-icon">👥</div>
              <div className="stats-label">Governors Compared</div>
              <div className="stats-value">{result.summary.totalGovernors}</div>
            </div>
            <div className="card stats-card animate-fade-in-up stagger-2">
              <div className="stats-icon">⚔️</div>
              <div className="stats-label">Avg Warrior Score</div>
              <div className="stats-value">{result.summary.avgWarriorScore}</div>
            </div>
            <div className="card stats-card animate-fade-in-up stagger-3">
              <div className="stats-icon">🏆</div>
              <div className="stats-label">War Legends</div>
              <div className="stats-value">{result.summary.tierDistribution['War Legend'] || 0}</div>
            </div>
          </div>

          {/* Leaderboard Top 5 */}
          <div className="card card-no-hover mb-24 animate-fade-in-up stagger-4">
            <h2 className="mb-16 text-gold">🏆 Warrior Leaderboard</h2>
            {sortedComparisons.slice(0, 10).map((c) => {
              const ws = c.warriorScore;
              if (!ws) return null;
              const config = getTierConfig(ws.tier);
              return (
                <div key={c.governor.id} className="leaderboard-entry">
                  <div className={`leaderboard-rank ${ws.rank <= 3 ? 'top-3' : ''}`}>
                    {ws.rank <= 3 ? ['🥇', '🥈', '🥉'][ws.rank - 1] : `#${ws.rank}`}
                  </div>
                  <div className="leaderboard-name">{c.governor.name}</div>
                  <div className="leaderboard-score">
                    <div className="score-bar-wrap" style={{ width: 200 }}>
                      <div className="score-bar-track">
                        <div className="score-bar-fill" style={{ width: `${ws.totalScore}%`, background: config.color }} />
                      </div>
                      <div className="score-bar-value" style={{ color: config.color }}>
                        {ws.totalScore}
                      </div>
                    </div>
                    <TierBadge tier={ws.tier} size="sm" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Charts */}
          <div className="grid-2 mb-24">
            <KillsBarChart
              data={sortedComparisons.map((c) => ({
                name: c.governor.name,
                killDelta: Number(c.deltas.killPoints),
              }))}
            />
            <TierPieChart distribution={result.summary.tierDistribution} />
          </div>

          {/* Full Delta Table */}
          <div className="flex justify-between items-center mb-16" style={{ flexWrap: 'wrap', gap: 12 }}>
            <h2 className="text-gold">📊 Full Comparison Table</h2>
            <div className="flex gap-8">
              <div className="search-bar">
                <span className="search-icon">🔍</span>
                <input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button className="btn btn-secondary btn-sm" onClick={exportCSV}>📤 Export CSV</button>
            </div>
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th onClick={() => toggleSort('rank')}>Rank{sortArrow('rank')}</th>
                  <th>Governor</th>
                  <th onClick={() => toggleSort('power')}>Power Δ{sortArrow('power')}</th>
                  <th onClick={() => toggleSort('killPoints')}>Kill Pts Δ{sortArrow('killPoints')}</th>
                  <th onClick={() => toggleSort('t4Kills')}>T4 Δ{sortArrow('t4Kills')}</th>
                  <th onClick={() => toggleSort('t5Kills')}>T5 Δ{sortArrow('t5Kills')}</th>
                  <th onClick={() => toggleSort('deads')}>Deads Δ{sortArrow('deads')}</th>
                  <th onClick={() => toggleSort('score')}>Score{sortArrow('score')}</th>
                  <th>Tier</th>
                </tr>
              </thead>
              <tbody>
                {sortedComparisons.map((c) => {
                  const ws = c.warriorScore;
                  return (
                    <tr key={c.governor.id}>
                      <td className="text-muted">{ws?.rank || '-'}</td>
                      <td>
                        <strong>{c.governor.name}</strong>
                        <div className="text-muted text-sm">ID: {c.governor.governorId}</div>
                      </td>
                      <td className={`num ${Number(c.deltas.power) >= 0 ? 'delta-positive' : 'delta-negative'}`}>
                        {formatDelta(c.deltas.power)}
                      </td>
                      <td className={`num ${Number(c.deltas.killPoints) >= 0 ? 'delta-positive' : 'delta-negative'}`}>
                        {formatDelta(c.deltas.killPoints)}
                      </td>
                      <td className="num delta-positive">{formatDelta(c.deltas.t4Kills)}</td>
                      <td className="num delta-positive">{formatDelta(c.deltas.t5Kills)}</td>
                      <td className="num delta-positive">{formatDelta(c.deltas.deads)}</td>
                      <td className="num" style={{ color: ws ? getTierConfig(ws.tier).color : 'inherit' }}>
                        {ws?.totalScore || '—'}
                      </td>
                      <td>{ws && <TierBadge tier={ws.tier} size="sm" showLabel={false} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!result && !loading && eventAId && eventBId && (
        <div className="empty-state mt-32">
          <div className="empty-icon">📊</div>
          <h3>No comparison data</h3>
          <p>Make sure both events have governor snapshots.</p>
        </div>
      )}

      {!eventAId || !eventBId ? (
        <div className="empty-state mt-32">
          <div className="empty-icon">⚔️</div>
          <h3>Select Two Events</h3>
          <p>Choose a start and end event above to compare governor performance.</p>
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
