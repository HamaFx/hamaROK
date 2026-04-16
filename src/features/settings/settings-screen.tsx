'use client';

import { useEffect, useMemo, useState } from 'react';
import { Save, Settings2, Shield, Webhook } from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterBar, KpiCard, PageHero, Panel, StatusPill } from '@/components/ui/primitives';

interface SettingsConfig {
  t4Weight: number;
  t5Weight: number;
  deadWeight: number;
  kpPerPowerRatio: number;
  deadPerPowerRatio: number;
  discordWebhook: string;
  weekResetUtcOffset: string;
}

type AllianceTag = 'GODt' | 'V57' | 'P57R';

interface ActivityStandardState {
  allianceTag: AllianceTag;
  allianceLabel: string;
  contributionPoints: string;
  fortDestroying: string;
  powerGrowth: string;
  killPointsGrowth: string;
  isActive: boolean;
}

interface ActivityStandardApiRow {
  allianceTag: string;
  allianceLabel: string;
  metricKey: 'contribution_points' | 'power_growth' | 'fort_destroying' | 'kill_points_growth';
  minimumValue: string;
  isActive: boolean;
}

const ALLIANCES: Array<{ tag: AllianceTag; label: string }> = [
  { tag: 'GODt', label: '[GODt] GOD of Thunder' },
  { tag: 'V57', label: '[V57] Legacy of Velmora' },
  { tag: 'P57R', label: '[P57R] PHOENIX RISING 4057' },
];

const DEFAULTS: SettingsConfig = {
  t4Weight: 0.5,
  t5Weight: 1.0,
  deadWeight: 5.0,
  kpPerPowerRatio: 0.3,
  deadPerPowerRatio: 0.02,
  discordWebhook: '',
  weekResetUtcOffset: '+00:00',
};

function defaultStandards(): ActivityStandardState[] {
  return ALLIANCES.map((alliance) => ({
    allianceTag: alliance.tag,
    allianceLabel: alliance.label,
    contributionPoints: '0',
    fortDestroying: '0',
    powerGrowth: '0',
    killPointsGrowth: '0',
    isActive: true,
  }));
}

function normalizeIntegerInput(value: string): string {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (!digits) return '0';
  return digits.replace(/^0+(?=\d)/, '');
}

function formatInt(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : value;
}

