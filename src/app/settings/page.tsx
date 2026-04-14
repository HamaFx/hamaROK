'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save, Settings2, Shield, Webhook } from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { FilterBar, KpiCard, PageHero, Panel, StatusPill } from '@/components/ui/primitives';

interface SettingsConfig {
  t4Weight: number;
  t5Weight: number;
  deadWeight: number;
  kpPerPowerRatio: number;
  deadPerPowerRatio: number;
  discordWebhook: string;
}

type AllianceTag = 'GODt' | 'V57' | 'P57R';

interface ActivityStandardState {
  allianceTag: AllianceTag;
  allianceLabel: string;
  contributionPoints: string;
  powerGrowth: string;
  isActive: boolean;
}

interface ActivityStandardApiRow {
  allianceTag: string;
  allianceLabel: string;
  metricKey: 'contribution_points' | 'power_growth';
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
};

function defaultStandards(): ActivityStandardState[] {
  return ALLIANCES.map((alliance) => ({
    allianceTag: alliance.tag,
    allianceLabel: alliance.label,
    contributionPoints: '0',
    powerGrowth: '0',
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
    refreshSession,
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
            if (row.metricKey === 'power_growth') {
              merged[idx].powerGrowth = normalizeIntegerInput(String(row.minimumValue || '0'));
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
          metricKey: 'power_growth',
          minimumValue: normalizeIntegerInput(row.powerGrowth),
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
      [name]: name === 'discordWebhook' ? value : Number(value),
    }));
  };

  const handleStandardChange = (
    allianceTag: AllianceTag,
    key: 'contributionPoints' | 'powerGrowth',
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
    const totalGrowth = standards.reduce(
      (sum, row) => sum + BigInt(normalizeIntegerInput(row.powerGrowth)),
      BigInt(0)
    );

    return {
      trackedAlliances: members,
      totalContribution: totalContribution.toString(),
      totalGrowth: totalGrowth.toString(),
    };
  }, [standards]);

  return (
    <div className="page-container">
      <PageHero
        title="Kingdom Settings"
        subtitle="One place for combat formula, weekly activity standards, and Discord delivery settings."
        actions={
          <FilterBar>
            <button className="btn btn-secondary" onClick={() => void refreshSession()} disabled={sessionLoading}>
              <RefreshCw size={14} /> {sessionLoading ? 'Connecting...' : 'Reconnect'}
            </button>
            <button className="btn btn-primary" onClick={saveAll} disabled={saving || loading}>
              <Save size={14} /> {saving ? 'Saving...' : 'Save All'}
            </button>
          </FilterBar>
        }
      />

      {!workspaceReady ? (
        <div className="card mb-24">
          <div className="text-sm text-muted">
            {sessionLoading ? 'Connecting workspace...' : sessionError || 'Workspace session is not ready yet.'}
          </div>
        </div>
      ) : null}

      <div className="grid-4 mb-24">
        <KpiCard label="T4 Weight" value={config.t4Weight} hint="Kill score multiplier" tone="info" />
        <KpiCard label="T5 Weight" value={config.t5Weight} hint="Kill score multiplier" tone="warn" />
        <KpiCard label="Dead Weight" value={config.deadWeight} hint="Commitment multiplier" tone="good" />
        <KpiCard label="Formula Mix" value={formulaPreview.killWeight} hint="Combined kill weighting" tone="neutral" />
      </div>

      <div className="grid-2 mb-24">
        <Panel
          title="Combat Formula"
          subtitle="Scoring multipliers used across compare and warrior analytics."
          actions={
            <button className="btn btn-secondary btn-sm" onClick={() => setConfig(DEFAULTS)}>
              Reset Formula
            </button>
          }
        >
          <div className="mb-16">
            <label className="form-label">
              <span>T4 Kill Weight</span>
              <span>{config.t4Weight} DKP</span>
            </label>
            <input
              className="w-full"
              type="range"
              name="t4Weight"
              min="0"
              max="5"
              step="0.1"
              value={config.t4Weight}
              onChange={handleConfigChange}
            />
          </div>

          <div className="mb-16">
            <label className="form-label">
              <span>T5 Kill Weight</span>
              <span>{config.t5Weight} DKP</span>
            </label>
            <input
              className="w-full"
              type="range"
              name="t5Weight"
              min="0"
              max="10"
              step="0.5"
              value={config.t5Weight}
              onChange={handleConfigChange}
            />
          </div>

          <div className="mb-16">
            <label className="form-label">
              <span>Dead Troops Weight</span>
              <span>{config.deadWeight} DKP</span>
            </label>
            <input
              className="w-full"
              type="range"
              name="deadWeight"
              min="0"
              max="25"
              step="1"
              value={config.deadWeight}
              onChange={handleConfigChange}
            />
          </div>

          <div className="mb-16">
            <label className="form-label">
              <span>Expected KP per 1M power</span>
              <span>{(config.kpPerPowerRatio * 1000).toLocaleString()}k</span>
            </label>
            <input
              className="w-full"
              type="range"
              name="kpPerPowerRatio"
              min="0"
              max="2"
              step="0.05"
              value={config.kpPerPowerRatio}
              onChange={handleConfigChange}
            />
          </div>

          <div>
            <label className="form-label">
              <span>Expected Deads per 1M power</span>
              <span>{(config.deadPerPowerRatio * 1000).toLocaleString()}k</span>
            </label>
            <input
              className="w-full"
              type="range"
              name="deadPerPowerRatio"
              min="0"
              max="0.5"
              step="0.01"
              value={config.deadPerPowerRatio}
              onChange={handleConfigChange}
            />
          </div>

          <FilterBar className="mt-12">
            <Settings2 size={14} />
            <span className="text-sm text-muted">
              Engagement mix score: {formulaPreview.engagementWeight}
            </span>
          </FilterBar>
        </Panel>

        <Panel
          title="Weekly Activity Standards"
          subtitle="Minimum thresholds reset every Monday 00:00 UTC."
        >
          <div className="data-table-wrap">
            <table className="data-table data-table-dense">
              <thead>
                <tr>
                  <th>Alliance</th>
                  <th>Contribution Min</th>
                  <th>Power Growth Min</th>
                </tr>
              </thead>
              <tbody>
                {standards.map((row) => (
                  <tr key={row.allianceTag}>
                    <td>
                      <strong>{row.allianceLabel}</strong>
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="form-input"
                        value={row.contributionPoints}
                        onChange={(e) =>
                          handleStandardChange(row.allianceTag, 'contributionPoints', e.target.value)
                        }
                        aria-label={`${row.allianceLabel} contribution minimum`}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="form-input"
                        value={row.powerGrowth}
                        onChange={(e) =>
                          handleStandardChange(row.allianceTag, 'powerGrowth', e.target.value)
                        }
                        aria-label={`${row.allianceLabel} power growth minimum`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <FilterBar className="mt-12">
            <Shield size={14} />
            <span className="text-sm text-muted">
              Weekly baseline totals: Contribution {formatInt(weeklySummary.totalContribution)} • Power Growth {formatInt(weeklySummary.totalGrowth)}
            </span>
          </FilterBar>
        </Panel>
      </div>

      <Panel title="Discord Integration">
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Webhook URL</label>
          <input
            type="text"
            className="form-input"
            name="discordWebhook"
            value={config.discordWebhook}
            onChange={handleConfigChange}
            placeholder="https://discord.com/api/webhooks/..."
          />
        </div>
        <FilterBar className="mt-12">
          <Webhook size={14} />
          <span className="text-sm text-muted">Used by Discord publish endpoints and delivery retries.</span>
        </FilterBar>
      </Panel>

      {message ? (
        <div className="mt-16">
          <StatusPill label={message.text} tone={message.type === 'success' ? 'good' : 'bad'} />
        </div>
      ) : null}
    </div>
  );
}
