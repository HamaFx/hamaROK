'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Target, Upload, Play, Save } from 'lucide-react';
import { OCR_TEMPLATES } from '@/lib/ocr/templates';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
import { PageHero, Panel } from '@/components/ui/primitives';

type Region = { x: number; y: number; width: number; height: number };

type LiveResult = {
  averageConfidence: number;
  templateId: string;
  profileId: string;
  values: Record<string, string>;
  confidences: Record<string, number>;
  failureReasons: string[];
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export default function CalibrationPage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [profiles, setProfiles] = useState<OcrRuntimeProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState({ width: 1600, height: 900 });

  const [templateId, setTemplateId] = useState(OCR_TEMPLATES[0].id);
  const [profileKey, setProfileKey] = useState('default-16-9');
  const [profileName, setProfileName] = useState('My Calibration');
  const [isDefault, setIsDefault] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(false);

  const [xOffset, setXOffset] = useState(0);
  const [yOffset, setYOffset] = useState(0);
  const [xScale, setXScale] = useState(1);
  const [yScale, setYScale] = useState(1);
  const [saving, setSaving] = useState(false);
  const [liveRunning, setLiveRunning] = useState(false);
  const [liveResult, setLiveResult] = useState<LiveResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setWorkspaceId(localStorage.getItem('workspaceId') || '');
    setAccessToken(localStorage.getItem('workspaceToken') || '');
  }, []);

  useEffect(() => {
    if (workspaceId) localStorage.setItem('workspaceId', workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    if (accessToken) localStorage.setItem('workspaceToken', accessToken);
  }, [accessToken]);

  useEffect(() => {
    if (!workspaceId || !accessToken) {
      setProfiles([]);
      return;
    }
    let canceled = false;
    const run = async () => {
      try {
        const params = new URLSearchParams({ workspaceId });
        const res = await fetch(`/api/v2/ocr/profiles?${params.toString()}`, {
          headers: { 'x-access-token': accessToken },
        });
        const payload = await res.json();
        if (!res.ok) return;
        if (!canceled) setProfiles(Array.isArray(payload?.data) ? payload.data : []);
      } catch {
        if (!canceled) setProfiles([]);
      }
    };
    run();
    return () => {
      canceled = true;
    };
  }, [workspaceId, accessToken]);

  const template = useMemo(
    () => OCR_TEMPLATES.find((item) => item.id === templateId) || OCR_TEMPLATES[0],
    [templateId]
  );

  const calibratedRegions = useMemo(() => {
    const out: Record<string, Region> = {};
    for (const [key, region] of Object.entries(template.regions)) {
      const width = clamp(region.width * xScale, 0.01, 1);
      const height = clamp(region.height * yScale, 0.01, 1);
      const x = clamp(region.x + xOffset, 0, 1 - width);
      const y = clamp(region.y + yOffset, 0, 1 - height);
      out[key] = { x, y, width, height };
    }
    return out;
  }, [template.regions, xOffset, yOffset, xScale, yScale]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) || null;

  const loadProfileToForm = () => {
    if (!selectedProfile) return;
    setTemplateId(selectedProfile.sourceTemplateId || OCR_TEMPLATES[0].id);
    setProfileKey(selectedProfile.profileKey);
    setProfileName(selectedProfile.name);
    setIsDefault(Boolean(selectedProfile.isDefault));
    setXOffset(selectedProfile.calibration?.xOffset ?? 0);
    setYOffset(selectedProfile.calibration?.yOffset ?? 0);
    setXScale(selectedProfile.calibration?.xScale ?? 1);
    setYScale(selectedProfile.calibration?.yScale ?? 1);
    if (selectedProfile.id.startsWith('template:')) {
      setUpdateExisting(false);
    }
    setMessage(`Loaded profile ${selectedProfile.name} v${selectedProfile.version} for editing.`);
  };

  const runLiveTest = async () => {
    if (!imageFile) {
      setMessage('Upload a screenshot first to run a live OCR test.');
      return;
    }
    setLiveRunning(true);
    setMessage(null);
    try {
      const { processScreenshot } = await import('@/lib/ocr/ocr-engine');
      const tempProfile: OcrRuntimeProfile = {
        id: 'calibration-preview',
        profileKey,
        name: profileName,
        version: 1,
        sourceTemplateId: templateId,
        minWidth: Math.max(320, Math.floor(imageSize.width * 0.6)),
        maxWidth: Math.max(640, Math.ceil(imageSize.width * 1.4)),
        minAspectRatio: (imageSize.width / Math.max(1, imageSize.height)) - 0.25,
        maxAspectRatio: (imageSize.width / Math.max(1, imageSize.height)) + 0.25,
        calibration: { xOffset, yOffset, xScale, yScale },
        regions: calibratedRegions,
        isDefault: false,
      };
      const result = await processScreenshot(imageFile, {
        profiles: [tempProfile],
        preferredProfileId: tempProfile.id,
      });
      setLiveResult({
        averageConfidence: result.averageConfidence,
        templateId: result.templateId,
        profileId: result.profileId,
        values: {
          governorId: result.governorId.value,
          governorName: result.governorName.value,
          power: result.power.value,
          killPoints: result.killPoints.value,
          t4Kills: result.t4Kills.value,
          t5Kills: result.t5Kills.value,
          deads: result.deads.value,
        },
        confidences: {
          governorId: result.governorId.confidence,
          governorName: result.governorName.confidence,
          power: result.power.confidence,
          killPoints: result.killPoints.confidence,
          t4Kills: result.t4Kills.confidence,
          t5Kills: result.t5Kills.confidence,
          deads: result.deads.confidence,
        },
        failureReasons: result.failureReasons || [],
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Live OCR test failed.');
    } finally {
      setLiveRunning(false);
    }
  };

  const saveProfile = async () => {
    if (!workspaceId || !accessToken) {
      setMessage('Workspace ID and access token are required.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const body = {
        workspaceId,
        id:
          updateExisting && selectedProfile && !selectedProfile.id.startsWith('template:')
            ? selectedProfile.id
            : undefined,
        profileKey: profileKey.trim(),
        name: profileName.trim(),
        sourceTemplateId: templateId,
        isDefault,
        calibration: { xOffset, yOffset, xScale, yScale },
        regions: calibratedRegions,
      };
      const res = await fetch('/api/v2/ocr/profiles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to save profile.');
      }
      setMessage(
        updateExisting
          ? `Updated profile ${payload.data?.name || profileName}.`
          : `Saved new profile version for ${payload.data?.profileKey || profileKey}.`
      );
      const params = new URLSearchParams({ workspaceId });
      const refresh = await fetch(`/api/v2/ocr/profiles?${params.toString()}`, {
        headers: { 'x-access-token': accessToken },
      });
      const refreshPayload = await refresh.json();
      if (refresh.ok) {
        setProfiles(Array.isArray(refreshPayload?.data) ? refreshPayload.data : []);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      <PageHero
        title="OCR Calibration Wizard"
        subtitle="One-time guided setup for profile offsets and overlays."
        actions={
          <button className="btn btn-primary" onClick={saveProfile} disabled={saving}>
            <Save size={14} /> {saving ? 'Saving...' : 'Save Profile'}
          </button>
        }
      />

      <Panel title="Profile Selection" className="mb-24">
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">Existing Profile (Optional)</label>
            <select
              className="form-select"
              value={selectedProfileId}
              onChange={(e) => setSelectedProfileId(e.target.value)}
            >
              <option value="">Create from template</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.profileKey} v{profile.version})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Base Template</label>
            <select
              className="form-select"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {OCR_TEMPLATES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} ({item.id})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">Profile Key</label>
            <input
              className="form-input"
              value={profileKey}
              onChange={(e) => setProfileKey(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Profile Name</label>
            <input
              className="form-input"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-12 items-center" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={loadProfileToForm} disabled={!selectedProfile}>
            Load Selected Profile
          </button>
          <label className="text-sm flex items-center gap-8">
            <input
              type="checkbox"
              checked={updateExisting}
              onChange={(e) => setUpdateExisting(e.target.checked)}
              disabled={!selectedProfile || selectedProfile.id.startsWith('template:')}
            />
            Update selected profile directly
          </label>
          <label className="text-sm flex items-center gap-8">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            Set as default profile
          </label>
        </div>
      </Panel>

      <Panel title="Calibrate Overlay" className="mb-24">
        <div className="form-group">
          <label className="form-label">Reference Screenshot</label>
          <input
            className="form-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setImageFile(file);
              const next = URL.createObjectURL(file);
              const probe = new window.Image();
              probe.onload = () => {
                setImageSize({
                  width: probe.naturalWidth || 1600,
                  height: probe.naturalHeight || 900,
                });
              };
              probe.src = next;
              if (imageUrl) URL.revokeObjectURL(imageUrl);
              setImageUrl(next);
            }}
          />
        </div>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">X Offset ({xOffset.toFixed(3)})</label>
            <input type="range" min={-0.1} max={0.1} step={0.001} value={xOffset} onChange={(e) => setXOffset(Number(e.target.value))} />
          </div>
          <div className="form-group">
            <label className="form-label">Y Offset ({yOffset.toFixed(3)})</label>
            <input type="range" min={-0.1} max={0.1} step={0.001} value={yOffset} onChange={(e) => setYOffset(Number(e.target.value))} />
          </div>
          <div className="form-group">
            <label className="form-label">X Scale ({xScale.toFixed(2)})</label>
            <input type="range" min={0.8} max={1.2} step={0.01} value={xScale} onChange={(e) => setXScale(Number(e.target.value))} />
          </div>
          <div className="form-group">
            <label className="form-label">Y Scale ({yScale.toFixed(2)})</label>
            <input type="range" min={0.8} max={1.2} step={0.01} value={yScale} onChange={(e) => setYScale(Number(e.target.value))} />
          </div>
        </div>
      </Panel>

      <div className="grid-2">
        <Panel title="Overlay Preview">
          {imageUrl ? (
            <div style={{ position: 'relative', width: '100%', overflow: 'hidden', borderRadius: 12 }}>
              <Image
                src={imageUrl}
                alt="Calibration"
                width={imageSize.width}
                height={imageSize.height}
                style={{ width: '100%', height: 'auto', display: 'block' }}
                unoptimized
              />
              {Object.entries(calibratedRegions).map(([key, region]) => (
                <div
                  key={key}
                  title={key}
                  style={{
                    position: 'absolute',
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.width * 100}%`,
                    height: `${region.height * 100}%`,
                    border: '2px solid rgba(245,158,11,0.9)',
                    background: 'rgba(245,158,11,0.08)',
                    color: '#f59e0b',
                    fontSize: 11,
                    padding: 2,
                    pointerEvents: 'none',
                  }}
                >
                  {key}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 24 }}>
              <div className="empty-icon"><Upload size={48} /></div>
              <h3>Upload a screenshot</h3>
              <p>Field overlays will appear here for calibration.</p>
            </div>
          )}
        </Panel>

        <Panel title="Live OCR Test" actions={
          <button className="btn btn-secondary btn-sm" onClick={runLiveTest} disabled={liveRunning || !imageFile}>
            <Play size={14} /> {liveRunning ? 'Running OCR...' : 'Run Test'}
          </button>
        }>
          {liveResult ? (
            <div>
              <div className="text-sm mb-12">
                Avg confidence: <strong>{Math.round(liveResult.averageConfidence)}%</strong> • Template: {liveResult.templateId}
              </div>
              {Object.entries(liveResult.values).map(([field, value]) => (
                <div key={field} className="text-sm" style={{ marginBottom: 6 }}>
                  <strong>{field}</strong>: {value || '—'}{' '}
                  <span className="text-muted">({Math.round(liveResult.confidences[field] || 0)}%)</span>
                </div>
              ))}
              {liveResult.failureReasons.length > 0 && (
                <div className="mt-12 text-sm text-muted">
                  {liveResult.failureReasons.slice(0, 5).map((reason) => (
                    <div key={reason}>• {reason}</div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 24 }}>
              <div className="empty-icon"><Target size={48} /></div>
              <h3>No results</h3>
              <p>Run the test to verify your profile before saving.</p>
            </div>
          )}
        </Panel>
      </div>

      {message ? (
        <div className={`card mt-24 ${message.toLowerCase().includes('failed') || message.toLowerCase().includes('required') ? 'delta-negative' : ''}`}>
          <div className="text-sm">{message}</div>
        </div>
      ) : null}
    </div>
  );
}
