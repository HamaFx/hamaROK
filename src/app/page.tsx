'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDate, EVENT_TYPE_LABELS } from '@/lib/utils';

interface EventSummary {
  id: string;
  name: string;
  eventType: string;
  snapshotCount: number;
  createdAt: string;
}

export default function Dashboard() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [governorCount, setGovernorCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [evRes, govRes] = await Promise.all([
          fetch('/api/events'),
          fetch('/api/governors?limit=1'),
        ]);
        const evData = await evRes.json();
        const govData = await govRes.json();
        setEvents(evData.events || []);
        setGovernorCount(govData.total || 0);
      } catch (err) {
        console.error('Dashboard fetch error:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);


  const totalSnapshots = events.reduce((sum, e) => sum + e.snapshotCount, 0);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>⚔️ Command Center</h1>
        <p>Alliance performance at a glance</p>
      </div>

      {/* Stats Cards */}
      <div className="grid-3 mb-24">
        <div className="card stats-card animate-fade-in-up stagger-1">
          <div className="stats-icon">👥</div>
          <div className="stats-label">Total Governors</div>
          <div className="stats-value">{loading ? '—' : governorCount}</div>
        </div>
        <div className="card stats-card animate-fade-in-up stagger-2">
          <div className="stats-icon">📅</div>
          <div className="stats-label">Events Tracked</div>
          <div className="stats-value">{loading ? '—' : events.length}</div>
        </div>
        <div className="card stats-card animate-fade-in-up stagger-3">
          <div className="stats-icon">📸</div>
          <div className="stats-label">Total Snapshots</div>
          <div className="stats-value">{loading ? '—' : totalSnapshots}</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-12 mb-24" style={{ flexWrap: 'wrap' }}>
        <Link href="/upload" className="btn btn-primary btn-lg">
          📸 Upload Screenshots
        </Link>
        <Link href="/compare" className="btn btn-secondary btn-lg">
          ⚔️ Compare Events
        </Link>
        <Link href="/insights" className="btn btn-secondary btn-lg">
          📡 Insights
        </Link>
        <Link href="/review" className="btn btn-secondary btn-lg">
          🧪 Review Queue
        </Link>
        <Link href="/events" className="btn btn-secondary btn-lg">
          📅 Manage Events
        </Link>
      </div>

      {/* Recent Events */}
      <div className="card card-no-hover animate-fade-in-up stagger-4">
        <h2 className="mb-16" style={{ color: 'var(--color-accent-gold)' }}>📅 Recent Events</h2>

        {loading ? (
          <div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="shimmer shimmer-row" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📅</div>
            <h3>No Events Yet</h3>
            <p>Create your first event and start uploading governor screenshots.</p>
            <Link href="/upload" className="btn btn-primary mt-16">
              Get Started →
            </Link>
          </div>
        ) : (
          events.slice(0, 8).map((event) => (
            <div key={event.id} className="event-card">
              <div className="event-card-info">
                <div className="event-card-name">{event.name}</div>
                <div className="event-card-meta">
                  <span>{EVENT_TYPE_LABELS[event.eventType] || event.eventType}</span>
                  <span>•</span>
                  <span>{event.snapshotCount} players</span>
                  <span>•</span>
                  <span>{formatDate(event.createdAt)}</span>
                </div>
              </div>
              <div className="event-card-actions">
                <Link href={`/events/${event.id}`} className="btn btn-secondary btn-sm">
                  View
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
