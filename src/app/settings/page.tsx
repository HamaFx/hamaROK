'use client';

import { useEffect, useMemo, useState } from 'react';
import { Save, Settings2, Shield, SlidersHorizontal, Webhook } from 'lucide-react';
import { FilterBar, KpiCard, PageHero, Panel, StatusPill } from '@/components/ui/primitives';

interface SettingsConfig {
  t4Weight: number;
  t5Weight: number;
  deadWeight: number;
  kpPerPowerRatio: number;
  deadPerPowerRatio: number;
  discordWebhook: string;
}

const DEFAULTS: SettingsConfig = {
  t4Weight: 0.5,
  t5Weight: 1.0,
  deadWeight: 5.0,
  kpPerPowerRatio: 0.3,
  deadPerPowerRatio: 0.02,
  discordWebhook: '',
};

export default function SettingsPage() {
  const [config, setConfig] = useState<SettingsConfig>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) {
          setConfig({
            t4Weight: data.t4Weight ?? DEFAULTS.t4Weight,
            t5Weight: data.t5Weight ?? DEFAULTS.t5Weight,
            deadWeight: data.deadWeight ?? DEFAULTS.deadWeight,
            kpPerPowerRatio: data.kpPerPowerRatio ?? DEFAULTS.kpPerPowerRatio,
            deadPerPowerRatio: data.deadPerPowerRatio ?? DEFAULTS.deadPerPowerRatio,
            discordWebhook: data.discordWebhook ?? DEFAULTS.discordWebhook,
          });
        }
      })
      .catch(() => {
        setMessage({ type: 'error', text: 'Failed to load settings from API.' });
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (res.ok) {
        setMessage({ type: 'success', text: 'Settings saved.' });
      } else {
        setMessage({ type: 'error', text: 'Failed to save settings.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error.' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 4000);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]: name === 'discordWebhook' ? value : Number(value),
    }));
  };

  const formulaPreview = useMemo(() => {
    const killWeight = config.t4Weight + config.t5Weight;
    const engagementWeight = config.deadWeight + config.kpPerPowerRatio * 10 + config.deadPerPowerRatio * 100;
    return {
      killWeight: Math.round(killWeight * 100) / 100,
      engagementWeight: Math.round(engagementWeight * 100) / 100,
    };
  }, [config]);

  return (
    <div className="page-container">
      <PageHero
        title="Kingdom Settings"
        subtitle="Configure score formulas and integration endpoints."
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setConfig(DEFAULTS)}>
              <SlidersHorizontal size={14} /> Reset Defaults
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
              <Save size={14} /> {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </>
        }
      />

      <div className="grid-4 mb-24">
        <KpiCard label="T4 Weight" value={config.t4Weight} hint="Kill score multiplier" tone="info" />
        <KpiCard label="T5 Weight" value={config.t5Weight} hint="Kill score multiplier" tone="warn" />
        <KpiCard label="Dead Weight" value={config.deadWeight} hint="Commitment multiplier" tone="good" />
        <KpiCard label="Formula Mix" value={formulaPreview.killWeight} hint="Combined kill weighting" tone="neutral" />
      </div>

      <div className="grid-2">
        <Panel title="Combat Weighting">
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
              onChange={handleChange}
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
              onChange={handleChange}
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
              onChange={handleChange}
            />
          </div>

          <FilterBar>
            <Settings2 size={14} />
            <span className="text-sm text-muted">These multipliers directly affect warrior score output.</span>
          </FilterBar>
        </Panel>

        <Panel title="Power Expectation Ratios">
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
              onChange={handleChange}
            />
            <div className="text-sm text-muted mt-4">
              Example: 100M power expects {(config.kpPerPowerRatio * 100).toLocaleString()}M KP.
            </div>
          </div>

          <div className="mb-16">
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
              onChange={handleChange}
            />
            <div className="text-sm text-muted mt-4">
              Example: 100M power expects {(config.deadPerPowerRatio * 100000).toLocaleString()} deads.
            </div>
          </div>

          <FilterBar>
            <Shield size={14} />
            <span className="text-sm text-muted">Use consistent ratios to reduce volatility across events.</span>
          </FilterBar>
        </Panel>
      </div>

      <Panel title="Discord Integration" className="mt-24">
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Webhook URL</label>
          <input
            type="text"
            className="form-input"
            name="discordWebhook"
            value={config.discordWebhook}
            onChange={handleChange}
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
