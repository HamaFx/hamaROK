'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ImageUp,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { EVENT_TYPE_LABELS } from '@/lib/utils';
import { cleanNumericOcr, validateGovernorData, ValidationResult } from '@/lib/ocr/validators';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
import { FilterBar, KpiCard, PageHero, Panel, StatusPill } from '@/components/ui/primitives';

interface OcrEntry {
  id: string;
  fileName: string;
  sourceFile?: File;
  ingestionDomain: 'profile_snapshot' | 'ranking_capture';
  status: 'pending' | 'processing' | 'done' | 'error';
  values: Record<string, string>;
  confidences: Record<string, number>;
  validation: ValidationResult[];
  templateId?: string;
  profileId?: string;
  detectedArchetype?: string;
  engineVersion?: string;
  averageConfidence?: number;
  lowConfidence?: boolean;
  failureReasons?: string[];
  preprocessingTrace?: Record<string, unknown>;
  candidates?: Record<string, unknown>;
  fusionDecision?: Record<string, unknown>;
  confirmed: boolean;
  rawFields?: Record<
    string,
    {
      value: string;
      confidence: number;
      croppedImage?: string;
      trace?: unknown;
      candidates?: unknown;
    }
  >;
  ranking?: {
    headerText: string;
    rankingType: string;
    metricKey: string;
    rows: Array<{
      rowIndex: number;
      sourceRank: string;
      governorNameRaw: string;
      allianceRaw?: string | null;
      titleRaw?: string | null;
      metricRaw: string;
      confidence: number;
      failureReasons: string[];
      candidates?: unknown;
      ocrTrace?: unknown;
    }>;
    rowCandidates?: Record<string, unknown>;
  };
}

interface EventOption {
  id: string;
  name: string;
  eventType: string;
}

interface AwsOcrControlStatus {
  enabled: boolean;
  queueConfigured: boolean;
  startLambdaConfigured: boolean;
  stopLambdaConfigured: boolean;
  queueStats: {
    pending: number;
    inFlight: number;
    delayed: number;
  } | null;
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
  const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [ocrProfiles, setOcrProfiles] = useState<OcrRuntimeProfile[]>([]);
  const [awsOcrControl, setAwsOcrControl] = useState<AwsOcrControlStatus | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const computeValidation = useCallback(
    (values: Record<string, string>, confidences: Record<string, number>) =>
      validateGovernorData({
        governorId: values.governorId || '',
        name: values.governorName || '',
        power: values.power || '',
        killPoints: values.killPoints || '',
        t4Kills: values.t4Kills || '',
        t5Kills: values.t5Kills || '',
        deads: values.deads || '',
        confidences: {
          governorId: confidences.governorId || 0,
          name: confidences.name || 0,
          power: confidences.power || 0,
          killPoints: confidences.killPoints || 0,
          t4Kills: confidences.t4Kills || 0,
          t5Kills: confidences.t5Kills || 0,
          deads: confidences.deads || 0,
        },
      }),
    []
  );

