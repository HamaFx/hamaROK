'use client';

import { useEffect, useState } from 'react';
import { abbreviateNumber } from '@/lib/utils';
import { GrowthLineChart } from '@/components/Charts';

interface GovernorItem {
  id: string;
  governorId: string;
  name: string;
  alliance: string;
  snapshotCount: number;
  latestPower: string;
}

interface TimelineEntry {
  event: { id: string; name: string };
  power: string;
  killPoints: string;
  deads: string;
  date: string;
}

export default function GovernorsPage() {
  const [governors, setGovernors] = useState<GovernorItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const fetchGovernors = async (q = '') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/governors?search=${encodeURIComponent(q)}&limit=200`);
      const data = await res.json();
      setGovernors(data.governors || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGovernors(); }, []);

  useEffect(() => {
    const timeout = setTimeout(() => fetchGovernors(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setTimeline(null);
      return;
    }
    setExpandedId(id);
    setTimelineLoading(true);
    try {
      const res = await fetch(`/api/governors/${id}/timeline`);
      const data = await res.json();
      setTimeline(data.timeline || []);
    } catch (err) {
      console.error(err);
    } finally {
      setTimelineLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>👥 Governor Roster</h1>
        <p>{total} governors tracked</p>
      </div>

      <div className="flex justify-between items-center mb-24" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="search-bar" style={{ maxWidth: 400 }}>
          <span className="search-icon">🔍</span>
          <input
            placeholder="Search by name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-muted text-sm">
          {governors.length} of {total} shown
        </span>
      </div>

      {loading ? (
        <div className="card card-no-hover">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="shimmer shimmer-row" style={{ margin: '8px 16px' }} />
          ))}
        </div>
      ) : governors.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">👥</div>
          <h3>{search ? 'No matching governors' : 'No governors yet'}</h3>
          <p>{search ? 'Try a different search.' : 'Upload screenshots to build your roster.'}</p>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Governor</th>
                <th>Governor ID</th>
                <th>Alliance</th>
                <th>Latest Power</th>
                <th>Snapshots</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {governors.map((gov, i) => (
                <>
                  <tr key={gov.id} style={{ cursor: 'pointer' }} onClick={() => toggleExpand(gov.id)}>
                    <td className="text-muted">{i + 1}</td>
                    <td><strong>{gov.name}</strong></td>
                    <td className="num text-muted">{gov.governorId}</td>
                    <td>{gov.alliance || '—'}</td>
                    <td className="num">{abbreviateNumber(gov.latestPower)}</td>
                    <td className="text-muted">{gov.snapshotCount} events</td>
                    <td>
                      <button className="btn btn-secondary btn-sm">
                        {expandedId === gov.id ? '▲ Hide' : '▼ Timeline'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === gov.id && (
                    <tr key={`${gov.id}-timeline`}>
                      <td colSpan={7} style={{ padding: 0, background: 'var(--color-bg-tertiary)' }}>
                        <div style={{ padding: 24 }}>
                          {timelineLoading ? (
                            <div className="shimmer shimmer-card" />
                          ) : timeline && timeline.length > 0 ? (
                            <GrowthLineChart
                              timeline={timeline.map((t) => ({
                                eventName: t.event.name,
                                power: Number(t.power),
                                killPoints: Number(t.killPoints),
                                deads: Number(t.deads),
                              }))}
                            />
                          ) : (
                            <div className="text-muted" style={{ textAlign: 'center', padding: 24 }}>
                              No timeline data available
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
