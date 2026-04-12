'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { EVENT_TYPE_LABELS } from '@/lib/utils';
import { cleanNumericOcr } from '@/lib/ocr/validators';

interface OcrEntry {
  id: string;
  fileName: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  values: Record<string, string>;
  confidences: Record<string, number>;
  confirmed: boolean;
}

interface EventOption {
  id: string;
  name: string;
  eventType: string;
}

export default function UploadPage() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [newEventType, setNewEventType] = useState('CUSTOM');
  const [entries, setEntries] = useState<OcrEntry[]>([]);
  const [, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ saved: number; updated: number; errors: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Fetch events
  useEffect(() => {
    fetch('/api/events')
      .then((r) => r.json())
      .then((d) => setEvents(d.events || []))
      .catch(console.error);
  }, []);

  // Handle file selection
  const handleFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    setProcessing(true);
    const newEntries: OcrEntry[] = imageFiles.map((f, i) => ({
      id: `${Date.now()}-${i}`,
      fileName: f.name,
      status: 'pending' as const,
      values: {
        governorId: '',
        governorName: '',
        power: '',
        killPoints: '',
        t4Kills: '',
        t5Kills: '',
        deads: '',
      },
      confidences: {},
      confirmed: false,
    }));

    setEntries((prev) => [...prev, ...newEntries]);

    // Process each file with OCR
    for (let i = 0; i < imageFiles.length; i++) {
      const entryId = newEntries[i].id;
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, status: 'processing' } : e))
      );

      try {
        // Dynamic import to avoid SSR issues
        const { processScreenshot } = await import('@/lib/ocr/ocr-engine');
        const result = await processScreenshot(imageFiles[i]);

        setEntries((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? {
                  ...e,
                  status: 'done',
                  values: {
                    governorId: cleanNumericOcr(result.governorId.value),
                    governorName: result.governorName.value,
                    power: cleanNumericOcr(result.power.value),
                    killPoints: cleanNumericOcr(result.killPoints.value),
                    t4Kills: cleanNumericOcr(result.t4Kills.value),
                    t5Kills: cleanNumericOcr(result.t5Kills.value),
                    deads: cleanNumericOcr(result.deads.value),
                  },
                  confidences: {
                    governorId: result.governorId.confidence,
                    name: result.governorName.confidence,
                    power: result.power.confidence,
                    killPoints: result.killPoints.confidence,
                    t4Kills: result.t4Kills.confidence,
                    t5Kills: result.t5Kills.confidence,
                    deads: result.deads.confidence,
                  },
                }
              : e
          )
        );
      } catch (err) {
        console.error('OCR error:', err);
        setEntries((prev) =>
          prev.map((e) => (e.id === entryId ? { ...e, status: 'error' } : e))
        );
      }
    }

    setProcessing(false);
  }, []);

  // Drag and drop
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  // Update a value
  const updateValue = (entryId: string, field: string, value: string) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entryId ? { ...e, values: { ...e.values, [field]: value } } : e
      )
    );
  };

  // Toggle confirm
  const toggleConfirm = (entryId: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, confirmed: !e.confirmed } : e))
    );
  };

  // Remove entry
  const removeEntry = (entryId: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
  };

  // Create event
  const createEvent = async () => {
    if (!newEventName.trim()) return;
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newEventName.trim(), eventType: newEventType }),
      });
      const event = await res.json();
      setEvents((prev) => [event, ...prev]);
      setSelectedEventId(event.id);
      setNewEventName('');
      setShowCreateModal(false);
    } catch (err) {
      console.error('Create event error:', err);
    }
  };

  // Save all confirmed
  const saveAll = async () => {
    const confirmed = entries.filter((e) => e.confirmed && e.status === 'done');
    if (!selectedEventId || confirmed.length === 0) return;

    setSaving(true);
    try {
      const res = await fetch('/api/snapshots/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: selectedEventId,
          snapshots: confirmed.map((e) => ({
            governorId: e.values.governorId,
            governorName: e.values.governorName,
            power: e.values.power,
            killPoints: e.values.killPoints,
            t4Kills: e.values.t4Kills,
            t5Kills: e.values.t5Kills,
            deads: e.values.deads,
            verified: true,
          })),
        }),
      });
      const result = await res.json();
      setSaveResult(result);
      // Remove saved entries
      setEntries((prev) => prev.filter((e) => !e.confirmed));
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const confirmedCount = entries.filter((e) => e.confirmed).length;
  const doneCount = entries.filter((e) => e.status === 'done').length;
  const processingCount = entries.filter((e) => e.status === 'processing').length;

  const fields = [
    { key: 'governorId', label: 'Governor ID' },
    { key: 'governorName', label: 'Name' },
    { key: 'power', label: 'Power' },
    { key: 'killPoints', label: 'Kill Points' },
    { key: 't4Kills', label: 'T4 Kills' },
    { key: 't5Kills', label: 'T5 Kills' },
    { key: 'deads', label: 'Deads' },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>📸 Upload Screenshots</h1>
        <p>Upload governor screenshots, review OCR results, and save to an event</p>
      </div>

      {/* Step 1: Select Event */}
      <div className="card card-no-hover mb-24 animate-fade-in-up">
        <h3 className="mb-16">Step 1: Select Event</h3>
        <div className="flex gap-12" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
            <label className="form-label">Event</label>
            <select
              className="form-select"
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
            >
              <option value="">— Select an event —</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-secondary" onClick={() => setShowCreateModal(true)}>
            + New Event
          </button>
        </div>
      </div>

      {/* Step 2: Upload */}
      <div className="mb-24 animate-fade-in-up stagger-2">
        <h3 className="mb-16">Step 2: Upload Screenshots</h3>
        <div
          className={`drop-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="drop-icon">📸</div>
          <div className="drop-text">
            {isDragging ? 'Release to upload' : 'Drag & Drop Screenshots Here'}
          </div>
          <div className="drop-hint">or click to browse • PNG, JPG, WEBP • Max 50 per batch</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              handleFiles(files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {/* Processing indicator */}
      {processingCount > 0 && (
        <div className="card card-no-hover mb-24">
          <div className="flex items-center gap-12">
            <span>⏳ Processing screenshots...</span>
            <span className="text-muted text-sm">
              {doneCount} / {entries.length} done
            </span>
          </div>
          <div className="progress-bar-wrap">
            <div
              className="progress-bar-fill"
              style={{ width: `${(doneCount / Math.max(entries.length, 1)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Step 3: Review */}
      {entries.length > 0 && (
        <div className="animate-fade-in-up stagger-3">
          <div className="flex items-center justify-between mb-16">
            <h3>Step 3: Review OCR Results ({entries.length})</h3>
            <div className="flex gap-8">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setEntries((prev) => prev.map((e) => e.status === 'done' ? { ...e, confirmed: true } : e))}
              >
                ✅ Confirm All
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => setEntries([])}
              >
                Clear All
              </button>
            </div>
          </div>

          {entries.map((entry) => (
            <div key={entry.id} className="ocr-review">
              <div className="ocr-review-header">
                <div className="flex items-center gap-12">
                  <span>
                    {entry.status === 'processing' ? '⏳' : entry.status === 'done' ? '✅' : entry.status === 'error' ? '❌' : '⏸️'}
                  </span>
                  <strong>{entry.fileName}</strong>
                  {entry.confirmed && (
                    <span className="tier-badge tier-support" style={{ fontSize: '0.75rem' }}>Confirmed</span>
                  )}
                </div>
                <div className="flex gap-8">
                  {entry.status === 'done' && (
                    <button
                      className={`btn btn-sm ${entry.confirmed ? 'btn-secondary' : 'btn-primary'}`}
                      onClick={() => toggleConfirm(entry.id)}
                    >
                      {entry.confirmed ? 'Undo' : '✅ Confirm'}
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => removeEntry(entry.id)}>
                    ✕
                  </button>
                </div>
              </div>

              {entry.status === 'done' && (
                <div className="ocr-review-body">
                  {fields.map((f) => (
                    <React.Fragment key={f.key}>
                      <label className="ocr-field-label">{f.label}</label>
                      <div className="ocr-field-value">
                        <input
                          className="ocr-field-input"
                          value={entry.values[f.key] || ''}
                          onChange={(e) => updateValue(entry.id, f.key, e.target.value)}
                        />
                        <span className="validation-icon">
                          {entry.values[f.key] ? '✅' : '⚠️'}
                        </span>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {entry.status === 'processing' && (
                <div style={{ padding: 20 }}>
                  <div className="shimmer shimmer-row" />
                  <div className="shimmer shimmer-row" />
                </div>
              )}

              {entry.status === 'error' && (
                <div style={{ padding: 20, color: 'var(--color-danger)' }}>
                  ❌ Failed to process this screenshot. Try uploading again.
                </div>
              )}
            </div>
          ))}

          {/* Save button */}
          <div className="flex items-center justify-between mt-24">
            <span className="text-muted">
              {confirmedCount} of {doneCount} entries confirmed
            </span>
            <button
              className="btn btn-primary btn-lg"
              disabled={!selectedEventId || confirmedCount === 0 || saving}
              onClick={saveAll}
            >
              {saving ? '⏳ Saving...' : `💾 Save ${confirmedCount} Entries`}
            </button>
          </div>

          {saveResult && (
            <div className="card mt-16" style={{ background: 'var(--color-success-bg)', borderColor: 'rgba(16,185,129,0.3)' }}>
              ✅ Saved {saveResult.saved} new, updated {saveResult.updated}, errors: {saveResult.errors}
            </div>
          )}
        </div>
      )}

      {/* Create Event Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Event</h2>
            <div className="form-group">
              <label className="form-label">Event Name</label>
              <input
                className="form-input"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
                placeholder="e.g., KvK S3 - Start"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Event Type</label>
              <select
                className="form-select"
                value={newEventType}
                onChange={(e) => setNewEventType(e.target.value)}
              >
                {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={createEvent}>
                Create Event
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
