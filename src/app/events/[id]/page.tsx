'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatDate, abbreviateNumber, EVENT_TYPE_LABELS } from '@/lib/utils';

interface SnapshotRow {
  id: string;
  governor: { id: string; governorId: string; name: string };
  power: string;
  killPoints: string;
  t4Kills: string;
  t5Kills: string;
  deads: string;
  verified: boolean;
}

interface EventDetail {
  id: string;
  name: string;
  eventType: string;
  createdAt: string;
  snapshots: SnapshotRow[];
}

export default function EventDetailPage() {
  const params = useParams();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState('power');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!params.id) return;
    fetch(`/api/events/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        setEvent(data);
        setLoading(false);
      })
      .catch(console.error);
  }, [params.id]);

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortedSnapshots = event?.snapshots
    ?.filter((s) =>
      !search || s.governor.name.toLowerCase().includes(search.toLowerCase()) || s.governor.governorId.includes(search)
    )
    .sort((a, b) => {
      const aVal = Number((a as unknown as Record<string, unknown>)[sortField] || 0);
      const bVal = Number((b as unknown as Record<string, unknown>)[sortField] || 0);
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
    }) || [];

  const exportCSV = () => {
    if (!event) return;
    const headers = 'Governor,ID,Power,Kill Points,T4 Kills,T5 Kills,Deads\n';
    const rows = sortedSnapshots
      .map((s) => `${s.governor.name},${s.governor.governorId},${s.power},${s.killPoints},${s.t4Kills},${s.t5Kills},${s.deads}`)
      .join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.name.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="page-container">
        {[1, 2, 3, 4, 5].map((i) => <div key={i} className="shimmer shimmer-row" style={{ marginBottom: 8 }} />)}
      </div>
    );
  }

  if (!event) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-icon">❓</div>
          <h3>Event not found</h3>
          <Link href="/events" className="btn btn-primary mt-16">← Back to Events</Link>
        </div>
      </div>
    );
  }

  const sortArrow = (field: string) => sortField === field ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="flex items-center gap-12">
          <Link href="/events" className="text-muted" style={{ textDecoration: 'none' }}>← Events</Link>
          <span className="text-muted">/</span>
        </div>
        <h1>{event.name}</h1>
        <div className="flex items-center gap-12 mt-8">
          <span className={`tier-badge ${event.eventType.includes('KVK') ? 'tier-war-legend' : 'tier-frontline'}`}>
            {EVENT_TYPE_LABELS[event.eventType] || event.eventType}
          </span>
          <span className="text-muted">{event.snapshots.length} players</span>
          <span className="text-muted">•</span>
          <span className="text-muted">{formatDate(event.createdAt)}</span>
        </div>
      </div>

      <div className="flex justify-between items-center mb-16" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="search-bar">
          <span className="search-icon">🔍</span>
          <input placeholder="Search governor..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-8">
          <button className="btn btn-secondary btn-sm" onClick={exportCSV}>📤 Export CSV</button>
          <Link href={`/upload`} className="btn btn-primary btn-sm">📸 Upload More</Link>
        </div>
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Governor</th>
              <th onClick={() => toggleSort('power')}>Power{sortArrow('power')}</th>
              <th onClick={() => toggleSort('killPoints')}>Kill Points{sortArrow('killPoints')}</th>
              <th onClick={() => toggleSort('t4Kills')}>T4 Kills{sortArrow('t4Kills')}</th>
              <th onClick={() => toggleSort('t5Kills')}>T5 Kills{sortArrow('t5Kills')}</th>
              <th onClick={() => toggleSort('deads')}>Deads{sortArrow('deads')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedSnapshots.map((s, i) => (
              <tr key={s.id}>
                <td className="text-muted">{i + 1}</td>
                <td>
                  <strong>{s.governor.name}</strong>
                  <div className="text-muted text-sm">ID: {s.governor.governorId}</div>
                </td>
                <td className="num">{abbreviateNumber(s.power)}</td>
                <td className="num">{abbreviateNumber(s.killPoints)}</td>
                <td className="num">{abbreviateNumber(s.t4Kills)}</td>
                <td className="num">{abbreviateNumber(s.t5Kills)}</td>
                <td className="num">{abbreviateNumber(s.deads)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sortedSnapshots.length === 0 && (
        <div className="empty-state mt-24">
          <div className="empty-icon">📸</div>
          <h3>{search ? 'No matching governors' : 'No snapshots yet'}</h3>
          <p>{search ? 'Try a different search term.' : 'Upload screenshots to populate this event.'}</p>
        </div>
      )}
    </div>
  );
}