  // Fetch events
  useEffect(() => {
    fetch('/api/events')
      .then((r) => r.json())
      .then((d) => setEvents(d.events || []))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setWorkspaceId(localStorage.getItem('workspaceId') || '');
    setAccessToken(localStorage.getItem('workspaceToken') || '');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (workspaceId) localStorage.setItem('workspaceId', workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (accessToken) localStorage.setItem('workspaceToken', accessToken);
  }, [accessToken]);

  useEffect(() => {
    if (!workspaceId || !accessToken) {
      setOcrProfiles([]);
      return;
    }

    let canceled = false;
    const run = async () => {
      try {
        const params = new URLSearchParams({ workspaceId });
        const res = await fetch(`/api/v2/ocr/profiles?${params.toString()}`, {
          headers: {
            'x-access-token': accessToken,
          },
        });
        const payload = await res.json();
        if (!res.ok) return;
        if (!canceled) {
          const profiles = Array.isArray(payload?.data) ? payload.data : [];
          setOcrProfiles(profiles as OcrRuntimeProfile[]);
        }
      } catch {
        if (!canceled) setOcrProfiles([]);
      }
    };
    run();

    return () => {
      canceled = true;
    };
  }, [workspaceId, accessToken]);

  const loadAwsOcrControl = useCallback(async () => {
    if (!workspaceId || !accessToken) {
      setAwsOcrControl(null);
      return;
    }

    try {
      const params = new URLSearchParams({ workspaceId });
      const res = await fetch(`/api/v2/infra/aws-ocr?${params.toString()}`, {
        headers: { 'x-access-token': accessToken },
      });
      const payload = await res.json();
      if (!res.ok) {
        setAwsOcrControl(null);
        return;
      }
      setAwsOcrControl(payload?.data || null);
    } catch {
      setAwsOcrControl(null);
    }
  }, [workspaceId, accessToken]);

  useEffect(() => {
    loadAwsOcrControl();
  }, [loadAwsOcrControl]);

  const triggerAwsOcrControl = useCallback(
    async (action: 'START' | 'STOP', source: 'manual' | 'auto' = 'manual') => {
      if (!workspaceId || !accessToken) return;
      setAwsControlBusy(action);
      if (source === 'manual') setAwsControlMessage(null);

      try {
        const res = await fetch('/api/v2/infra/aws-ocr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': accessToken,
          },
          body: JSON.stringify({ workspaceId, action }),
        });
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.error?.message || `Failed to ${action.toLowerCase()} AWS OCR worker.`);
        }
        setAwsOcrControl(payload?.data?.status || null);
        if (source === 'manual') {
          setAwsControlMessage(
            action === 'START'
              ? 'AWS OCR worker start requested.'
              : 'AWS OCR worker stop requested.'
          );
        }
      } catch (error) {
        if (source === 'manual') {
          setAwsControlMessage(error instanceof Error ? error.message : 'Failed to control AWS OCR worker.');
        }
      } finally {
        setAwsControlBusy(null);
      }
    },
    [workspaceId, accessToken]
  );

  // Handle file selection
  const handleFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    setProcessing(true);
    const newEntries: OcrEntry[] = imageFiles.map((f, i) => ({
      id: `${Date.now()}-${i}`,
      fileName: f.name,
      sourceFile: f,
      ingestionDomain: 'profile_snapshot',
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
      validation: [],
      templateId: undefined,
      averageConfidence: undefined,
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
        const {
          detectScreenArchetype,
          processRankingScreenshot,
          processScreenshot,
        } = await import('@/lib/ocr/ocr-engine');
        const archetype = await detectScreenArchetype(imageFiles[i]);

        if (archetype === 'rankboard') {
          const ranking = await processRankingScreenshot(imageFiles[i], {
            profiles: ocrProfiles.length > 0 ? ocrProfiles : undefined,
            preferredProfileId: preferredProfileId || undefined,
          });

          setEntries((prev) =>
            prev.map((e) =>
              e.id === entryId
                ? {
                    ...e,
                    ingestionDomain: 'ranking_capture',
                    status: 'done',
                    templateId: ranking.templateId,
                    profileId: ranking.profileId,
                    detectedArchetype: ranking.screenArchetype,
                    engineVersion: ranking.engineVersion,
                    averageConfidence: ranking.averageConfidence,
                    lowConfidence: ranking.lowConfidence,
                    failureReasons: ranking.rows
                      .flatMap((row) => row.failureReasons)
                      .slice(0, 20),
                    preprocessingTrace: ranking.preprocessingTrace,
                    candidates: ranking.rowCandidates,
                    ranking: {
                      headerText: ranking.headerText,
                      rankingType: ranking.rankingType,
                      metricKey: ranking.metricKey,
                      rows: ranking.rows.map((row) => ({
                        rowIndex: row.rowIndex,
                        sourceRank: row.sourceRank?.toString() || '',
                        governorNameRaw: row.governorNameRaw,
                        allianceRaw: row.allianceRaw || null,
                        titleRaw: row.titleRaw || null,
                        metricRaw: row.metricRaw || row.metricValue,
                        confidence: row.confidence,
                        failureReasons: row.failureReasons,
                        candidates: row.candidates,
                        ocrTrace: row.ocrTrace,
                      })),
                      rowCandidates: ranking.rowCandidates,
                    },
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
                    validation: [],
                  }
                : e
            )
          );
          continue;
        }

        const result = await processScreenshot(imageFiles[i], {
          profiles: ocrProfiles.length > 0 ? ocrProfiles : undefined,
          fallback:
            workspaceId && accessToken
              ? async ({ fieldKey, croppedImage, currentValue, currentConfidence }) => {
                  try {
                    const res = await fetch('/api/v2/ocr/fallback', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'x-access-token': accessToken,
                      },
                      body: JSON.stringify({
                        workspaceId,
                        fieldKey,
                        croppedImage,
                        currentValue,
                        currentConfidence,
                      }),
                    });
                    const payload = await res.json();
                    if (!res.ok || payload?.data?.blocked) return null;
                    if (
                      payload?.data &&
                      typeof payload.data.value === 'string' &&
                      typeof payload.data.confidence === 'number'
                    ) {
                      return {
                        value: payload.data.value,
                        confidence: payload.data.confidence,
                      };
                    }
                    return null;
                  } catch {
                    return null;
                  }
                }
              : undefined,
        });

        const values = {
          governorId: cleanNumericOcr(result.governorId.value),
          governorName: result.governorName.value,
          power: cleanNumericOcr(result.power.value),
          killPoints: cleanNumericOcr(result.killPoints.value),
          t4Kills: cleanNumericOcr(result.t4Kills.value),
          t5Kills: cleanNumericOcr(result.t5Kills.value),
          deads: cleanNumericOcr(result.deads.value),
        };
        const confidences = {
          governorId: result.governorId.confidence,
          name: result.governorName.confidence,
          power: result.power.confidence,
          killPoints: result.killPoints.confidence,
          t4Kills: result.t4Kills.confidence,
          t5Kills: result.t5Kills.confidence,
          deads: result.deads.confidence,
        };
        const validation = computeValidation(values, confidences);

        setEntries((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? {
                  ...e,
                  ingestionDomain: 'profile_snapshot',
                  status: 'done',
                  values,
                  confidences,
                  validation,
                  templateId: result.templateId,
                  profileId: result.profileId,
                  detectedArchetype: result.detectedArchetype,
                  engineVersion: result.engineVersion,
                  averageConfidence: result.averageConfidence,
                  lowConfidence: result.lowConfidence,
                  failureReasons: result.failureReasons,
                  preprocessingTrace: result.preprocessingTrace,
                  candidates: result.candidates,
                  fusionDecision: result.fusionDecision,
                  rawFields: {
                    governorId: result.governorId,
                    governorName: result.governorName,
                    power: result.power,
                    killPoints: result.killPoints,
                    t4Kills: result.t4Kills,
                    t5Kills: result.t5Kills,
                    deads: result.deads,
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
  }, [accessToken, computeValidation, ocrProfiles, workspaceId]);

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
      prev.map((e) => {
        if (e.id !== entryId) return e;
        const nextValues = { ...e.values, [field]: value };
        return {
          ...e,
          values: nextValues,
          validation: computeValidation(nextValues, e.confidences),
        };
      })
    );
  };

  const updateRankingRow = (
    entryId: string,
    rowIndex: number,
    key: 'sourceRank' | 'governorNameRaw' | 'allianceRaw' | 'titleRaw' | 'metricRaw',
    value: string
  ) => {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.id !== entryId || !entry.ranking) return entry;
        return {
          ...entry,
          ranking: {
            ...entry.ranking,
            rows: entry.ranking.rows.map((row) =>
              row.rowIndex === rowIndex ? { ...row, [key]: value } : row
            ),
          },
        };
      })
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

  const uploadScreenshotArtifact = async (file?: File): Promise<string | undefined> => {
    if (!file) return undefined;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/screenshots/upload', {
        method: 'POST',
        body: formData,
      });
      const payload = await res.json();
      if (!res.ok || !payload?.url) return undefined;
      return payload.url as string;
    } catch {
      return undefined;
    }
  };

  const submitProfileReviewQueue = async (confirmed: OcrEntry[]) => {
    if (!workspaceId || !accessToken) {
      throw new Error('Workspace ID and access token are required for review queue mode.');
    }

    const scanJobRes = await fetch('/api/v2/scan-jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-token': accessToken,
      },
      body: JSON.stringify({
        workspaceId,
        eventId: selectedEventId,
        source: 'MANUAL_UPLOAD',
        totalFiles: confirmed.length,
        notes: `Uploaded from UI batch at ${new Date().toISOString()}`,
        idempotencyKey: `upload-${selectedEventId}-${Date.now()}`,
      }),
    });

    const scanPayload = await scanJobRes.json();
    if (!scanJobRes.ok) {
      throw new Error(scanPayload?.error?.message || 'Failed to create scan job.');
    }

    const scanJobId = scanPayload?.data?.id as string;
    if (!scanJobId) {
      throw new Error('Scan job creation returned no id.');
    }

    for (const entry of confirmed) {
      const overallConfidence = (entry.averageConfidence || 0) / 100;
      const artifactUrl = await uploadScreenshotArtifact(entry.sourceFile);
      const validation = entry.validation.map((v) => ({
        field: v.field,
        value: v.value,
        isValid: v.isValid,
        confidence: v.confidence,
        warning: v.warning,
        severity: v.severity,
      }));

      const fields = entry.rawFields || {
        governorId: { value: entry.values.governorId, confidence: entry.confidences.governorId || 0 },
        governorName: { value: entry.values.governorName, confidence: entry.confidences.name || 0 },
        power: { value: entry.values.power, confidence: entry.confidences.power || 0 },
        killPoints: { value: entry.values.killPoints, confidence: entry.confidences.killPoints || 0 },
        t4Kills: { value: entry.values.t4Kills, confidence: entry.confidences.t4Kills || 0 },
        t5Kills: { value: entry.values.t5Kills, confidence: entry.confidences.t5Kills || 0 },
        deads: { value: entry.values.deads, confidence: entry.confidences.deads || 0 },
      };

      const extractionRes = await fetch(`/api/v2/scan-jobs/${scanJobId}/extractions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify({
          provider: 'TESSERACT',
          status: 'RAW',
          governorIdRaw: entry.values.governorId,
          governorNameRaw: entry.values.governorName,
          confidence: Number.isFinite(overallConfidence) ? overallConfidence : 0,
          profileId: entry.profileId,
          engineVersion: entry.engineVersion || 'ocr-v3.0.0',
          lowConfidence: Boolean(entry.lowConfidence),
          failureReasons: entry.failureReasons || [],
          fields,
          normalized: {
            governorId: entry.values.governorId,
            governorName: entry.values.governorName,
            power: entry.values.power,
            killPoints: entry.values.killPoints,
            t4Kills: entry.values.t4Kills,
            t5Kills: entry.values.t5Kills,
            deads: entry.values.deads,
          },
          validation,
          preprocessingTrace: entry.preprocessingTrace || {},
          candidates: entry.candidates || {},
          fusionDecision: entry.fusionDecision || {},
          artifactUrl,
          artifactType: artifactUrl ? 'SCREENSHOT' : undefined,
        }),
      });

      const extractionPayload = await extractionRes.json();
      if (!extractionRes.ok) {
        throw new Error(
          extractionPayload?.error?.message ||
            `Failed to queue extraction for ${entry.fileName}.`
        );
      }
    }

    return scanJobId;
  };

  const submitRankingRuns = async (confirmed: OcrEntry[]) => {
    if (!workspaceId || !accessToken) {
      throw new Error('Workspace ID and access token are required for ranking queue mode.');
    }

    const runIds: string[] = [];

    for (const entry of confirmed) {
      if (!entry.ranking || entry.ranking.rows.length === 0) {
        continue;
      }

      const artifactUrl = await uploadScreenshotArtifact(entry.sourceFile);
      const rows = entry.ranking.rows
        .map((row) => {
          const sourceRankDigits = String(row.sourceRank || '').replace(/[^0-9]/g, '');
          const sourceRank = sourceRankDigits ? Number(sourceRankDigits) : null;
          const metricValue = String(row.metricRaw || '').replace(/[^0-9]/g, '');
          return {
            sourceRank,
            governorNameRaw: row.governorNameRaw,
            allianceRaw: row.allianceRaw || null,
            titleRaw: row.titleRaw || null,
            metricRaw: row.metricRaw,
            metricValue: metricValue || row.metricRaw,
            confidence: row.confidence,
            ocrTrace: row.ocrTrace || {},
            candidates: row.candidates || {},
          };
        })
        .filter((row) => row.governorNameRaw || String(row.metricValue).replace(/[^0-9]/g, '').length > 0);

      if (rows.length === 0) {
        continue;
      }

      const rankingRes = await fetch('/api/v2/rankings/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify({
          workspaceId,
          eventId: selectedEventId,
          source: 'MANUAL_UPLOAD',
          domain: 'RANKING_CAPTURE',
          rankingType: entry.ranking.rankingType,
          metricKey: entry.ranking.metricKey,
          headerText: entry.ranking.headerText,
          notes: `Uploaded from UI ranking batch at ${new Date().toISOString()}`,
          idempotencyKey: `ranking-${selectedEventId}-${entry.id}-${Date.now()}`,
          artifactUrl,
          artifactType: artifactUrl ? 'SCREENSHOT' : undefined,
          metadata: {
            screenArchetype: entry.detectedArchetype || 'rankboard',
            templateId: entry.templateId || null,
            profileId: entry.profileId || null,
            engineVersion: entry.engineVersion || null,
            preprocessingTrace: entry.preprocessingTrace || {},
            rowCandidates: entry.ranking.rowCandidates || {},
            uploadFileName: entry.fileName,
          },
          rows,
        }),
      });

      const rankingPayload = await rankingRes.json();
      if (!rankingRes.ok) {
        throw new Error(
          rankingPayload?.error?.message ||
            `Failed to queue ranking run for ${entry.fileName}.`
        );
      }

      if (rankingPayload?.data?.id) {
        runIds.push(String(rankingPayload.data.id));
      }
    }

    return runIds;
  };

  // Save all confirmed
  const saveAll = async () => {
    const confirmed = entries.filter((e) => e.confirmed && e.status === 'done');
    if (!selectedEventId || confirmed.length === 0) return;

    setSaving(true);
    setSubmitMessage(null);
    try {
      const profileEntries = confirmed.filter((entry) => entry.ingestionDomain === 'profile_snapshot');
      const rankingEntries = confirmed.filter((entry) => entry.ingestionDomain === 'ranking_capture');

      let scanJobId: string | null = null;
      let rankingRunIds: string[] = [];

      if (profileEntries.length > 0) {
        scanJobId = await submitProfileReviewQueue(profileEntries);
      }
      if (rankingEntries.length > 0) {
        rankingRunIds = await submitRankingRuns(rankingEntries);
      }

      if (awsOcrControl?.enabled && awsOcrControl.startLambdaConfigured) {
        await triggerAwsOcrControl('START', 'auto');
      }

      setSaveResult({
        saved: confirmed.length,
        updated: 0,
        errors: 0,
      });
      setEntries((prev) => prev.filter((e) => !e.confirmed));
      const parts: string[] = [];
      if (scanJobId) {
        parts.push(`${profileEntries.length} profile(s)`);
      }
      if (rankingEntries.length > 0) {
        parts.push(`${rankingEntries.length} ranking(s) in ${rankingRunIds.length} run(s)`);
      }
      setSubmitMessage({ type: 'success', text: `Queued ${confirmed.length} entries: ${parts.join(', ')}.` });
    } catch (err) {
      console.error('Save error:', err);
      setSubmitMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to queue entries.' });
    } finally {
      setSaving(false);
    }
  };

  const confirmedCount = entries.filter((e) => e.confirmed).length;
  const doneCount = entries.filter((e) => e.status === 'done').length;
  const processingCount = entries.filter((e) => e.status === 'processing').length;
  const profileCount = entries.filter((e) => e.ingestionDomain === 'profile_snapshot').length;
  const rankingCount = entries.filter((e) => e.ingestionDomain === 'ranking_capture').length;

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
      <PageHero
        title="Upload Screenshots"
        subtitle="Drag & drop governor profiles or ranking boards to begin OCR processing."
      />

      <div className="grid-4 mb-24">
        <KpiCard label="Queued" value={entries.length} hint="Current batch" tone="info" />
        <KpiCard label="Profiles" value={profileCount} hint="Governor captures" tone="neutral" />
        <KpiCard label="Rankings" value={rankingCount} hint="Board captures" tone="warn" />
        <KpiCard
          label="Confirmed"
          value={confirmedCount}
          hint="Ready to submit"
          tone={confirmedCount > 0 ? 'good' : 'neutral'}
        />
      </div>

      <Panel title="Select Event" className="mb-24">
        <div className="flex gap-12" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
            <label className="form-label">Event</label>
            <select className="form-select" value={selectedEventId} onChange={(e) => setSelectedEventId(e.target.value)}>
              <option value="">Choose an event...</option>
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
      </Panel>

      <Panel title="Upload Screenshots" className="mb-24">
        <div
          className={`drop-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="drop-icon">
            <ImageUp size={28} />
          </div>
          <div className="drop-text">{isDragging ? 'Release to upload' : 'Drop screenshots here'}</div>
          <div className="drop-hint">or tap to browse • PNG, JPG, WEBP</div>
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
      </Panel>

      {processingCount > 0 ? (
        <Panel
          title="OCR in Progress"
          subtitle={`${doneCount} of ${entries.length} screenshots processed`}
          className="mb-24"
        >
          <div className="flex items-center gap-8 text-sm text-muted">
            <Clock3 size={14} /> Running OCR pipeline
          </div>
          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: `${(doneCount / Math.max(entries.length, 1)) * 100}%` }} />
          </div>
        </Panel>
      ) : null}

      {entries.length > 0 ? (
        <Panel
          title={`OCR Results (${entries.length})`}
          actions={
            <FilterBar>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setEntries((prev) => prev.map((e) => (e.status === 'done' ? { ...e, confirmed: true } : e)))}
              >
                <Check size={14} /> Confirm All
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => setEntries([])}>
                <Trash2 size={14} /> Clear
              </button>
            </FilterBar>
          }
        >
          <div className="ocr-review-stack">
            {entries.map((entry) => {
              const validationHasIssue = entry.validation.some((v) => v.severity !== 'ok');
              const statusTone =
                entry.status === 'done' ? 'good' : entry.status === 'processing' ? 'warn' : entry.status === 'error' ? 'bad' : 'neutral';

              return (
                <article key={entry.id} className="ocr-review">
                  <header className="ocr-review-header">
                    <div className="flex items-center gap-12" style={{ flexWrap: 'wrap' }}>
                      <StatusPill label={entry.status.toUpperCase()} tone={statusTone} />
                      <strong>{entry.fileName}</strong>
                      <span className="text-muted text-sm">
                        {entry.ingestionDomain === 'ranking_capture' ? 'Ranking Capture' : 'Profile Snapshot'}
                      </span>
                      {entry.detectedArchetype ? <span className="text-muted text-sm">{entry.detectedArchetype}</span> : null}
                      {typeof entry.averageConfidence === 'number' ? (
                        <span className="text-muted text-sm">OCR {Math.round(entry.averageConfidence)}%</span>
                      ) : null}
                      {entry.lowConfidence ? <StatusPill label="Low Confidence" tone="warn" /> : null}
                      {entry.confirmed ? <StatusPill label="Confirmed" tone="good" /> : null}
                    </div>
                    <div className="flex gap-8">
                      {entry.status === 'done' ? (
                        <button
                          className={`btn btn-sm ${entry.confirmed ? 'btn-secondary' : 'btn-primary'}`}
                          onClick={() => toggleConfirm(entry.id)}
                        >
                          {entry.confirmed ? 'Undo' : 'Confirm'}
                        </button>
                      ) : null}
                      <button className="btn btn-danger btn-sm" onClick={() => removeEntry(entry.id)}>
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  </header>

                  {entry.status === 'processing' ? (
                    <div style={{ padding: 20 }}>
                      <div className="shimmer shimmer-row" />
                      <div className="shimmer shimmer-row" />
                    </div>
                  ) : null}

                  {entry.status === 'error' ? (
                    <div style={{ padding: 20 }} className="delta-negative text-sm">
                      Failed to process this screenshot. Try uploading again.
                    </div>
                  ) : null}

                  {entry.status === 'done' && entry.ingestionDomain === 'ranking_capture' && entry.ranking ? (
                    <div className="ranking-row-editor">
                      <div className="text-sm text-muted mb-8">
                        <strong>{entry.ranking.rankingType}</strong> • {entry.ranking.metricKey}
                      </div>
                      <div className="text-sm text-muted mb-12">Header: {entry.ranking.headerText}</div>
                      <div className="data-table-wrap">
                        <table className="data-table data-table-dense">
                          <thead>
                            <tr>
                              <th>Rank</th>
                              <th>Governor</th>
                              <th>Alliance / Title</th>
                              <th>Metric</th>
                              <th>Conf</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.ranking.rows.map((row) => (
                              <tr key={`${entry.id}-ranking-row-${row.rowIndex}`}>
                                <td>
                                  <input
                                    className="ocr-field-input"
                                    value={row.sourceRank}
                                    onChange={(e) => updateRankingRow(entry.id, row.rowIndex, 'sourceRank', e.target.value)}
                                  />
                                </td>
                                <td>
                                  <input
                                    className="ocr-field-input"
                                    value={row.governorNameRaw}
                                    onChange={(e) =>
                                      updateRankingRow(entry.id, row.rowIndex, 'governorNameRaw', e.target.value)
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    className="ocr-field-input"
                                    value={row.allianceRaw || row.titleRaw || ''}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      updateRankingRow(entry.id, row.rowIndex, 'allianceRaw', value);
                                      updateRankingRow(entry.id, row.rowIndex, 'titleRaw', '');
                                    }}
                                  />
                                </td>
                                <td>
                                  <input
                                    className="ocr-field-input"
                                    value={row.metricRaw}
                                    onChange={(e) => updateRankingRow(entry.id, row.rowIndex, 'metricRaw', e.target.value)}
                                  />
                                </td>
                                <td>{Math.round(row.confidence)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  {entry.status === 'done' && entry.ingestionDomain === 'profile_snapshot' ? (
                    <div>
                      <div className="ocr-review-body">
                        {fields.map((f) => {
                          const validation = entry.validation.find(
                            (v) => v.field === (f.key === 'governorName' ? 'name' : f.key)
                          );
                          const severity = validation?.severity ?? 'ok';
                          const confidenceValue =
                            f.key === 'governorName' ? entry.confidences.name : entry.confidences[f.key];

                          return (
                            <React.Fragment key={f.key}>
                              <label className="ocr-field-label">{f.label}</label>
                              <div className="ocr-field-value">
                                <input
                                  className={`ocr-field-input ${
                                    severity === 'error' ? 'has-error' : severity === 'warning' ? 'has-warning' : ''
                                  }`}
                                  value={entry.values[f.key] || ''}
                                  onChange={(e) => updateValue(entry.id, f.key, e.target.value)}
                                />
                                <span className="validation-icon" title={validation?.warning || 'Looks good'}>
                                  {severity === 'error' ? (
                                    <XCircle size={15} color="#ff9cad" />
                                  ) : severity === 'warning' ? (
                                    <CircleAlert size={15} color="#f7cf76" />
                                  ) : (
                                    <CheckCircle2 size={15} color="#72f5c7" />
                                  )}
                                </span>
                                <span className="text-muted text-sm">{Math.round(confidenceValue || 0)}%</span>
                              </div>
                            </React.Fragment>
                          );
                        })}
                      </div>

                      {validationHasIssue ? (
                        <div style={{ padding: '0 20px 16px' }}>
                          {entry.validation
                            .filter((v) => v.severity !== 'ok' && v.warning)
                            .map((v) => (
                              <div
                                key={`${entry.id}-${v.field}`}
                                className={`text-sm ${v.severity === 'error' ? 'delta-negative' : 'text-gold'}`}
                              >
                                {v.warning}
                              </div>
                            ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {entry.status === 'done' && entry.failureReasons && entry.failureReasons.length > 0 ? (
                    <div style={{ padding: '0 20px 16px' }}>
                      {entry.failureReasons.slice(0, 5).map((reason) => (
                        <div key={`${entry.id}-${reason}`} className="text-sm text-muted">
                          • {reason}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          <div className="review-save-row">
            <span className="text-muted">
              {confirmedCount} of {doneCount} entries confirmed
            </span>
            <button
              className="btn btn-primary btn-lg"
              disabled={!selectedEventId || !workspaceId || !accessToken || confirmedCount === 0 || saving}
              onClick={saveAll}
            >
              {saving ? (
                <>
                  <Clock3 size={14} /> Queueing...
                </>
              ) : (
                <>
                  <ShieldCheck size={14} /> Queue {confirmedCount} for Review
                </>
              )}
            </button>
          </div>

          {submitMessage ? (
            <div className={`card mt-16 ${submitMessage.type === 'error' ? 'delta-negative' : ''}`}>
              <div className="flex items-center gap-8">
                {submitMessage.type === 'success' ? (
                  <CheckCircle2 size={15} color="#72f5c7" />
                ) : (
                  <CircleAlert size={15} color="#ff9cad" />
                )}
                <span className="text-sm">{submitMessage.text}</span>
              </div>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {showCreateModal ? (
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
              <select className="form-select" value={newEventType} onChange={(e) => setNewEventType(e.target.value)}>
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
                <Camera size={14} /> Create Event
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
