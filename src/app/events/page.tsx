'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDate, EVENT_TYPE_LABELS } from '@/lib/utils';

interface EventItem {
  id: string;
  name: string;
  description: string | null;
  eventType: string;
  snapshotCount: number;
  createdAt: string;
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('CUSTOM');
  const [newDesc, setNewDesc] = useState('');

  const fetchEvents = async () => {
    try {
      const res = await fetch('/api/events');
      const data = await res.json();
      setEvents(data.events || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEvents(); }, []);

  const createEvent = async () => {
    if (!newName.trim()) return;
    await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), eventType: newType, description: newDesc.trim() || null }),
    });
    setNewName('');
    setNewDesc('');
    setShowCreate(false);
    fetchEvents();
  };

  const deleteEvent = async (id: string) => {
    if (!confirm('Delete this event and all its snapshots?')) return;
    await fetch(`/api/events/${id}`, { method: 'DELETE' });
    fetchEvents();
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>📅 Events</h1>
        <p>Manage point-in-time snapshots of your alliance</p>
      </div>

      <div className="flex justify-between items-center mb-24">
        <span className="text-muted">{events.length} events</span>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Create New Event
        </button>
      </div>

      <div className="card card-no-hover">
        {loading ? (
          <div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="shimmer shimmer-row" style={{ margin: '8px 16px' }} />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📅</div>
            <h3>No Events Yet</h3>
            <p>Create your first event to start tracking alliance performance.</p>
          </div>
        ) : (
          events.map((event) => (
            <div key={event.id} className="event-card">
              <div className="event-card-info">
                <div className="event-card-name">{event.name}</div>
                <div className="event-card-meta">
                  <span className={`tier-badge ${event.eventType.includes('KVK') ? 'tier-war-legend' : 'tier-frontline'}`} style={{ padding: '2px 8px', fontSize: '0.72rem' }}>
                    {EVENT_TYPE_LABELS[event.eventType] || event.eventType}
                  </span>
                  <span>{event.snapshotCount} players</span>
                  <span>•</span>
                  <span>{formatDate(event.createdAt)}</span>
                </div>
              </div>
              <div className="event-card-actions">
                <Link href={`/events/${event.id}`} className="btn btn-secondary btn-sm">
                  View
                </Link>
                <Link href={`/compare?eventA=${event.id}`} className="btn btn-secondary btn-sm">
                  📊 Compare
                </Link>
                <button className="btn btn-danger btn-sm" onClick={() => deleteEvent(event.id)}>
                  🗑️
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Event</h2>
            <div className="form-group">
              <label className="form-label">Event Name *</label>
              <input className="form-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g., KvK S3 - Start" autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">Event Type</label>
              <select className="form-select" value={newType} onChange={(e) => setNewType(e.target.value)}>
                {Object.entries(EVENT_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Description (optional)</label>
              <input className="form-input" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Notes about this event" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createEvent}>Create Event</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
