'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Target, Upload, Play, Save } from 'lucide-react';
import { OCR_TEMPLATES } from '@/lib/ocr/templates';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState, FilterBar, PageHero, Panel } from '@/components/ui/primitives';

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
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
  } = useWorkspaceSession();
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
    if (!workspaceReady) {
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
  }, [workspaceId, accessToken, workspaceReady]);

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
    if (!workspaceReady) {
      setMessage(sessionLoading ? 'Connecting workspace session...' : 'Workspace session is not ready.');
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

  const PROFILE_NONE = '__create__';

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHero
        title="Calibration"
        subtitle="Tune OCR profile offsets and overlays for reliable extraction."
        actions={
          <Button
            className="rounded-full bg-[linear-gradient(135deg,#5a7fff,#7ce6ff)] text-black hover:opacity-95"
            onClick={saveProfile}
            disabled={saving || !workspaceReady}
          >
            <Save data-icon="inline-start" />
            {saving ? 'Saving...' : 'Save Profile'}
          </Button>
        }
      />

      <SessionGate ready={workspaceReady} loading={sessionLoading} error={sessionError}>
        {message && (message.toLowerCase().includes('failed') || message.toLowerCase().includes('required')) ? (
          <InlineError message={message} />
        ) : null}

        <Panel title="1. Profile Selection" subtitle="Choose a profile/template and set profile metadata.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-[0.18em] text-white/45">Existing Profile</label>
              <Select
                value={selectedProfileId || PROFILE_NONE}
                onValueChange={(value) => setSelectedProfileId(value === PROFILE_NONE ? '' : value)}
              >
                <SelectTrigger className="rounded-2xl border-white/10 bg-white/4 text-white">
                  <SelectValue placeholder="Create from template" />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[rgba(8,10,16,0.98)] text-white">
                  <SelectItem value={PROFILE_NONE}>Create from template</SelectItem>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name} ({profile.profileKey} v{profile.version})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-[0.18em] text-white/45">Base Template</label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="rounded-2xl border-white/10 bg-white/4 text-white">
                  <SelectValue placeholder="Select base template" />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[rgba(8,10,16,0.98)] text-white">
                  {OCR_TEMPLATES.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label} ({item.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-[0.18em] text-white/45">Profile Key</label>
              <Input
                value={profileKey}
                onChange={(e) => setProfileKey(e.target.value)}
                className="rounded-2xl border-white/10 bg-white/4 text-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-[0.18em] text-white/45">Profile Name</label>
              <Input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="rounded-2xl border-white/10 bg-white/4 text-white"
              />
            </div>
          </div>
          <FilterBar className="mt-4">
            <Button
              variant="outline"
              className="rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white"
              onClick={loadProfileToForm}
              disabled={!selectedProfile}
            >
              Load Selected Profile
            </Button>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={updateExisting}
                onChange={(e) => setUpdateExisting(e.target.checked)}
                disabled={!selectedProfile || selectedProfile.id.startsWith('template:')}
              />
              Update selected profile directly
            </label>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-white/70">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              Set as default profile
            </label>
          </FilterBar>
        </Panel>

        <Panel title="2. Calibrate Overlay" subtitle="Upload a reference screenshot and tune offsets/scales.">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-[0.18em] text-white/45">Reference Screenshot</label>
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="rounded-2xl border-white/10 bg-white/4 text-white file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-white"
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
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.18em] text-white/45">
                  <span>X Offset</span>
                  <span>{xOffset.toFixed(3)}</span>
                </label>
                <input className="h-2 w-full accent-sky-300" type="range" min={-0.1} max={0.1} step={0.001} value={xOffset} onChange={(e) => setXOffset(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.18em] text-white/45">
                  <span>Y Offset</span>
                  <span>{yOffset.toFixed(3)}</span>
                </label>
                <input className="h-2 w-full accent-sky-300" type="range" min={-0.1} max={0.1} step={0.001} value={yOffset} onChange={(e) => setYOffset(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.18em] text-white/45">
                  <span>X Scale</span>
                  <span>{xScale.toFixed(2)}</span>
                </label>
                <input className="h-2 w-full accent-sky-300" type="range" min={0.8} max={1.2} step={0.01} value={xScale} onChange={(e) => setXScale(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.18em] text-white/45">
                  <span>Y Scale</span>
                  <span>{yScale.toFixed(2)}</span>
                </label>
                <input className="h-2 w-full accent-sky-300" type="range" min={0.8} max={1.2} step={0.01} value={yScale} onChange={(e) => setYScale(Number(e.target.value))} />
              </div>
            </div>
          </div>
        </Panel>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="3. Overlay Preview">
            {imageUrl ? (
              <div className="relative w-full overflow-hidden rounded-xl">
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
              <EmptyState
                title="Upload a screenshot"
                description="Field overlays will appear here for calibration."
                action={<Upload className="size-10 text-white/34" />}
              />
            )}
          </Panel>

          <Panel
            title="4. Live OCR Test"
            actions={
              <Button
                variant="outline"
                className="rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white"
                onClick={runLiveTest}
                disabled={liveRunning || !imageFile}
              >
                <Play data-icon="inline-start" />
                {liveRunning ? 'Running OCR...' : 'Run Test'}
              </Button>
            }
          >
            {liveResult ? (
              <div className="space-y-3 text-sm text-white/72">
                <p>
                  Avg confidence: <strong className="text-white">{Math.round(liveResult.averageConfidence)}%</strong> • Template:{' '}
                  {liveResult.templateId}
                </p>
                {Object.entries(liveResult.values).map(([field, value]) => (
                  <div key={field} className="flex flex-wrap items-center gap-2">
                    <strong className="text-white">{field}</strong>: {value || '—'}{' '}
                    <span className="text-white/45">({Math.round(liveResult.confidences[field] || 0)}%)</span>
                  </div>
                ))}
                {liveResult.failureReasons.length > 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/4 p-3 text-white/60">
                    {liveResult.failureReasons.slice(0, 5).map((reason) => (
                      <div key={reason}>• {reason}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState
                title="No results"
                description="Run the test to verify your profile before saving."
                action={<Target className="size-10 text-white/34" />}
              />
            )}
          </Panel>
        </div>

        {message && !message.toLowerCase().includes('failed') && !message.toLowerCase().includes('required') ? (
          <FilterBar className="rounded-2xl border-emerald-300/16 bg-emerald-400/10 px-4 py-3 text-emerald-100">
            <span className="text-sm">{message}</span>
          </FilterBar>
        ) : null}
      </SessionGate>
    </div>
  );
}
