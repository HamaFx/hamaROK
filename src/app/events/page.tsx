'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, Search, Trash2, Upload } from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { formatDate, EVENT_TYPE_LABELS } from '@/lib/utils';
import {
  EmptyState,
  FilterBar,
  KpiCard,
  PageHero,
  Panel,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';

interface EventItem {
  id: string;
  name: string;
  description: string | null;
  eventType: string;
  snapshotCount: number;
  createdAt: string;
}

export default function EventsPage() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
  } = useWorkspaceSession();

  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('CUSTOM');
  const [newDesc, setNewDesc] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!workspaceReady) {
      setEvents([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        workspaceId,
        limit: '200',
      });
      const res = await fetch(`/api/v2/events?${params.toString()}`, {
        headers: {
          'x-access-token': accessToken,
        },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to load events.');
      }

      setEvents(Array.isArray(payload?.data) ? payload.data : []);
    } catch (cause) {
      setEvents([]);
      setError(cause instanceof Error ? cause.message : 'Failed to load events.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, accessToken, workspaceReady]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const createEvent = async () => {
    if (!newName.trim()) return;
    if (!workspaceReady) {
      setError(sessionLoading ? 'Connecting workspace session...' : 'Workspace session is not ready.');
      return;
    }

    try {
      setError(null);

      const res = await fetch('/api/v2/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify({
          workspaceId,
          name: newName.trim(),
          eventType: newType,
          description: newDesc.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to create event.');
      }

      setNewName('');
      setNewDesc('');
      setShowCreate(false);
      await fetchEvents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create event.');
    }
  };

  const deleteEvent = async (id: string) => {
    if (!workspaceReady) {
      setError(sessionLoading ? 'Connecting workspace session...' : 'Workspace session is not ready.');
      return;
    }
    if (!confirm('Delete this event and all its snapshots?')) return;

    try {
      setError(null);
      const params = new URLSearchParams({ workspaceId });
      const res = await fetch(`/api/v2/events/${id}?${params.toString()}`, {
        method: 'DELETE',
        headers: {
          'x-access-token': accessToken,
        },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to delete event.');
      }

      await fetchEvents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to delete event.');
    }
  };

  const kvkCount = events.filter((event) => event.eventType.includes('KVK')).length;

  const eventTypeOptions = useMemo(() => {
    const distinct = Array.from(new Set(events.map((event) => event.eventType))).sort();
    return ['ALL', ...distinct];
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events
      .filter((event) => {
        const matchesType = typeFilter === 'ALL' ? true : event.eventType === typeFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          q.length === 0 ||
          event.name.toLowerCase().includes(q) ||
          String(EVENT_TYPE_LABELS[event.eventType] || event.eventType)
            .toLowerCase()
            .includes(q);
        return matchesType && matchesSearch;
      })
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [events, search, typeFilter]);

  return (
    <div className="page-container">
      <PageHero
        title="Events"
        subtitle="Manage event checkpoints for compare, insights, and ranking workflows."
        actions={
          <>
            <Link href="/upload" className="btn btn-secondary">
              <Upload size={14} /> Upload
            </Link>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <CalendarPlus size={14} /> Create Event
            </button>
          </>
        }
      />

      {!workspaceReady ? (
        <div className="card mb-24">
          <div className="text-sm text-muted">
            {sessionLoading ? 'Connecting workspace...' : sessionError || 'Workspace session is not ready yet.'}
          </div>
        </div>
      ) : null}

      {error ? <div className="delta-negative mb-16">{error}</div> : null}

      <div className="grid-3 mb-24">
        <KpiCard label="Total Events" value={events.length} hint="Tracked event checkpoints" tone="info" />
        <KpiCard label="KvK Events" value={kvkCount} hint="Events tagged with KvK type" tone="warn" />
        <KpiCard
          label="Snapshots Indexed"
          value={events.reduce((sum, event) => sum + event.snapshotCount, 0)}
          hint="Profile rows across all events"
          tone="good"
        />
      </div>

      <Panel
        title="Event Registry"
        subtitle="Search, filter, and manage event snapshots"
        actions={
          <FilterBar>
            <div className="search-bar" style={{ minWidth: 220 }}>
              <Search size={14} className="search-icon" />
              <input
                placeholder="Search events..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0, minWidth: 180 }}>
              <label className="form-label">Type</label>
              <select className="form-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                {eventTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === 'ALL' ? 'All Types' : EVENT_TYPE_LABELS[option] || option}
                  </option>
                ))}
              </select>
            </div>
            <StatusPill label={`${filteredEvents.length} visible`} tone="info" />
          </FilterBar>
        }
      >
        {loading ? (
          <SkeletonSet rows={4} />
        ) : filteredEvents.length === 0 ? (
          <EmptyState
            title={events.length === 0 ? 'No events yet' : 'No matching events'}
            description={
              events.length === 0
                ? 'Create your first event to start collecting snapshots.'
                : 'Try a different search or type filter.'
            }
            action={
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                Create Event
              </button>
            }
          />
        ) : (
          filteredEvents.map((event) => (
            <div key={event.id} className="event-card">
              <div className="event-card-info">
                <div className="event-card-name">{event.name}</div>
                <div className="event-card-meta">
                  <StatusPill
                    label={EVENT_TYPE_LABELS[event.eventType] || event.eventType}
                    tone={event.eventType.includes('KVK') ? 'warn' : 'info'}
                  />
                  <span>{event.snapshotCount} governors</span>
                  <span>{formatDate(event.createdAt)}</span>
                </div>
                {event.description ? <div className="text-sm text-muted mt-4">{event.description}</div> : null}
              </div>
              <FilterBar className="event-card-actions">
                <Link href={`/events/${event.id}`} className="btn btn-secondary btn-sm">
                  View
                </Link>
                <Link href={`/compare?eventA=${event.id}`} className="btn btn-secondary btn-sm">
                  Compare
                </Link>
                <button className="btn btn-danger btn-sm" onClick={() => deleteEvent(event.id)}>
                  <Trash2 size={13} /> Delete
                </button>
              </FilterBar>
            </div>
          ))
        )}
      </Panel>

      {showCreate ? (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create Event</h2>
            <div className="form-group">
              <label className="form-label">Event Name</label>
              <input
                className="form-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., KvK S3 - Start"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Event Type</label>
              <select className="form-select" value={newType} onChange={(e) => setNewType(e.target.value)}>
                {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input
                className="form-input"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Optional notes"
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={createEvent}>
                Create Event
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
