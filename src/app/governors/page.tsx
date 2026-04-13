'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, TrendingUp } from 'lucide-react';
import { abbreviateNumber } from '@/lib/utils';
import { GrowthLineChart } from '@/components/Charts';
import { DataTableLite, EmptyState, FilterBar, KpiCard, PageHero, Panel, SkeletonSet } from '@/components/ui/primitives';

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

  useEffect(() => {
    fetchGovernors();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => fetchGovernors(search), 250);
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

  const avgSnapshots = useMemo(() => {
    if (governors.length === 0) return 0;
    return Math.round(governors.reduce((sum, governor) => sum + governor.snapshotCount, 0) / governors.length);
  }, [governors]);

  return (
    <div className="page-container">
      <PageHero
        title="Governor Registry"
        subtitle="Identity-level roster with timeline drill-down for growth and contribution trends."
      />

      <div className="grid-3 mb-24">
        <KpiCard label="Tracked Governors" value={total} hint="Roster identities indexed" tone="info" />
        <KpiCard label="Visible in Filter" value={governors.length} hint="Current table row count" tone="neutral" />
        <KpiCard label="Avg Snapshots" value={avgSnapshots} hint="Average snapshots per governor" tone="good" />
      </div>

      <Panel
        title="Governor Table"
        subtitle="Search by governor name or governor ID"
        actions={
          <div className="search-bar" style={{ maxWidth: 380 }}>
            <Search size={14} className="search-icon" />
            <input
              placeholder="Search governor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
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
                render: (row) => row.snapshotCount,
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
            <EmptyState title="No timeline data" description="This governor has no comparable progression history yet." />
          )}
          <FilterBar className="mt-16">
            <button className="btn btn-secondary btn-sm" onClick={() => setExpandedId(null)}>
              Close Timeline
            </button>
          </FilterBar>
        </Panel>
      ) : null}
    </div>
  );
}