export default function SettingsPage() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
  } = useWorkspaceSession();

  const [config, setConfig] = useState<SettingsConfig>(DEFAULTS);
  const [standards, setStandards] = useState<ActivityStandardState[]>(defaultStandards());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!workspaceReady) {
      setLoading(sessionLoading);
      return;
    }

    const run = async () => {
      try {
        setLoading(true);
        setMessage(null);

        const [settingsRes, standardsRes] = await Promise.all([
          fetch(`/api/v2/workspaces/${workspaceId}/settings`, {
            headers: {
              'x-access-token': accessToken,
            },
          }),
          fetch(`/api/v2/activity/standards?workspaceId=${encodeURIComponent(workspaceId)}`, {
            headers: {
              'x-access-token': accessToken,
            },
          }),
        ]);

        const settingsPayload = await settingsRes.json();
        if (!settingsRes.ok || !settingsPayload?.data) {
          throw new Error(settingsPayload?.error?.message || 'Failed to load settings from API.');
        }

        const settingsData = settingsPayload.data as Partial<SettingsConfig>;
        setConfig({
          t4Weight: settingsData.t4Weight ?? DEFAULTS.t4Weight,
          t5Weight: settingsData.t5Weight ?? DEFAULTS.t5Weight,
          deadWeight: settingsData.deadWeight ?? DEFAULTS.deadWeight,
          kpPerPowerRatio: settingsData.kpPerPowerRatio ?? DEFAULTS.kpPerPowerRatio,
          deadPerPowerRatio: settingsData.deadPerPowerRatio ?? DEFAULTS.deadPerPowerRatio,
          discordWebhook: settingsData.discordWebhook ?? DEFAULTS.discordWebhook,
          weekResetUtcOffset:
            typeof settingsData.weekResetUtcOffset === 'string'
              ? settingsData.weekResetUtcOffset
              : DEFAULTS.weekResetUtcOffset,
        });

        if (standardsRes.ok) {
          const standardsPayload = await standardsRes.json();
          const rows = (Array.isArray(standardsPayload?.data)
            ? standardsPayload.data
            : []) as ActivityStandardApiRow[];

          const merged = defaultStandards();
          for (const row of rows) {
            const idx = merged.findIndex((item) => item.allianceTag === row.allianceTag);
            if (idx < 0) continue;
            if (row.metricKey === 'contribution_points') {
              merged[idx].contributionPoints = normalizeIntegerInput(String(row.minimumValue || '0'));
            }
            if (row.metricKey === 'fort_destroying') {
              merged[idx].fortDestroying = normalizeIntegerInput(String(row.minimumValue || '0'));
            }
            if (row.metricKey === 'power_growth') {
              merged[idx].powerGrowth = normalizeIntegerInput(String(row.minimumValue || '0'));
            }
            if (row.metricKey === 'kill_points_growth') {
              merged[idx].killPointsGrowth = normalizeIntegerInput(String(row.minimumValue || '0'));
            }
            merged[idx].isActive = row.isActive ?? true;
            if (row.allianceLabel) {
              merged[idx].allianceLabel = row.allianceLabel;
            }
          }
          setStandards(merged);
        } else {
          setStandards(defaultStandards());
        }
      } catch (cause) {
        setMessage({
          type: 'error',
          text: cause instanceof Error ? cause.message : 'Failed to load settings from API.',
        });
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [workspaceId, accessToken, workspaceReady, sessionLoading]);

  const saveAll = async () => {
    if (!workspaceReady) {
      setMessage({
        type: 'error',
        text: sessionLoading ? 'Connecting workspace session...' : sessionError || 'Workspace session is not ready.',
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const standardsPayload = standards.flatMap((row) => [
        {
          allianceTag: row.allianceTag,
          metricKey: 'contribution_points',
          minimumValue: normalizeIntegerInput(row.contributionPoints),
          isActive: row.isActive,
        },
        {
          allianceTag: row.allianceTag,
          metricKey: 'fort_destroying',
          minimumValue: normalizeIntegerInput(row.fortDestroying),
          isActive: row.isActive,
        },
        {
          allianceTag: row.allianceTag,
          metricKey: 'power_growth',
          minimumValue: normalizeIntegerInput(row.powerGrowth),
          isActive: row.isActive,
        },
        {
          allianceTag: row.allianceTag,
          metricKey: 'kill_points_growth',
          minimumValue: normalizeIntegerInput(row.killPointsGrowth),
          isActive: row.isActive,
        },
      ]);

      const [settingsRes, standardsRes] = await Promise.all([
        fetch(`/api/v2/workspaces/${workspaceId}/settings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': accessToken,
          },
          body: JSON.stringify(config),
        }),
        fetch('/api/v2/activity/standards', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': accessToken,
          },
          body: JSON.stringify({
            workspaceId,
            standards: standardsPayload,
          }),
        }),
      ]);

      const settingsResult = await settingsRes.json();
      const standardsResult = await standardsRes.json();

      if (!settingsRes.ok) {
        throw new Error(settingsResult?.error?.message || 'Failed to save combat settings.');
      }
      if (!standardsRes.ok) {
        throw new Error(standardsResult?.error?.message || 'Failed to save weekly standards.');
      }

      setMessage({ type: 'success', text: 'Settings and weekly standards saved.' });
    } catch (cause) {
      setMessage({
        type: 'error',
        text: cause instanceof Error ? cause.message : 'Failed to save settings.',
      });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 4000);
    }
  };

  const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]:
        name === 'discordWebhook' || name === 'weekResetUtcOffset'
          ? value
          : Number(value),
    }));
  };

  const handleStandardChange = (
    allianceTag: AllianceTag,
    key: 'contributionPoints' | 'fortDestroying' | 'powerGrowth' | 'killPointsGrowth',
    value: string
  ) => {
    setStandards((prev) =>
      prev.map((row) =>
        row.allianceTag === allianceTag
          ? {
              ...row,
              [key]: normalizeIntegerInput(value),
            }
          : row
      )
    );
  };

  const formulaPreview = useMemo(() => {
    const killWeight = config.t4Weight + config.t5Weight;
    const engagementWeight = config.deadWeight + config.kpPerPowerRatio * 10 + config.deadPerPowerRatio * 100;
    return {
      killWeight: Math.round(killWeight * 100) / 100,
      engagementWeight: Math.round(engagementWeight * 100) / 100,
    };
  }, [config]);

  const weeklySummary = useMemo(() => {
    const members = standards.filter((row) => row.isActive).length;
    const totalContribution = standards.reduce(
      (sum, row) => sum + BigInt(normalizeIntegerInput(row.contributionPoints)),
      BigInt(0)
    );
    const totalFort = standards.reduce(
      (sum, row) => sum + BigInt(normalizeIntegerInput(row.fortDestroying)),
      BigInt(0)
    );
    const totalGrowth = standards.reduce(
      (sum, row) => sum + BigInt(normalizeIntegerInput(row.powerGrowth)),
      BigInt(0)
    );
    const totalKpGrowth = standards.reduce(
      (sum, row) => sum + BigInt(normalizeIntegerInput(row.killPointsGrowth)),
      BigInt(0)
    );

    return {
      trackedAlliances: members,
      totalContribution: totalContribution.toString(),
      totalFort: totalFort.toString(),
      totalGrowth: totalGrowth.toString(),
      totalKpGrowth: totalKpGrowth.toString(),
    };
  }, [standards]);

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <PageHero
        title="Settings"
        subtitle="Configure combat scoring, weekly standards, and Discord delivery."
        actions={
          <Button
            className="rounded-full bg-[color:var(--primary)] text-primary-foreground hover:opacity-90 shadow-lg hover:opacity-95"
            onClick={saveAll}
            disabled={saving || loading}
          >
            <Save data-icon="inline-start" />
            {saving ? 'Saving...' : 'Save All'}
          </Button>
        }
      />

      <SessionGate ready={workspaceReady} loading={sessionLoading} error={sessionError}>
        {message && message.type === 'error' ? <InlineError message={message.text} /> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="T4 Weight" value={config.t4Weight} hint="Kill score multiplier" tone="info" />
          <KpiCard label="T5 Weight" value={config.t5Weight} hint="Kill score multiplier" tone="warn" />
          <KpiCard label="Dead Weight" value={config.deadWeight} hint="Commitment multiplier" tone="good" />
          <KpiCard label="Formula Mix" value={formulaPreview.killWeight} hint="Combined kill weighting" tone="neutral" />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel
            title="Combat Formula"
            subtitle="Scoring multipliers used across compare and warrior analytics."
            actions={
              <Button
                variant="outline"
                className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
                onClick={() => setConfig(DEFAULTS)}
              >
                Reset Formula
              </Button>
            }
          >
            <div className="space-y-5">
              <div className="space-y-2.5">
                <label className="flex items-center justify-between gap-3 text-xs  text-tier-3">
                  <span>T4 Kill Weight</span>
                  <span>{config.t4Weight} DKP</span>
                </label>
                <input
                  className="h-2 w-full accent-sky-300"
                  type="range"
                  name="t4Weight"
                  min="0"
                  max="5"
                  step="0.1"
                  value={config.t4Weight}
                  onChange={handleConfigChange}
                />
              </div>
              <div className="space-y-2.5">
                <label className="flex items-center justify-between gap-3 text-xs  text-tier-3">
                  <span>T5 Kill Weight</span>
                  <span>{config.t5Weight} DKP</span>
                </label>
                <input
                  className="h-2 w-full accent-sky-300"
                  type="range"
                  name="t5Weight"
                  min="0"
                  max="10"
                  step="0.5"
                  value={config.t5Weight}
                  onChange={handleConfigChange}
                />
              </div>
              <div className="space-y-2.5">
                <label className="flex items-center justify-between gap-3 text-xs  text-tier-3">
                  <span>Dead Troops Weight</span>
                  <span>{config.deadWeight} DKP</span>
                </label>
                <input
                  className="h-2 w-full accent-sky-300"
                  type="range"
                  name="deadWeight"
                  min="0"
                  max="25"
                  step="1"
                  value={config.deadWeight}
                  onChange={handleConfigChange}
                />
              </div>
              <div className="space-y-2.5">
                <label className="flex items-center justify-between gap-3 text-xs  text-tier-3">
                  <span>Expected KP per 1M power</span>
                  <span>{(config.kpPerPowerRatio * 1000).toLocaleString()}k</span>
                </label>
                <input
                  className="h-2 w-full accent-sky-300"
                  type="range"
                  name="kpPerPowerRatio"
                  min="0"
                  max="2"
                  step="0.05"
                  value={config.kpPerPowerRatio}
                  onChange={handleConfigChange}
                />
              </div>
              <div className="space-y-2.5">
                <label className="flex items-center justify-between gap-3 text-xs  text-tier-3">
                  <span>Expected Deads per 1M power</span>
                  <span>{(config.deadPerPowerRatio * 1000).toLocaleString()}k</span>
                </label>
                <input
                  className="h-2 w-full accent-sky-300"
                  type="range"
                  name="deadPerPowerRatio"
                  min="0"
                  max="0.5"
                  step="0.01"
                  value={config.deadPerPowerRatio}
                  onChange={handleConfigChange}
                />
              </div>
            </div>

            <FilterBar className="mt-4">
              <Settings2 className="size-4" />
              <span className="text-sm text-tier-2">Engagement mix score: {formulaPreview.engagementWeight}</span>
            </FilterBar>
          </Panel>

          <Panel
            title="Weekly Activity Standards"
            subtitle="Minimum thresholds reset weekly using the configured game reset offset."
          >
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-3 text-xs  text-tier-3">
                <span>Week Reset UTC Offset</span>
                <span>{config.weekResetUtcOffset}</span>
              </label>
              <Input
                type="text"
                name="weekResetUtcOffset"
                value={config.weekResetUtcOffset}
                onChange={handleConfigChange}
                placeholder="+00:00"
                pattern="^[+-](0\\d|1[0-4]):[0-5]\\d$"
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
              />
              <p className="text-xs text-tier-3">Format `+HH:MM` or `-HH:MM` (example `+03:00`).</p>
            </div>

            <div className="mt-4 space-y-3 md:hidden">
              {standards.map((row) => (
                <div
                  key={row.allianceTag}
                  className="rounded-[22px] border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3.5"
                >
                  <p className="font-heading text-sm text-tier-1">{row.allianceLabel}</p>
                  <div className="mt-3 grid gap-2.5 grid-cols-2">
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={row.contributionPoints}
                      onChange={(e) => handleStandardChange(row.allianceTag, 'contributionPoints', e.target.value)}
                      aria-label={`${row.allianceLabel} contribution minimum`}
                      placeholder="Contribution"
                      className="rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={row.fortDestroying}
                      onChange={(e) => handleStandardChange(row.allianceTag, 'fortDestroying', e.target.value)}
                      aria-label={`${row.allianceLabel} fort destroying minimum`}
                      placeholder="Fort"
                      className="rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={row.powerGrowth}
                      onChange={(e) => handleStandardChange(row.allianceTag, 'powerGrowth', e.target.value)}
                      aria-label={`${row.allianceLabel} power growth minimum`}
                      placeholder="Power"
                      className="rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={row.killPointsGrowth}
                      onChange={(e) => handleStandardChange(row.allianceTag, 'killPointsGrowth', e.target.value)}
                      aria-label={`${row.allianceLabel} kill points growth minimum`}
                      placeholder="KP"
                      className="rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 hidden overflow-hidden rounded-[22px] border border-[color:var(--stroke-soft)] md:block">
              <table className="w-full border-collapse text-sm text-tier-2">
                <thead className="bg-[color:var(--surface-3)] text-xs  text-tier-3">
                  <tr>
                    <th className="px-3 py-2 text-left">Alliance</th>
                    <th className="px-3 py-2 text-left">Contribution Min</th>
                    <th className="px-3 py-2 text-left">Fort Destroy Min</th>
                    <th className="px-3 py-2 text-left">Power Growth Min</th>
                    <th className="px-3 py-2 text-left">KP Growth Min</th>
                  </tr>
                </thead>
                <tbody>
                  {standards.map((row) => (
                    <tr key={row.allianceTag} className="border-t border-[color:var(--stroke-subtle)]">
                      <td className="px-3 py-2.5 font-medium text-tier-1">{row.allianceLabel}</td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={row.contributionPoints}
                          onChange={(e) => handleStandardChange(row.allianceTag, 'contributionPoints', e.target.value)}
                          aria-label={`${row.allianceLabel} contribution minimum`}
                          className="h-11 rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={row.fortDestroying}
                          onChange={(e) => handleStandardChange(row.allianceTag, 'fortDestroying', e.target.value)}
                          aria-label={`${row.allianceLabel} fort destroying minimum`}
                          className="h-11 rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={row.powerGrowth}
                          onChange={(e) => handleStandardChange(row.allianceTag, 'powerGrowth', e.target.value)}
                          aria-label={`${row.allianceLabel} power growth minimum`}
                          className="h-11 rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={row.killPointsGrowth}
                          onChange={(e) => handleStandardChange(row.allianceTag, 'killPointsGrowth', e.target.value)}
                          aria-label={`${row.allianceLabel} kill points growth minimum`}
                          className="h-11 rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <FilterBar className="mt-4">
              <Shield className="size-4" />
              <span className="text-sm text-tier-2">
                Totals: Contribution {formatInt(weeklySummary.totalContribution)} • Fort {formatInt(weeklySummary.totalFort)} • Power Growth {formatInt(weeklySummary.totalGrowth)} • KP Growth {formatInt(weeklySummary.totalKpGrowth)}
              </span>
            </FilterBar>
          </Panel>
        </div>

        <Panel title="Discord Integration">
          <div className="space-y-2">
            <label className="text-xs  text-tier-3">Webhook URL</label>
            <Input
              type="text"
              name="discordWebhook"
              value={config.discordWebhook}
              onChange={handleConfigChange}
              placeholder="https://discord.com/api/webhooks/..."
              className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
            />
          </div>
          <FilterBar className="mt-4">
            <Webhook className="size-4" />
            <span className="text-sm text-tier-2">Used by Discord publish endpoints and delivery retries.</span>
          </FilterBar>
        </Panel>

        {message && message.type === 'success' ? (
          <FilterBar className="rounded-2xl border-emerald-300/16 bg-emerald-400/10 px-4 py-3 text-emerald-100">
            <StatusPill label="Saved" tone="good" />
            <span className="text-sm">{message.text}</span>
          </FilterBar>
        ) : null}
      </SessionGate>
    </div>
  );
}
