'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Download, Upload } from 'lucide-react';
import { formatDate, abbreviateNumber, EVENT_TYPE_LABELS } from '@/lib/utils';
import { DataTableLite, EmptyState, FilterBar, KpiCard, PageHero, Panel, StatusPill } from '@/components/ui/primitives';

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
      .then((response) => response.json())
      .then((data) => {
        setEvent(data);
        setLoading(false);
      })
      .catch(console.error);
  }, [params.id]);

  const sortedSnapshots = useMemo(() => {
    const rows = event?.snapshots || [];

    return rows
      .filter(
        (item) =>
          !search ||
          item.governor.name.toLowerCase().includes(search.toLowerCase()) ||
          item.governor.governorId.includes(search)
      )
      .sort((a, b) => {
        const aValue = Number((a as unknown as Record<string, unknown>)[sortField] || 0);
        const bValue = Number((b as unknown as Record<string, unknown>)[sortField] || 0);
        return sortDir === 'desc' ? bValue - aValue : aValue - bValue;
      });
  }, [event?.snapshots, search, sortDir, sortField]);

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const exportCSV = () => {
    if (!event) return;

    const headers = 'Governor,ID,Power,Kill Points,T4 Kills,T5 Kills,Deads\n';
    const rows = sortedSnapshots
      .map((row) => `${row.governor.name},${row.governor.governorId},${row.power},${row.killPoints},${row.t4Kills},${row.t5Kills},${row.deads}`)
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${event.name.replace(/\s+/g, '_')}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="shimmer shimmer-row" />
        <div className="shimmer shimmer-row" />
        <div className="shimmer shimmer-row" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="page-container">
        <EmptyState
          title="Event not found"
          description="The requested event could not be loaded."
          action={
            <Link href="/events" className="btn btn-primary">
              Back to Events
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page-container">
      <PageHero
        title={event.name}
        subtitle="Event-level snapshot table with sortable combat and power fields."
        badges={[EVENT_TYPE_LABELS[event.eventType] || event.eventType, `Created ${formatDate(event.createdAt)}`]}
        actions={
          <>
            <button className="btn btn-secondary" onClick={exportCSV}>
              <Download size={14} /> Export CSV
            </button>
            <Link href="/upload" className="btn btn-primary">
              <Upload size={14} /> Upload More
            </Link>
          </>
        }
      />

      <div className="grid-3 mb-24">
        <KpiCard label="Snapshots" value={event.snapshots.length} hint="Governor rows in this event" tone="info" />
        <KpiCard
          label="Verified Rows"
          value={event.snapshots.filter((snapshot) => snapshot.verified).length}
          hint="Rows marked verified"
          tone="good"
        />
        <KpiCard
          label="Event Type"
          value={EVENT_TYPE_LABELS[event.eventType] || event.eventType}
          hint={formatDate(event.createdAt)}
          tone="warn"
        />
      </div>

      <Panel
        title="Event Snapshot Rows"
        subtitle="Sort by power and combat fields"
        actions={
          <FilterBar>
            <div className="search-bar">
              <input
                placeholder="Search governor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <StatusPill label={`${sortedSnapshots.length} rows`} tone="info" />
          </FilterBar>
        }
      >
        <DataTableLite
          stickyFirst
          rows={sortedSnapshots}
          rowKey={(row) => row.id}
          onSort={toggleSort}
          sortKey={sortField}
          sortDir={sortDir}
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
                  <strong>{row.governor.name}</strong>
                  <div className="text-sm text-muted">ID {row.governor.governorId}</div>
                </>
              ),
            },
            {
              key: 'power',
              label: 'Power',
              className: 'num',
              sortable: true,
              render: (row) => abbreviateNumber(row.power),
            },
            {
              key: 'killPoints',
              label: 'Kill Points',
              className: 'num',
              sortable: true,
              render: (row) => abbreviateNumber(row.killPoints),
            },
            {
              key: 't4Kills',
              label: 'T4 Kills',
              className: 'num',
              sortable: true,
              render: (row) => abbreviateNumber(row.t4Kills),
            },
            {
              key: 't5Kills',
              label: 'T5 Kills',
              className: 'num',
              sortable: true,
              render: (row) => abbreviateNumber(row.t5Kills),
            },
            {
              key: 'deads',
              label: 'Deads',
              className: 'num',
              sortable: true,
              render: (row) => abbreviateNumber(row.deads),
            },
          ]}
          emptyLabel="No snapshot rows in this event."
        />
      </Panel>
    </div>
  );
}
